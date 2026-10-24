"""Compares hourly WINDFOR forecasts with FUELHH actual wind generation.

Business rules:
- A forecast is usable at a decision cutoff only if publish_time <= cutoff and its horizon
  is valid (0-66.5 h, see horizon.py). For each delivery hour the latest usable forecast
  is selected. Nothing published after the cutoff is ever used.
- WINDFOR is hourly; FUELHH is the average MW over each half-hour. The hourly actual is the
  mean of the two half-hours in the hour, which is the average MW over the hour. If either
  half-hour is missing, the hourly actual is missing; nothing is interpolated.
- Forecasts and actuals are joined on delivery timestamp, never on row order, over a full
  grid of expected delivery hours, so gaps show up as missing rather than disappearing.
- Signed error = forecast - actual (positive means over-forecast). Metrics are computed
  only from matched hours, where both values exist; with no matched hours they are None.
- All timestamps are timezone-aware and handled in UTC. Delivery dates are GB local dates
  (Europe/London), so clock-change days have 23 or 25 delivery hours.
"""
from dataclasses import asdict, dataclass
from datetime import datetime

import numpy as np
import pandas as pd

from app.services.horizon import published_by
from app.timezones import GB_TIME

HOUR = pd.Timedelta(hours=1)

# Lead time = delivery start - publish time. The last bucket ends at the 66.5 h horizon limit.
LEAD_TIME_EDGES_HOURS = [0, 6, 12, 24, 36, 48, np.inf]
LEAD_TIME_LABELS = ["0-6 h", "6-12 h", "12-24 h", "24-36 h", "36-48 h", "48-66.5 h"]


@dataclass(frozen=True)
class ErrorMetrics:
    expected_intervals: int
    matched_intervals: int
    missing_forecast: int
    missing_actual: int
    coverage: float | None  # matched / expected
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None  # mean signed error
    # MAPE excludes hours where the actual is 0 MW (division by zero); mape_intervals says
    # how many hours it is based on. None when there are no such hours.
    mape_percent: float | None
    mape_intervals: int


@dataclass(frozen=True)
class AnalysisResult:
    cutoff: datetime
    hourly: pd.DataFrame  # one row per expected delivery hour
    overall: ErrorMetrics
    by_delivery_date: pd.DataFrame
    by_lead_time: pd.DataFrame


def _require_utc_hour(moment: datetime, name: str) -> pd.Timestamp:
    if moment.tzinfo is None:
        raise ValueError(f"{name} must be timezone-aware")
    timestamp = pd.Timestamp(moment).tz_convert("UTC")
    if timestamp != timestamp.floor("h"):
        raise ValueError(f"{name} must be on the hour")
    return timestamp


def delivery_hours(start: datetime, end: datetime) -> pd.DatetimeIndex:
    """Every hourly delivery start in [start, end), in UTC."""
    first, stop = _require_utc_hour(start, "start"), _require_utc_hour(end, "end")
    if stop <= first:
        raise ValueError("end must be after start")
    return pd.date_range(first, stop, freq="h", inclusive="left", name="start_time")


def hourly_actuals(actuals: pd.DataFrame) -> pd.Series:
    """Hourly average MW from half-hourly rows (start_time, generation_mw[, publish_time]).

    Only hours with both half-hours present are returned. If a half-hour appears more than
    once, the latest publication is used.
    """
    if "publish_time" in actuals.columns:
        actuals = actuals.sort_values("publish_time")
    unique = actuals.drop_duplicates("start_time", keep="last")
    hour = unique["start_time"].dt.tz_convert("UTC").dt.floor("h").rename("start_time")
    per_hour = unique.groupby(hour)["generation_mw"].agg(["mean", "count"])
    return per_hour.loc[per_hour["count"] == 2, "mean"].rename("actual_mw")


def _usable(forecasts: pd.DataFrame, cutoff: datetime, per_hour_cutoffs: pd.Series | None) -> pd.DataFrame:
    """Valid forecasts published by the cutoff and, when given, by each delivery hour's own cutoff.

    `cutoff` is the latest of the per-hour cutoffs, so it only narrows what is looked at first.
    """
    usable = published_by(forecasts, cutoff)
    if per_hour_cutoffs is not None:
        usable = usable[usable["publish_time"] <= usable["start_time"].map(per_hour_cutoffs)]
    return usable


def select_forecasts_at_cutoff(
    forecasts: pd.DataFrame, cutoff: datetime, per_hour_cutoffs: pd.Series | None = None
) -> pd.DataFrame:
    """For each delivery hour, the latest valid forecast published at or before the cutoff.

    Input columns: start_time, publish_time, generation_mw. Returns one row per delivery hour
    that has a usable forecast, indexed by start_time. `per_hour_cutoffs` (indexed by delivery
    hour) gives each hour its own cutoff, as the day-ahead rule needs.
    """
    usable = _usable(forecasts, cutoff, per_hour_cutoffs)
    latest = (
        usable.sort_values(["start_time", "publish_time"])
        .drop_duplicates("start_time", keep="last")
        .set_index("start_time")
    )
    latest.index = latest.index.tz_convert("UTC")
    return pd.DataFrame(
        {
            "publish_time": latest["publish_time"].dt.tz_convert("UTC"),
            "lead_hours": (latest.index - latest["publish_time"]) / HOUR,
            "forecast_mw": latest["generation_mw"].astype(float),
        }
    )


