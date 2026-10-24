"""Read-only queries that load analysis inputs from TimescaleDB as DataFrames."""
from datetime import datetime

import pandas as pd
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models import ActualGeneration, WindForecast


def _frame(session: Session, statement: Select, columns: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame(session.execute(statement).all(), columns=columns)
    # The driver returns timestamps in the session's time zone; normalise to UTC.
    for column in ("start_time", "publish_time"):
        frame[column] = pd.to_datetime(frame[column], utc=True)
    return frame


def load_actuals(session: Session, start: datetime, end: datetime) -> pd.DataFrame:
    """Half-hourly wind actuals with delivery start in [start, end)."""
    statement = (
        select(ActualGeneration.start_time, ActualGeneration.generation_mw, ActualGeneration.publish_time)
        .where(
            ActualGeneration.fuel_type == "WIND",
            ActualGeneration.start_time >= start,
            ActualGeneration.start_time < end,
        )
        .order_by(ActualGeneration.start_time)
    )
    return _frame(session, statement, ["start_time", "generation_mw", "publish_time"])


def load_forecasts(session: Session, start: datetime, end: datetime, cutoff: datetime) -> pd.DataFrame:
    """Forecast versions for delivery hours in [start, end) published at or before the cutoff.

    Filtering on the cutoff here keeps later forecasts out of the analysis altogether; the
    analysis functions apply the same rule again so they are safe on any input.
    """
    statement = (
        select(WindForecast.start_time, WindForecast.publish_time, WindForecast.generation_mw)
        .where(
            WindForecast.start_time >= start,
            WindForecast.start_time < end,
            WindForecast.publish_time <= cutoff,
        )
        .order_by(WindForecast.start_time, WindForecast.publish_time)
    )
    return _frame(session, statement, ["start_time", "publish_time", "generation_mw"])
