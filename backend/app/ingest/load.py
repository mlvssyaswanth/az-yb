"""Ingests wind actuals (FUELHH) and forecasts (WINDFOR) from Elexon into TimescaleDB.

Usage, inside the backend image (see README):
    python -m app.ingest.load                      # refresh datasets that are not fresh
    python -m app.ingest.load --force              # refresh regardless of freshness
    python -m app.ingest.load --dataset actuals    # one dataset only
    python -m app.ingest.load --status             # show recent ingestion runs

Each dataset is downloaded and validated in full before anything is written, then written
in a single transaction. A failed download or write therefore leaves stored data exactly
as it was. Every attempt is logged in ingestion_run in its own transaction, so failures
are recorded even though the data transaction rolled back.
"""
import argparse
import logging
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal, Protocol

import pandas as pd
from sqlalchemy import and_, func, literal_column, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.db import SessionLocal
from app.ingest.elexon_client import ElexonClient
from app.ingest.validation import ValidationResult, validate_actuals, validate_forecasts
from app.models import ActualGeneration, IngestionRun, WindForecast
from app.services.horizon import MAX_HORIZON, valid_horizon_mask
from app.timezones import GB_TIME

logger = logging.getLogger(__name__)

Dataset = Literal["actuals", "forecasts"]
DATASETS: tuple[Dataset, ...] = ("actuals", "forecasts")

# Keeps each multi-row INSERT well under PostgreSQL's 65,535 bind-parameter limit.
UPSERT_BATCH_SIZE = 5000


@dataclass(frozen=True)
class Window:
    """Delivery times to ingest: [start, end)."""

    start: datetime
    end: datetime


class WindDataSource(Protocol):
    def fetch_wind_actuals(self, first_day: date, last_day: date) -> list[dict[str, Any]]: ...

    def fetch_wind_forecasts(self, published_from: datetime, published_to: datetime) -> list[dict[str, Any]]: ...


@dataclass
class Selection:
    rows: pd.DataFrame
    filtered: Counter[str]


@dataclass
class WriteCounts:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0


def select_actuals(actuals: pd.DataFrame, window: Window) -> Selection:
    """Keep half-hours in the window; if the source repeats one, keep its latest publication."""
    in_window = actuals[(actuals["start_time"] >= window.start) & (actuals["start_time"] < window.end)]
    unique = in_window.sort_values("publish_time").drop_duplicates(["start_time", "fuel_type"], keep="last")
    filtered = Counter(
        {
            "delivery outside window": len(actuals) - len(in_window),
            "duplicate in download": len(in_window) - len(unique),
        }
    )
    return Selection(rows=unique, filtered=+filtered)  # unary + drops zero counts


def select_forecasts(forecasts: pd.DataFrame, window: Window) -> Selection:
    """Keep one row per forecast version for delivery hours in the window that pass the horizon rule."""
    in_window = forecasts[(forecasts["start_time"] >= window.start) & (forecasts["start_time"] < window.end)]
    valid = in_window[valid_horizon_mask(in_window)]
    unique = valid.drop_duplicates(["start_time", "publish_time"], keep="last")
    filtered = Counter(
        {
            "delivery outside window": len(forecasts) - len(in_window),
            "horizon outside 0-66.5 h": len(in_window) - len(valid),
            "duplicate in download": len(valid) - len(unique),
        }
    )
    return Selection(rows=unique, filtered=+filtered)


