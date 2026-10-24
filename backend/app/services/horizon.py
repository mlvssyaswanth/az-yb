"""The forecast horizon rule, shared by ingestion, analysis and the API.

Horizon = start_time - publish_time. A forecast is valid when 0 h <= horizon <= 66.5 h
(both ends inclusive): it was not published after its delivery hour began, and it lies
within the longest horizon WINDFOR actually publishes. The same bounds are enforced by a
CHECK constraint on wind_forecast (migration 0002), so keep the two in step.
"""
from datetime import datetime, timedelta

import pandas as pd

MIN_HORIZON = timedelta(0)
MAX_HORIZON = timedelta(hours=66, minutes=30)


def _require_tz_aware(series: pd.Series, name: str) -> None:
    # Naive timestamps would silently be read as local time; refuse them instead.
    if series.dt.tz is None:
        raise ValueError(f"{name} must be timezone-aware")


def horizon(start_time: pd.Series, publish_time: pd.Series) -> pd.Series:
    _require_tz_aware(start_time, "start_time")
    _require_tz_aware(publish_time, "publish_time")
    return start_time - publish_time


def valid_horizon_mask(forecasts: pd.DataFrame) -> pd.Series:
    """True for rows whose horizon is within [MIN_HORIZON, MAX_HORIZON].

    Compares timedeltas rather than float hours so the 66.5 h boundary is exact.
    """
    lead = horizon(forecasts["start_time"], forecasts["publish_time"])
    return (lead >= MIN_HORIZON) & (lead <= MAX_HORIZON)


def published_by(forecasts: pd.DataFrame, cutoff: datetime) -> pd.DataFrame:
    """Valid forecasts that were available at the decision cutoff (publish_time <= cutoff)."""
    if cutoff.tzinfo is None:
        raise ValueError("cutoff must be timezone-aware")
    available = forecasts["publish_time"] <= pd.Timestamp(cutoff)
    return forecasts[valid_horizon_mask(forecasts) & available]
