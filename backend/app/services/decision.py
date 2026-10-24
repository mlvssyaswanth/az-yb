"""The day-ahead decision rule: what a buyer could know when the purchase has to be made.

The UK day-ahead purchase for a delivery date is decided on the day before, so only forecasts
published by 12:00 UK time on that day are usable. Every hour of a GB delivery date shares that
one cutoff.
"""
from datetime import UTC, date, datetime, time, timedelta

import pandas as pd

from app.timezones import GB_TIME

DAY_AHEAD_DECISION_HOUR = 12


def day_ahead_cutoffs(hours: pd.DatetimeIndex) -> pd.Series:
    """For each delivery hour (UTC), the UTC instant of 12:00 GB time on the day before its GB date."""
    local_dates = hours.tz_convert(GB_TIME).date
    cutoff_by_date: dict[date, pd.Timestamp] = {
        delivery_date: pd.Timestamp(
            datetime.combine(delivery_date - timedelta(days=1), time(DAY_AHEAD_DECISION_HOUR), tzinfo=GB_TIME).astimezone(UTC)
        )
        for delivery_date in set(local_dates)
    }
    return pd.Series([cutoff_by_date[delivery_date] for delivery_date in local_dates], index=hours, name="cutoff")