def upsert(session: Session, model: type[ActualGeneration] | type[WindForecast], rows: pd.DataFrame) -> WriteCounts:
    """Insert new rows and update changed ones; identical rows are not rewritten.

    Rows must be unique on the primary key (see select_*): PostgreSQL rejects an upsert that
    touches the same row twice. An actual is only replaced by one with the same or a later
    publish_time, so an out-of-order reload cannot roll a revision back.
    """
    key_columns = [column.name for column in model.__table__.primary_key.columns]
    value_columns = [name for name in rows.columns if name not in key_columns]
    counts = WriteCounts()
    for batch_start in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows.iloc[batch_start : batch_start + UPSERT_BATCH_SIZE]
        statement = insert(model).values(batch.to_dict(orient="records"))
        stored = tuple_(*(model.__table__.c[name] for name in value_columns))
        incoming = tuple_(*(statement.excluded[name] for name in value_columns))
        changed = stored.is_distinct_from(incoming)
        if model is ActualGeneration:
            changed = and_(model.publish_time <= statement.excluded.publish_time, changed)
        statement = statement.on_conflict_do_update(
            index_elements=key_columns,
            set_={name: statement.excluded[name] for name in value_columns},
            where=changed,
        ).returning(literal_column("xmax = 0"))  # true for inserted rows; unchanged rows are not returned

        was_inserted = session.execute(statement).scalars().all()
        counts.inserted += sum(was_inserted)
        counts.updated += len(was_inserted) - sum(was_inserted)
    counts.unchanged = len(rows) - counts.inserted - counts.updated
    return counts


def last_success(session: Session, dataset: Dataset, window: Window) -> datetime | None:
    return session.scalar(
        select(func.max(IngestionRun.finished_at)).where(
            IngestionRun.dataset == dataset,
            IngestionRun.status == "succeeded",
            IngestionRun.period_start == window.start,
            IngestionRun.period_end == window.end,
        )
    )


def _download(dataset: Dataset, source: WindDataSource, window: Window) -> list[Any]:
    if dataset == "actuals":
        # Settlement dates are GB-local days; the last period starts 30 minutes before window.end.
        first_day = window.start.astimezone(GB_TIME).date()
        last_day = (window.end - timedelta(minutes=30)).astimezone(GB_TIME).date()
        return source.fetch_wind_actuals(first_day, last_day)
    # WINDFOR can only be filtered by publish time; reach back far enough to catch the
    # longest valid horizon for the first delivery hour.
    return source.fetch_wind_forecasts(window.start - MAX_HORIZON, window.end)


def _prepare(dataset: Dataset, records: list[Any], window: Window) -> tuple[ValidationResult, Selection]:
    if dataset == "actuals":
        validated = validate_actuals(records)
        return validated, select_actuals(validated.rows, window)
    validated = validate_forecasts(records)
    return validated, select_forecasts(validated.rows, window)


class NothingToStore(Exception):
    """The download produced no usable records, which means the source is wrong, not that data is absent."""


def _require_usable(records: list[Any], validated: ValidationResult, selection: Selection) -> None:
    """Fail the run rather than report success for an empty or unusable download.

    A "successful" empty run would start the freshness clock and hide a broken source.
    """
    if not records:
        raise NothingToStore("the source returned no records")
    if validated.rejected.total() == len(records):
        raise NothingToStore(f"every record was rejected ({dict(validated.rejected)})")
    if selection.rows.empty:
        raise NothingToStore(f"no usable records after filtering ({dict(validated.rejected + selection.filtered)})")


def ingest_dataset(
    dataset: Dataset, source: WindDataSource, session_factory: sessionmaker[Session], window: Window
) -> IngestionRun:
    """Download, validate and store one dataset, logging the attempt. Re-raises on failure."""
    with session_factory() as session:
        run = IngestionRun(
            dataset=dataset,
            period_start=window.start,
            period_end=window.end,
            status="running",
            started_at=datetime.now(UTC),
        )
        session.add(run)
        session.commit()

        try:
            records = _download(dataset, source, window)
            run.records_fetched = len(records)
            validated, selection = _prepare(dataset, records, window)
            _require_usable(records, validated, selection)
            run.records_rejected = validated.rejected.total()
            run.records_filtered = selection.filtered.total()
            run.reasons = dict(validated.rejected + selection.filtered)

            model = ActualGeneration if dataset == "actuals" else WindForecast
            with session_factory() as data_session, data_session.begin():
                counts = upsert(data_session, model, selection.rows)
        except Exception as exc:
            run.status = "failed"
            run.error = f"{type(exc).__name__}: {exc}"[:2000]
            run.finished_at = datetime.now(UTC)
            session.commit()
            raise

        run.records_inserted = counts.inserted
        run.records_updated = counts.updated
        run.records_unchanged = counts.unchanged
        run.status = "succeeded"
        run.finished_at = datetime.now(UTC)
        session.commit()
        return run


