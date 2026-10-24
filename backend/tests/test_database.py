"""Schema tests against the database. Test rows use March 2026 so they never collide with
the loaded January data; fixtures in conftest.py roll every test back."""
from pathlib import Path

import pandas as pd
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ingest.load import upsert
from app.models import ActualGeneration, WindForecast

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"

INSERT_FORECAST = text(
    "INSERT INTO wind_forecast (start_time, publish_time, generation_mw) "
    "VALUES (:start, CAST(:start AS timestamptz) - CAST(:lead AS interval), 1000)"
)


def actual_row(generation_mw: int, published: str) -> dict:
    return {
        "start_time": pd.Timestamp("2026-03-01T12:00:00Z"),
        "fuel_type": "WIND",
        "settlement_date": pd.Timestamp("2026-03-01").date(),
        "settlement_period": 25,
        "generation_mw": generation_mw,
        "publish_time": pd.Timestamp(published),
    }


def stored_actual(session: Session) -> ActualGeneration:
    return session.scalars(
        select(ActualGeneration).where(ActualGeneration.start_time == pd.Timestamp("2026-03-01T12:00:00Z"))
    ).one()


def test_models_match_migrations() -> None:
    command.check(Config(str(ALEMBIC_INI)))  # raises if autogenerate would emit changes


def test_only_primary_key_indexes_exist(connection: Connection) -> None:
    indexes = connection.execute(
        text(
            "SELECT tablename, indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND tablename IN ('actual_generation', 'wind_forecast') "
            "ORDER BY tablename"
        )
    ).all()
    assert [(table, definition.split(" USING ")[1]) for table, definition in indexes] == [
        ("actual_generation", "btree (start_time, fuel_type)"),
        ("wind_forecast", "btree (start_time, publish_time)"),
    ]


def test_tables_are_partitioned_weekly_on_delivery_time(connection: Connection) -> None:
    dimensions = connection.execute(
        text(
            "SELECT hypertable_name, column_name, time_interval "
            "FROM timescaledb_information.dimensions ORDER BY hypertable_name"
        )
    ).all()
    assert [(name, column, str(interval)) for name, column, interval in dimensions] == [
        ("actual_generation", "start_time", "7 days, 0:00:00"),
        ("wind_forecast", "start_time", "7 days, 0:00:00"),
    ]


def test_timestamps_are_timezone_aware(connection: Connection) -> None:
    column_types = connection.execute(
        text(
            "SELECT table_name, column_name, data_type FROM information_schema.columns "
            "WHERE table_name IN ('actual_generation', 'wind_forecast') AND column_name LIKE '%_time'"
        )
    ).all()
    assert len(column_types) == 4
    assert {data_type for _, _, data_type in column_types} == {"timestamp with time zone"}


@pytest.mark.parametrize("lead", ["0 hours", "66 hours", "66 hours 30 minutes"])
def test_database_accepts_valid_horizons(connection: Connection, lead: str) -> None:
    connection.execute(INSERT_FORECAST, {"start": "2026-03-01T12:00:00Z", "lead": lead})


@pytest.mark.parametrize("lead", ["-30 minutes", "67 hours"])
def test_database_rejects_invalid_horizons(connection: Connection, lead: str) -> None:
    with pytest.raises(IntegrityError, match="ck_wind_forecast_horizon"):
        connection.execute(INSERT_FORECAST, {"start": "2026-03-01T12:00:00Z", "lead": lead})


def test_duplicate_forecast_version_is_rejected(connection: Connection) -> None:
    connection.execute(INSERT_FORECAST, {"start": "2026-03-01T12:00:00Z", "lead": "6 hours"})
    with pytest.raises(IntegrityError, match="wind_forecast_pkey"):
        connection.execute(INSERT_FORECAST, {"start": "2026-03-01T12:00:00Z", "lead": "6 hours"})


def test_settlement_period_out_of_range_is_rejected(session: Session) -> None:
    row = actual_row(1000, "2026-03-01T12:30:00Z") | {"settlement_period": 51}
    with pytest.raises(IntegrityError, match="ck_actual_generation_settlement_period"):
        upsert(session, ActualGeneration, pd.DataFrame([row]))


def test_reingesting_the_same_rows_changes_nothing(session: Session) -> None:
    forecasts = pd.DataFrame(
        {
            "start_time": [pd.Timestamp("2026-03-01T12:00:00Z")] * 2,
            "publish_time": [pd.Timestamp("2026-03-01T06:30:00Z"), pd.Timestamp("2026-03-01T09:30:00Z")],
            "generation_mw": [9000, 9500],
        }
    )
    actuals = pd.DataFrame([actual_row(9200, "2026-03-01T12:30:00Z")])

    for _ in range(2):
        upsert(session, WindForecast, forecasts)
        upsert(session, ActualGeneration, actuals)
        session.commit()

    march = WindForecast.start_time >= pd.Timestamp("2026-03-01T00:00:00Z")
    assert session.scalar(select(func.count()).select_from(WindForecast).where(march)) == 2
    assert stored_actual(session).generation_mw == 9200


def test_newer_actual_publication_replaces_older(session: Session) -> None:
    upsert(session, ActualGeneration, pd.DataFrame([actual_row(9200, "2026-03-01T12:30:00Z")]))
    upsert(session, ActualGeneration, pd.DataFrame([actual_row(9300, "2026-03-01T13:00:00Z")]))
    session.expire_all()
    assert stored_actual(session).generation_mw == 9300


def test_older_actual_publication_does_not_overwrite_newer(session: Session) -> None:
    upsert(session, ActualGeneration, pd.DataFrame([actual_row(9300, "2026-03-01T13:00:00Z")]))
    upsert(session, ActualGeneration, pd.DataFrame([actual_row(9200, "2026-03-01T12:30:00Z")]))
    session.expire_all()
    stored = stored_actual(session)
    assert (stored.generation_mw, stored.publish_time) == (9300, pd.Timestamp("2026-03-01T13:00:00Z"))
