"""End-to-end ingestion tests against the database, with a fake Elexon source.

They use a March 2026 window so they never touch the loaded January data, and run inside
rolled-back transactions (see conftest.py).
"""
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.ingest import load
from app.ingest.load import Window, run
from app.models import ActualGeneration, IngestionRun, WindForecast

# Four half-hours / two delivery hours on 2 March 2026 (GMT, so local time = UTC).
WINDOW = Window(datetime(2026, 3, 2, 0, 0, tzinfo=UTC), datetime(2026, 3, 2, 2, 0, tzinfo=UTC))
DAY = timedelta(days=1)


def actual(period: int, generation: Any = 9000, published: str = "2026-03-02T03:00:00Z") -> dict[str, Any]:
    start = WINDOW.start + timedelta(minutes=30 * (period - 1))
    return {
        "startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "settlementDate": "2026-03-02",
        "settlementPeriod": period,
        "fuelType": "WIND",
        "generation": generation,
        "publishTime": published,
    }


def forecast(hour: int, published: str, generation: Any = 8000) -> dict[str, Any]:
    start = WINDOW.start + timedelta(hours=hour)
    return {"startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "publishTime": published, "generation": generation}


class FakeElexon:
    def __init__(self, actuals: list[Any], forecasts: list[Any]) -> None:
        self.actuals, self.forecasts = actuals, forecasts
        self.calls: list[str] = []
        self.fail: set[str] = set()

    def fetch_wind_actuals(self, first_day: date, last_day: date) -> list[Any]:
        self.calls.append("actuals")
        assert (first_day, last_day) == (date(2026, 3, 2), date(2026, 3, 2))
        if "actuals" in self.fail:
            raise ConnectionError("Elexon unavailable")
        return self.actuals

    def fetch_wind_forecasts(self, published_from: datetime, published_to: datetime) -> list[Any]:
        self.calls.append("forecasts")
        assert published_from == WINDOW.start - timedelta(hours=66.5)
        if "forecasts" in self.fail:
            raise ConnectionError("Elexon unavailable")
        return self.forecasts


@pytest.fixture
def source() -> FakeElexon:
    return FakeElexon(
        actuals=[actual(period) for period in (1, 2, 3, 4)],
        forecasts=[
            forecast(0, "2026-03-01T18:30:00Z"),
            forecast(1, "2026-03-01T18:30:00Z"),
            forecast(0, "2026-03-01T21:30:00Z"),
            forecast(1, "2026-03-01T21:30:00Z"),
        ],
    )


def ingest(source: FakeElexon, session_factory: sessionmaker[Session], **options: Any) -> bool:
    options = {"freshness": DAY, "force": True} | options
    return run(("actuals", "forecasts"), source, session_factory, WINDOW, **options)


def latest_runs(session: Session) -> dict[str, IngestionRun]:
    runs = session.scalars(
        select(IngestionRun).where(IngestionRun.period_start == WINDOW.start).order_by(IngestionRun.id)
    ).all()
    return {item.dataset: item for item in runs}


def counts(item: IngestionRun) -> tuple[int | None, ...]:
    return (
        item.records_fetched,
        item.records_rejected,
        item.records_filtered,
        item.records_inserted,
        item.records_updated,
        item.records_unchanged,
    )


def stored_rows(session: Session, model: type[ActualGeneration] | type[WindForecast]) -> int:
    in_window = (model.start_time >= WINDOW.start) & (model.start_time < WINDOW.end)
    return session.scalar(select(func.count()).select_from(model).where(in_window))


def test_first_ingestion_stores_everything(source: FakeElexon, session_factory: sessionmaker, session: Session) -> None:
    assert ingest(source, session_factory)

    runs = latest_runs(session)
    assert counts(runs["actuals"]) == (4, 0, 0, 4, 0, 0)
    assert counts(runs["forecasts"]) == (4, 0, 0, 4, 0, 0)
    assert {item.status for item in runs.values()} == {"succeeded"}
    assert stored_rows(session, ActualGeneration) == 4
    assert stored_rows(session, WindForecast) == 4  # both publication versions are kept


def test_repeated_ingestion_writes_nothing(source: FakeElexon, session_factory: sessionmaker, session: Session) -> None:
    ingest(source, session_factory)
    ingest(source, session_factory)

    runs = latest_runs(session)
    assert counts(runs["actuals"]) == (4, 0, 0, 0, 0, 4)
    assert counts(runs["forecasts"]) == (4, 0, 0, 0, 0, 4)
    assert stored_rows(session, WindForecast) == 4


def test_changed_values_are_updated(source: FakeElexon, session_factory: sessionmaker, session: Session) -> None:
    ingest(source, session_factory)
    source.forecasts[0] = forecast(0, "2026-03-01T18:30:00Z", generation=8100)
    source.actuals[0] = actual(1, generation=9100, published="2026-03-02T04:00:00Z")

    ingest(source, session_factory)

    runs = latest_runs(session)
    assert counts(runs["forecasts"]) == (4, 0, 0, 0, 1, 3)
    assert counts(runs["actuals"]) == (4, 0, 0, 0, 1, 3)


def test_invalid_and_out_of_scope_records_are_counted_not_stored(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    source.actuals += [actual(2, generation=None), actual(2)]  # invalid, then a duplicate
    source.forecasts += [
        forecast(0, "2026-03-02T00:30:00Z"),  # published after delivery began
        forecast(5, "2026-03-01T21:30:00Z"),  # outside the window
        forecast(1, "2026-03-01T21:30:00", generation=1),  # no UTC offset
    ]

    assert ingest(source, session_factory)

    runs = latest_runs(session)
    assert counts(runs["actuals"]) == (6, 1, 1, 4, 0, 0)
    assert runs["actuals"].reasons == {"generation: missing or not a number": 1, "duplicate in download": 1}
    assert counts(runs["forecasts"]) == (7, 1, 2, 4, 0, 0)
    assert runs["forecasts"].reasons == {
        "publishTime: no UTC offset": 1,
        "horizon outside 0-66.5 h": 1,
        "delivery outside window": 1,
    }


def test_download_failure_keeps_existing_data_and_is_recorded(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    ingest(source, session_factory)
    source.fail.add("forecasts")
    source.actuals[0] = actual(1, generation=9100, published="2026-03-02T04:00:00Z")

    assert not ingest(source, session_factory)

    runs = latest_runs(session)
    assert runs["forecasts"].status == "failed"
    assert runs["forecasts"].error == "ConnectionError: Elexon unavailable"
    assert stored_rows(session, WindForecast) == 4
    # A failure in one dataset does not stop the other.
    assert runs["actuals"].status == "succeeded"
    assert runs["actuals"].records_updated == 1


def test_write_failure_rolls_back_the_whole_dataset(
    source: FakeElexon, session_factory: sessionmaker, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_upsert = load.upsert

    def upsert_then_crash(*args: Any) -> Any:
        real_upsert(*args)  # rows are written inside the transaction...
        raise RuntimeError("connection lost")  # ...then the write fails

    monkeypatch.setattr(load, "upsert", upsert_then_crash)

    assert not ingest(source, session_factory)

    runs = latest_runs(session)
    assert {item.status for item in runs.values()} == {"failed"}
    assert stored_rows(session, ActualGeneration) == 0
    assert stored_rows(session, WindForecast) == 0


def test_fresh_datasets_are_not_downloaded_again(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    ingest(source, session_factory)
    source.calls.clear()

    assert ingest(source, session_factory, force=False)
    assert source.calls == []

    assert ingest(source, session_factory, force=False, freshness=timedelta(0))
    assert source.calls == ["actuals", "forecasts"]


def test_allow_stale_tolerates_failure_only_after_a_previous_load(
    source: FakeElexon, session_factory: sessionmaker
) -> None:
    source.fail.add("forecasts")
    assert not ingest(source, session_factory, allow_stale=True)  # nothing loaded yet

    source.fail.clear()
    ingest(source, session_factory)
    source.fail.add("forecasts")
    assert ingest(source, session_factory, allow_stale=True)


def test_an_empty_download_fails_the_run_and_keeps_existing_data(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    assert ingest(source, session_factory)
    before = stored_rows(session, ActualGeneration)
    source.actuals = []

    assert not ingest(source, session_factory)

    failed = latest_runs(session)["actuals"]
    assert failed.status == "failed"
    assert "no records" in failed.error
    assert stored_rows(session, ActualGeneration) == before


def test_a_download_where_every_record_is_invalid_fails_the_run(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    source.actuals = [{"error": "rate limited"}, {"error": "again"}]

    assert not ingest(source, session_factory)

    failed = latest_runs(session)["actuals"]
    assert failed.status == "failed"
    assert "every record was rejected" in failed.error


def test_a_failed_empty_run_does_not_start_the_freshness_clock(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    source.actuals = []
    ingest(source, session_factory)
    source.actuals = [actual(period) for period in (1, 2, 3, 4)]
    source.calls.clear()

    assert ingest(source, session_factory, force=False)

    assert "actuals" in source.calls


def test_one_implausible_value_is_rejected_and_the_rest_are_stored(
    source: FakeElexon, session_factory: sessionmaker, session: Session
) -> None:
    source.actuals = [actual(1), actual(2), actual(3), actual(4, generation=3_000_000_000)]

    assert ingest(source, session_factory)

    run_record = latest_runs(session)["actuals"]
    assert run_record.status == "succeeded"
    assert run_record.records_rejected == 1
    assert stored_rows(session, ActualGeneration) == 3