def run(
    datasets: tuple[Dataset, ...],
    source: WindDataSource,
    session_factory: sessionmaker[Session],
    window: Window,
    freshness: timedelta,
    force: bool = False,
    allow_stale: bool = False,
) -> bool:
    """Ingest each dataset that is not fresh. Returns False if any dataset failed.

    With allow_stale, a failure is tolerated for a dataset that has been loaded before,
    so the app can still start on existing data when Elexon is unreachable.
    """
    all_ok = True
    for dataset in datasets:
        with session_factory() as session:
            previous_success = last_success(session, dataset, window)

        if not force and previous_success and datetime.now(UTC) - previous_success < freshness:
            logger.info("%s: fresh (last loaded %s); skipping, use --force to reload", dataset, previous_success)
            continue

        try:
            result = ingest_dataset(dataset, source, session_factory, window)
        except Exception:
            logger.exception("%s: ingestion failed; stored data is unchanged", dataset)
            if allow_stale and previous_success:
                logger.warning("%s: continuing with data loaded at %s", dataset, previous_success)
            else:
                all_ok = False
            continue

        logger.info(
            "%s: fetched %d, rejected %d, filtered %d, inserted %d, updated %d, unchanged %d",
            dataset,
            result.records_fetched,
            result.records_rejected,
            result.records_filtered,
            result.records_inserted,
            result.records_updated,
            result.records_unchanged,
        )
        if result.reasons:
            logger.info("%s: reasons %s", dataset, result.reasons)
    return all_ok


def print_status(session_factory: sessionmaker[Session], limit: int = 10) -> None:
    with session_factory() as session:
        runs = session.scalars(select(IngestionRun).order_by(IngestionRun.id.desc()).limit(limit)).all()
    header = f"{'id':>4}  {'dataset':<9}  {'status':<9}  {'finished (UTC)':<19}  " + "  ".join(
        f"{name:>9}" for name in ("fetched", "rejected", "filtered", "inserted", "updated", "unchanged")
    )
    print(header)
    for item in runs:
        finished = item.finished_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S") if item.finished_at else "-"
        counts = (
            item.records_fetched,
            item.records_rejected,
            item.records_filtered,
            item.records_inserted,
            item.records_updated,
            item.records_unchanged,
        )
        print(
            f"{item.id:>4}  {item.dataset:<9}  {item.status:<9}  {finished:<19}  "
            + "  ".join(f"{'-' if value is None else value:>9}" for value in counts)
        )
        if item.error:
            print(f"      error: {item.error}")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    parser = argparse.ArgumentParser(description="Load Elexon wind actuals and forecasts into TimescaleDB.")
    parser.add_argument("--dataset", choices=DATASETS, action="append", help="limit to one dataset (repeatable)")
    parser.add_argument("--force", action="store_true", help="ignore the freshness policy")
    parser.add_argument(
        "--allow-stale",
        action="store_true",
        help="exit successfully if a download fails but the dataset was loaded before",
    )
    parser.add_argument("--status", action="store_true", help="show recent ingestion runs and exit")
    args = parser.parse_args()

    if args.status:
        print_status(SessionLocal)
        return 0

    settings = get_settings()
    client = ElexonClient(settings.elexon_base_url)
    try:
        ok = run(
            datasets=tuple(args.dataset or DATASETS),
            source=client,
            session_factory=SessionLocal,
            window=Window(settings.analysis_start, settings.analysis_end),
            freshness=timedelta(hours=settings.ingest_freshness_hours),
            force=args.force,
            allow_stale=args.allow_stale,
        )
    finally:
        client.close()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
