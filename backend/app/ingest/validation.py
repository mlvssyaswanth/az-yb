"""Validates raw Elexon records and normalises their timestamps to UTC.

Each record either becomes a row or is rejected with a reason; one bad record never stops
an ingestion run. Reasons are short fixed strings so they can be counted and logged.
"""
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pandas as pd

from app.timezones import GB_TIME

ACTUAL_COLUMNS = ["start_time", "fuel_type", "settlement_date", "settlement_period", "generation_mw", "publish_time"]
FORECAST_COLUMNS = ["start_time", "publish_time", "generation_mw"]

# GB wind capacity is about 30 GW; anything above this is a corrupt value, not a measurement. It also
# keeps a bad value from overflowing the 32-bit generation_mw column and failing the whole load.
MAX_PLAUSIBLE_MW = 100_000


class InvalidRecord(ValueError):
    pass


@dataclass
class ValidationResult:
    rows: pd.DataFrame
    rejected: Counter[str] = field(default_factory=Counter)


def parse_utc(record: dict[str, Any], name: str) -> datetime:
    """Parse an ISO 8601 timestamp that carries its own UTC offset, returned in UTC.

    Timestamps without an offset are rejected rather than guessed, because GB local time
    and UTC differ by an hour for half the year.
    """
    value = record.get(name)
    if not isinstance(value, str):
        raise InvalidRecord(f"{name}: missing")
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise InvalidRecord(f"{name}: not an ISO 8601 timestamp") from None
    if moment.tzinfo is None:
        raise InvalidRecord(f"{name}: no UTC offset")
    return moment.astimezone(UTC)


def whole_megawatts(record: dict[str, Any]) -> int:
    value = record.get("generation")
    # bool is a subclass of int, so exclude it explicitly.
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise InvalidRecord("generation: missing or not a number")
    if isinstance(value, float) and not value.is_integer():
        raise InvalidRecord("generation: not a whole number of MW")
    if value < 0:
        raise InvalidRecord("generation: negative")
    if value > MAX_PLAUSIBLE_MW:
        raise InvalidRecord("generation: implausibly large")
    return int(value)


def settlement_period_start(settlement_date: date, settlement_period: int) -> datetime:
    """UTC start of a GB settlement period. Period 1 starts at local midnight; on clock-change
    days the day has 46 or 50 periods, which counting from local midnight in UTC handles."""
    local_midnight = datetime.combine(settlement_date, time(), tzinfo=GB_TIME)
    return local_midnight.astimezone(UTC) + timedelta(minutes=30 * (settlement_period - 1))


def _actual_row(record: dict[str, Any]) -> dict[str, Any]:
    if record.get("fuelType") != "WIND":
        raise InvalidRecord("fuelType: not WIND")
    start_time = parse_utc(record, "startTime")
    publish_time = parse_utc(record, "publishTime")

    raw_date, period = record.get("settlementDate"), record.get("settlementPeriod")
    if not isinstance(raw_date, str):
        raise InvalidRecord("settlementDate: missing")
    try:
        settlement_date = date.fromisoformat(raw_date)
    except ValueError:
        raise InvalidRecord("settlementDate: not a date") from None
    if isinstance(period, bool) or not isinstance(period, int) or not 1 <= period <= 50:
        raise InvalidRecord("settlementPeriod: not an integer from 1 to 50")
    # Cross-checks the two ways the source identifies the half-hour.
    if start_time != settlement_period_start(settlement_date, period):
        raise InvalidRecord("startTime: does not match settlementDate and settlementPeriod")

    return {
        "start_time": start_time,
        "fuel_type": "WIND",
        "settlement_date": settlement_date,
        "settlement_period": period,
        "generation_mw": whole_megawatts(record),
        "publish_time": publish_time,
    }


def _forecast_row(record: dict[str, Any]) -> dict[str, Any]:
    start_time = parse_utc(record, "startTime")
    if (start_time.minute, start_time.second, start_time.microsecond) != (0, 0, 0):
        raise InvalidRecord("startTime: not on the hour")
    return {
        "start_time": start_time,
        "publish_time": parse_utc(record, "publishTime"),
        "generation_mw": whole_megawatts(record),
    }


def _validate(
    records: list[Any], to_row: Callable[[dict[str, Any]], dict[str, Any]], columns: list[str]
) -> ValidationResult:
    rows: list[dict[str, Any]] = []
    rejected: Counter[str] = Counter()
    for record in records:
        try:
            if not isinstance(record, dict):
                raise InvalidRecord("record: not an object")
            rows.append(to_row(record))
        except InvalidRecord as reason:
            rejected[str(reason)] += 1

    frame = pd.DataFrame(rows, columns=columns)
    # Explicit conversion keeps the UTC dtype even when every record was rejected.
    for column in ("start_time", "publish_time"):
        frame[column] = pd.to_datetime(frame[column], utc=True)
    return ValidationResult(rows=frame, rejected=rejected)


def validate_actuals(records: list[Any]) -> ValidationResult:
    return _validate(records, _actual_row, ACTUAL_COLUMNS)


def validate_forecasts(records: list[Any]) -> ValidationResult:
    return _validate(records, _forecast_row, FORECAST_COLUMNS)
