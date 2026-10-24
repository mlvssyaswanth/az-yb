import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from app.ingest.validation import settlement_period_start, validate_actuals, validate_forecasts

FIXTURES = Path(__file__).parent / "fixtures"


def actual(**overrides: Any) -> dict[str, Any]:
    record = {
        "dataset": "FUELHH",
        "publishTime": "2026-01-10T12:30:00Z",
        "startTime": "2026-01-10T12:00:00Z",
        "settlementDate": "2026-01-10",
        "settlementPeriod": 25,
        "fuelType": "WIND",
        "generation": 15000,
    }
    return record | overrides


def forecast(**overrides: Any) -> dict[str, Any]:
    record = {
        "dataset": "WINDFOR",
        "publishTime": "2026-01-10T06:30:00Z",
        "startTime": "2026-01-10T12:00:00Z",
        "generation": 14000,
    }
    return record | overrides


def without(record: dict[str, Any], field: str) -> dict[str, Any]:
    return {key: value for key, value in record.items() if key != field}


class TestRealResponses:
    def test_actuals_fixture_is_fully_valid(self) -> None:
        result = validate_actuals(json.loads((FIXTURES / "fuelhh_wind_2026-01-10.json").read_text()))
        assert not result.rejected
        assert len(result.rows) == 12
        assert set(result.rows["start_time"].dt.minute) == {0, 30}

    def test_forecasts_fixture_is_fully_valid(self) -> None:
        result = validate_forecasts(json.loads((FIXTURES / "windfor_2026-01-10.json").read_text()))
        assert not result.rejected
        assert len(result.rows) == 12
        assert str(result.rows["publish_time"].dt.tz) == "UTC"


class TestInvalidRecords:
    @pytest.mark.parametrize(
        ("record", "reason"),
        [
            (without(actual(), "generation"), "generation: missing or not a number"),
            (actual(generation="15000"), "generation: missing or not a number"),
            (actual(generation=None), "generation: missing or not a number"),
            (actual(generation=True), "generation: missing or not a number"),
            (actual(generation=-5), "generation: negative"),
            (actual(generation=15000.5), "generation: not a whole number of MW"),
            (actual(fuelType="CCGT"), "fuelType: not WIND"),
            (without(actual(), "startTime"), "startTime: missing"),
            (actual(startTime="10/01/2026 12:00"), "startTime: not an ISO 8601 timestamp"),
            (actual(settlementDate="2026-02-30"), "settlementDate: not a date"),
            (actual(settlementPeriod=0), "settlementPeriod: not an integer from 1 to 50"),
            (actual(settlementPeriod="25"), "settlementPeriod: not an integer from 1 to 50"),
            (actual(settlementPeriod=26), "startTime: does not match settlementDate and settlementPeriod"),
        ],
    )
    def test_invalid_actual_is_rejected_with_reason(self, record: dict[str, Any], reason: str) -> None:
        result = validate_actuals([record])
        assert result.rows.empty
        assert result.rejected == {reason: 1}

    @pytest.mark.parametrize(
        ("record", "reason"),
        [
            (without(forecast(), "publishTime"), "publishTime: missing"),
            (forecast(startTime="2026-01-10T12:30:00Z"), "startTime: not on the hour"),
            (forecast(generation=-1), "generation: negative"),
        ],
    )
    def test_invalid_forecast_is_rejected_with_reason(self, record: dict[str, Any], reason: str) -> None:
        assert validate_forecasts([record]).rejected == {reason: 1}

    def test_non_object_records_are_rejected(self) -> None:
        assert validate_forecasts(["oops", None]).rejected == {"record: not an object": 2}

    def test_bad_records_do_not_affect_good_ones(self) -> None:
        result = validate_forecasts([forecast(), forecast(generation=None), forecast(startTime="2026-01-10T13:00:00Z")])
        assert len(result.rows) == 2
        assert result.rejected.total() == 1

    def test_whole_number_floats_are_accepted(self) -> None:
        assert validate_forecasts([forecast(generation=14000.0)]).rows["generation_mw"].item() == 14000

    def test_all_rejected_still_yields_utc_columns(self) -> None:
        rows = validate_forecasts([forecast(generation=None)]).rows
        assert rows.empty
        assert str(rows["start_time"].dt.tz) == "UTC"


class TestTimestamps:
    def test_offsets_are_normalised_to_utc(self) -> None:
        rows = validate_forecasts([forecast(startTime="2026-01-10T13:00:00+01:00", publishTime="2026-01-10T06:30:00Z")]).rows
        assert rows["start_time"].item() == pd.Timestamp("2026-01-10T12:00:00Z")
        assert str(rows["start_time"].dt.tz) == "UTC"

    def test_on_the_hour_is_checked_after_normalising(self) -> None:
        # 12:30+05:30 is 07:00Z, so it is on the hour.
        rows = validate_forecasts([forecast(startTime="2026-01-10T12:30:00+05:30", publishTime="2026-01-10T01:00:00Z")]).rows
        assert rows["start_time"].item() == pd.Timestamp("2026-01-10T07:00:00Z")

    def test_timestamp_without_offset_is_rejected_not_assumed_utc(self) -> None:
        assert validate_forecasts([forecast(publishTime="2026-01-10T06:30:00")]).rejected == {"publishTime: no UTC offset": 1}

    @pytest.mark.parametrize(
        ("settlement_date", "period", "expected_utc"),
        [
            (date(2026, 1, 10), 1, datetime(2026, 1, 10, 0, 0, tzinfo=UTC)),  # GMT: local = UTC
            (date(2026, 1, 10), 48, datetime(2026, 1, 10, 23, 30, tzinfo=UTC)),
            (date(2026, 3, 29), 3, datetime(2026, 3, 29, 1, 0, tzinfo=UTC)),  # clocks go forward: 46 periods
            (date(2026, 3, 29), 46, datetime(2026, 3, 29, 22, 30, tzinfo=UTC)),  # last period: 23:30 BST
            (date(2026, 7, 1), 1, datetime(2026, 6, 30, 23, 0, tzinfo=UTC)),  # BST: local midnight is 23:00Z
            (date(2026, 10, 25), 50, datetime(2026, 10, 25, 23, 30, tzinfo=UTC)),  # clocks go back: 50 periods
        ],
    )
    def test_settlement_periods_map_to_utc_across_clock_changes(
        self, settlement_date: date, period: int, expected_utc: datetime
    ) -> None:
        assert settlement_period_start(settlement_date, period) == expected_utc

    def test_bst_actual_is_accepted_when_start_time_matches(self) -> None:
        record = actual(startTime="2026-06-30T23:00:00Z", settlementDate="2026-07-01", settlementPeriod=1)
        assert not validate_actuals([record]).rejected


def test_an_implausibly_large_generation_is_rejected_not_stored() -> None:
    result = validate_actuals([actual(generation=3_000_000_000)])

    assert result.rows.empty
    assert result.rejected == {"generation: implausibly large": 1}


def test_generation_at_the_ceiling_is_accepted() -> None:
    assert len(validate_forecasts([forecast(generation=100_000)]).rows) == 1
    assert validate_forecasts([forecast(generation=100_001)]).rows.empty