def align(selected: pd.DataFrame, actual_mw: pd.Series, hours: pd.DatetimeIndex) -> pd.DataFrame:
    """Join forecasts and actuals on delivery hour over the full expected grid."""
    aligned = selected.reindex(hours).join(actual_mw.reindex(hours))
    aligned["error_mw"] = aligned["forecast_mw"] - aligned["actual_mw"]  # NaN unless both exist
    return aligned


def error_metrics(forecast_mw: pd.Series, actual_mw: pd.Series) -> ErrorMetrics:
    """Metrics over the rows given; only rows with both values count towards the errors."""
    has_forecast, has_actual = forecast_mw.notna(), actual_mw.notna()
    matched = has_forecast & has_actual
    errors = (forecast_mw - actual_mw)[matched]
    expected = len(forecast_mw)

    nonzero_actual = actual_mw[matched] != 0
    percentage_errors = (errors[nonzero_actual].abs() / actual_mw[matched][nonzero_actual]) * 100

    def mean_or_none(values: pd.Series) -> float | None:
        return float(values.mean()) if len(values) else None

    rmse = mean_or_none(errors**2)
    return ErrorMetrics(
        expected_intervals=expected,
        matched_intervals=int(matched.sum()),
        missing_forecast=int((~has_forecast).sum()),
        missing_actual=int((~has_actual).sum()),
        coverage=float(matched.sum() / expected) if expected else None,
        mae_mw=mean_or_none(errors.abs()),
        rmse_mw=None if rmse is None else float(np.sqrt(rmse)),
        bias_mw=mean_or_none(errors),
        mape_percent=mean_or_none(percentage_errors),
        mape_intervals=int(nonzero_actual.sum()),
    )


def _metrics_table(frame: pd.DataFrame, group_key: pd.Series, name: str) -> pd.DataFrame:
    rows = [
        {name: key} | asdict(error_metrics(group["forecast_mw"], group["actual_mw"]))
        for key, group in frame.groupby(group_key, sort=True, observed=True)
    ]
    return pd.DataFrame(rows)


def metrics_by_delivery_date(aligned: pd.DataFrame) -> pd.DataFrame:
    """Metrics per GB local delivery date (23 or 25 hours on clock-change days)."""
    local_date = aligned.index.tz_convert(GB_TIME).date
    return _metrics_table(aligned, pd.Series(local_date, index=aligned.index), "delivery_date")


def forecast_versions(
    forecasts: pd.DataFrame,
    actual_mw: pd.Series,
    hours: pd.DatetimeIndex,
    cutoff: datetime,
    per_hour_cutoffs: pd.Series | None = None,
) -> pd.DataFrame:
    """Every valid forecast version published by the cutoff for the given hours, with its actual."""
    usable = _usable(forecasts, cutoff, per_hour_cutoffs)
    usable = usable[usable["start_time"].isin(hours)].drop_duplicates(["start_time", "publish_time"])
    versions = pd.DataFrame(
        {
            "start_time": usable["start_time"].dt.tz_convert("UTC"),
            "publish_time": usable["publish_time"].dt.tz_convert("UTC"),
            "forecast_mw": usable["generation_mw"].astype(float),
        }
    )
    versions["lead_hours"] = (versions["start_time"] - versions["publish_time"]) / HOUR
    versions["actual_mw"] = versions["start_time"].map(actual_mw)
    versions["lead_bucket"] = pd.cut(
        versions["lead_hours"], LEAD_TIME_EDGES_HOURS, right=False, labels=LEAD_TIME_LABELS
    )
    return versions.reset_index(drop=True)


def metrics_by_lead_time(versions: pd.DataFrame) -> pd.DataFrame:
    """Accuracy per lead-time bucket over all forecast versions.

    Each delivery hour contributes one row per version in the bucket, so buckets are not
    independent samples and their counts differ. missing_actual counts versions whose delivery
    hour has no complete actual.
    """
    table = _metrics_table(versions, versions["lead_bucket"], "lead_bucket")
    return table.astype({"lead_bucket": str}) if not table.empty else table


def analyse(
    actuals: pd.DataFrame,
    forecasts: pd.DataFrame,
    start: datetime,
    end: datetime,
    cutoff: datetime,
    per_hour_cutoffs: pd.Series | None = None,
) -> AnalysisResult:
    """Forecast-vs-actual analysis for delivery hours in [start, end) as known at the cutoff.

    With `per_hour_cutoffs`, each delivery hour is judged on what was known at its own cutoff
    and `cutoff` is the latest of them.
    """
    hours = delivery_hours(start, end)
    actual_mw = hourly_actuals(actuals)
    aligned = align(select_forecasts_at_cutoff(forecasts, cutoff, per_hour_cutoffs), actual_mw, hours)
    versions = forecast_versions(forecasts, actual_mw, hours, cutoff, per_hour_cutoffs)
    return AnalysisResult(
        cutoff=cutoff,
        hourly=aligned,
        overall=error_metrics(aligned["forecast_mw"], aligned["actual_mw"]),
        by_delivery_date=metrics_by_delivery_date(aligned),
        by_lead_time=metrics_by_lead_time(versions),
    )
