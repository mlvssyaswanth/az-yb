"""Repository tests against the database; rows use March 2026 and are rolled back."""
from datetime import UTC, datetime

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.repository import load_actuals, load_forecasts

START, END = datetime(2026, 3, 2, 0, tzinfo=UTC), datetime(2026, 3, 2, 2, tzinfo=UTC)


def seed(session: Session) -> None:
    session.execute(
        text(
            "INSERT INTO actual_generation VALUES "
            "('2026-03-02T00:00Z', 'WIND', '2026-03-02', 1, 100, '2026-03-02T01:00Z'), "
            "('2026-03-02T02:00Z', 'WIND', '2026-03-02', 5, 999, '2026-03-02T03:00Z')"  # outside window
        )
    )
    session.execute(
        text(
            "INSERT INTO wind_forecast VALUES "
            "('2026-03-02T00:00Z', '2026-03-01T18:30Z', 90), "
            "('2026-03-02T00:00Z', '2026-03-01T21:30Z', 95)"  # after the cutoff below
        )
    )


def test_forecasts_after_the_cutoff_are_not_loaded(session: Session) -> None:
    seed(session)
    loaded = load_forecasts(session, START, END, cutoff=datetime(2026, 3, 1, 20, tzinfo=UTC))
    assert loaded["generation_mw"].tolist() == [90]


def test_only_the_delivery_window_is_loaded(session: Session) -> None:
    seed(session)
    assert load_actuals(session, START, END)["generation_mw"].tolist() == [100]


def test_timestamps_are_utc_whatever_the_session_time_zone(session: Session) -> None:
    seed(session)
    session.execute(text("SET LOCAL TIME ZONE 'America/New_York'"))

    loaded = load_forecasts(session, START, END, cutoff=END)

    assert str(loaded["start_time"].dt.tz) == "UTC"
    assert loaded["start_time"].tolist() == [pd.Timestamp("2026-03-02T00:00Z")] * 2
    assert loaded["publish_time"].tolist() == [pd.Timestamp("2026-03-01T18:30Z"), pd.Timestamp("2026-03-01T21:30Z")]
