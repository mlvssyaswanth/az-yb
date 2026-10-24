import math
from datetime import UTC, datetime, timedelta, timezone

import pandas as pd
import pytest

from app.services.analysis import (
    analyse,
    delivery_hours,
    error_metrics,
    forecast_versions,
    hourly_actuals,
    metrics_by_delivery_date,
    metrics_by_lead_time,
    select_forecasts_at_cutoff,
)

T = pd.Timestamp  # all literals below carry an explicit offset


def forecasts(*rows: tuple[str, str, float]) -> pd.DataFrame:
    """Rows of (start_time, publish_time, generation_mw)."""
    frame = pd.DataFrame(rows, columns=["start_time", "publish_time", "generation_mw"])
    frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True, format="ISO8601")
    frame["publish_time"] = pd.to_datetime(frame["publish_time"], utc=True, format="ISO8601")
    return frame


def actuals(*rows: tuple[str, float], published: str = "2026-01-20T00:00:00Z") -> pd.DataFrame:
    """Half-hourly rows of (start_time, generation_mw)."""
    frame = pd.DataFrame(rows, columns=["start_time", "generation_mw"])
    frame["start_time"] = pd.to_datetime(frame["start_time"], utc=True, format="ISO8601")
    frame["publish_time"] = T(published)
    return frame


def both_half_hours(hour: str, first: float, second: float) -> list[tuple[str, float]]:
    start = T(hour)
    return [(str(start), first), (str(start + timedelta(minutes=30)), second)]


CUTOFF = datetime(2026, 1, 10, 6, 0, tzinfo=UTC)


class TestCutoffSelection:
    def test_latest_forecast_at_or_before_cutoff_is_selected(self) -> None:
        versions = forecasts(
            ("2026-01-10T12:00Z", "2026-01-10T00:30Z", 100),
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
            ("2026-01-10T12:00Z", "2026-01-10T06:00Z", 300),  # exactly at the cutoff: usable
            ("2026-01-10T12:00Z", "2026-01-10T06:30Z", 999),  # after the cutoff: never used
        )

        selected = select_forecasts_at_cutoff(versions, CUTOFF)

        assert selected.loc[T("2026-01-10T12:00Z"), "forecast_mw"] == 300
        assert selected.loc[T("2026-01-10T12:00Z"), "lead_hours"] == 6

    def test_hour_with_only_later_forecasts_has_no_selection(self) -> None:
        versions = forecasts(("2026-01-10T12:00Z", "2026-01-10T09:30Z", 999))
        assert select_forecasts_at_cutoff(versions, CUTOFF).empty

    def test_forecast_published_after_delivery_started_is_not_used(self) -> None:
        # Published before the cutoff but 30 minutes into its delivery hour: invalid horizon.
        versions = forecasts(
            ("2026-01-10T03:00Z", "2026-01-10T00:30Z", 100),
            ("2026-01-10T03:00Z", "2026-01-10T03:30Z", 999),
        )
        assert select_forecasts_at_cutoff(versions, CUTOFF)["forecast_mw"].tolist() == [100]

    def test_input_order_does_not_matter(self) -> None:
        versions = forecasts(
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
            ("2026-01-10T11:00Z", "2026-01-10T00:30Z", 50),
            ("2026-01-10T12:00Z", "2026-01-10T00:30Z", 100),
        )
        shuffled = versions.sample(frac=1, random_state=7)
        pd.testing.assert_frame_equal(
            select_forecasts_at_cutoff(versions, CUTOFF), select_forecasts_at_cutoff(shuffled, CUTOFF)
        )

    def test_cutoff_in_another_time_zone_is_the_same_instant(self) -> None:
        versions = forecasts(("2026-01-10T12:00Z", "2026-01-10T06:00Z", 300))
        cutoff_at_06z = datetime(2026, 1, 10, 7, 0, tzinfo=timezone(timedelta(hours=1)))
        assert len(select_forecasts_at_cutoff(versions, cutoff_at_06z)) == 1

    def test_naive_cutoff_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            select_forecasts_at_cutoff(forecasts(), datetime(2026, 1, 10, 6))

    def test_duplicate_versions_yield_one_row(self) -> None:
        versions = forecasts(
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
        )
        assert len(select_forecasts_at_cutoff(versions, CUTOFF)) == 1


class TestHourlyActuals:
    def test_hourly_value_is_mean_of_both_half_hours(self) -> None:
        hourly = hourly_actuals(actuals(*both_half_hours("2026-01-10T12:00Z", 100, 200)))
        assert hourly.to_dict() == {T("2026-01-10T12:00Z"): 150}

    def test_hour_with_one_half_hour_is_missing_not_halved(self) -> None:
        hourly = hourly_actuals(actuals(("2026-01-10T12:00Z", 100), *both_half_hours("2026-01-10T13:00Z", 1, 3)))
        assert hourly.to_dict() == {T("2026-01-10T13:00Z"): 2}

    def test_repeated_half_hour_uses_latest_publication(self) -> None:
        older = actuals(*both_half_hours("2026-01-10T12:00Z", 100, 200), published="2026-01-10T13:00Z")
        newer = actuals(("2026-01-10T12:30Z", 400), published="2026-01-10T14:00Z")
        hourly = hourly_actuals(pd.concat([newer, older]))
        assert hourly.to_dict() == {T("2026-01-10T12:00Z"): 250}

    def test_offsets_are_normalised_before_grouping_into_hours(self) -> None:
        # 13:00+01:00 and 13:30+01:00 are the two half-hours of the 12:00Z hour.
        frame = pd.DataFrame(
            {
                "start_time": pd.to_datetime(["2026-07-01T13:00:00+01:00", "2026-07-01T13:30:00+01:00"]),
                "generation_mw": [100, 300],
            }
        )
        assert hourly_actuals(frame).to_dict() == {T("2026-07-01T12:00Z"): 200}


class TestMetrics:
    def test_known_values(self) -> None:
        metrics = error_metrics(pd.Series([110.0, 90.0, 100.0]), pd.Series([100.0, 100.0, 100.0]))
        assert metrics.matched_intervals == 3
        assert metrics.mae_mw == pytest.approx(20 / 3)
        assert metrics.rmse_mw == pytest.approx(math.sqrt(200 / 3))
        assert metrics.bias_mw == 0
        assert metrics.mape_percent == pytest.approx(20 / 3)

    def test_bias_sign_is_forecast_minus_actual(self) -> None:
        assert error_metrics(pd.Series([120.0]), pd.Series([100.0])).bias_mw == 20
        assert error_metrics(pd.Series([80.0]), pd.Series([100.0])).bias_mw == -20

    def test_unmatched_rows_do_not_contribute(self) -> None:
        metrics = error_metrics(pd.Series([110.0, None, 5000.0]), pd.Series([100.0, 100.0, None]))
        assert (metrics.expected_intervals, metrics.matched_intervals) == (3, 1)
        assert (metrics.missing_forecast, metrics.missing_actual) == (1, 1)
        assert metrics.coverage == pytest.approx(1 / 3)
        assert metrics.mae_mw == 10

    def test_no_matched_rows_gives_no_metrics(self) -> None:
        metrics = error_metrics(pd.Series([110.0, None]), pd.Series([None, 100.0]))
        assert metrics.matched_intervals == 0
        assert (metrics.mae_mw, metrics.rmse_mw, metrics.bias_mw, metrics.mape_percent) == (None, None, None, None)

    def test_mape_skips_zero_actuals_and_reports_its_basis(self) -> None:
        metrics = error_metrics(pd.Series([50.0, 110.0]), pd.Series([0.0, 100.0]))
        assert metrics.mae_mw == 30  # the zero-actual hour still counts for MAE
        assert metrics.mape_percent == 10
        assert metrics.mape_intervals == 1

    def test_mape_is_none_when_every_actual_is_zero(self) -> None:
        metrics = error_metrics(pd.Series([50.0]), pd.Series([0.0]))
        assert (metrics.mape_percent, metrics.mape_intervals) == (None, 0)


class TestAnalyse:
    def test_alignment_is_by_timestamp_with_gaps_reported(self) -> None:
        start, end = datetime(2026, 1, 10, 12, tzinfo=UTC), datetime(2026, 1, 10, 16, tzinfo=UTC)
        versions = forecasts(
            ("2026-01-10T14:00Z", "2026-01-10T03:30Z", 300),  # 13:00 has no forecast
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 110),
            ("2026-01-10T15:00Z", "2026-01-10T03:30Z", 500),
        )
        observed = actuals(
            *both_half_hours("2026-01-10T15:00Z", 400, 400),
            *both_half_hours("2026-01-10T12:00Z", 100, 100),
            ("2026-01-10T14:00Z", 999),  # incomplete hour: missing actual
        )

        result = analyse(observed, versions, start, end, CUTOFF)

        hourly = result.hourly
        assert list(hourly.index) == [T(f"2026-01-10T{h}:00Z") for h in (12, 13, 14, 15)]
        assert hourly["error_mw"].tolist()[0] == 10
        assert hourly["error_mw"].tolist()[3] == 100
        assert hourly["error_mw"].isna().tolist() == [False, True, True, False]
        assert result.overall.matched_intervals == 2
        assert (result.overall.missing_forecast, result.overall.missing_actual) == (1, 2)
        assert result.overall.mae_mw == 55
        assert result.overall.coverage == 0.5

    def test_window_bounds_must_be_aware_and_on_the_hour(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            delivery_hours(datetime(2026, 1, 1), datetime(2026, 1, 2, tzinfo=UTC))
        with pytest.raises(ValueError, match="on the hour"):
            delivery_hours(datetime(2026, 1, 1, 0, 30, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC))


class TestDeliveryDates:
    @pytest.mark.parametrize(
        ("local_date", "start_utc", "end_utc", "hours"),
        [
            ("2026-01-10", "2026-01-10T00:00Z", "2026-01-11T00:00Z", 24),  # GMT
            ("2026-03-29", "2026-03-29T00:00Z", "2026-03-29T23:00Z", 23),  # clocks go forward
            ("2026-10-25", "2026-10-24T23:00Z", "2026-10-26T00:00Z", 25),  # clocks go back
        ],
    )
    def test_dates_are_gb_local_days(self, local_date: str, start_utc: str, end_utc: str, hours: int) -> None:
        index = delivery_hours(T(start_utc), T(end_utc))
        aligned = pd.DataFrame({"forecast_mw": 1.0, "actual_mw": 1.0}, index=index)

        by_date = metrics_by_delivery_date(aligned)

        assert by_date["delivery_date"].astype(str).tolist() == [local_date]
        assert by_date["expected_intervals"].tolist() == [hours]

    def test_hours_split_across_local_dates_in_summer(self) -> None:
        # 22:00Z and 23:00Z on 30 June are 23:00 BST on 30 June and 00:00 BST on 1 July.
        index = delivery_hours(T("2026-06-30T22:00Z"), T("2026-07-01T00:00Z"))
        aligned = pd.DataFrame({"forecast_mw": 1.0, "actual_mw": 1.0}, index=index)
        assert metrics_by_delivery_date(aligned)["delivery_date"].astype(str).tolist() == ["2026-06-30", "2026-07-01"]


class TestLeadTime:
    def test_every_version_by_the_cutoff_is_bucketed_by_lead_time(self) -> None:
        hours = delivery_hours(T("2026-01-12T12:00Z"), T("2026-01-12T13:00Z"))
        delivery = "2026-01-12T12:00Z"
        versions = forecasts(
            (delivery, "2026-01-12T12:00Z", 100),  # 0 h
            (delivery, "2026-01-12T06:00Z", 100),  # 6 h: second bucket
            (delivery, "2026-01-10T06:00Z", 100),  # 54 h
            (delivery, "2026-01-09T21:30Z", 100),  # 62.5 h
        )
        actual_mw = hourly_actuals(actuals(*both_half_hours(delivery, 90, 90)))

        table = metrics_by_lead_time(forecast_versions(versions, actual_mw, hours, datetime(2026, 1, 12, 12, tzinfo=UTC)))

        assert table[["lead_bucket", "matched_intervals"]].values.tolist() == [
            ["0-6 h", 1],
            ["6-12 h", 1],
            ["48-66.5 h", 2],
        ]
        assert table["bias_mw"].tolist() == [10, 10, 10]

    def test_versions_after_the_cutoff_are_excluded(self) -> None:
        hours = delivery_hours(T("2026-01-12T12:00Z"), T("2026-01-12T13:00Z"))
        versions = forecasts(
            ("2026-01-12T12:00Z", "2026-01-12T00:30Z", 100),
            ("2026-01-12T12:00Z", "2026-01-12T09:30Z", 100),
        )
        table = forecast_versions(versions, pd.Series(dtype=float), hours, datetime(2026, 1, 12, 6, tzinfo=UTC))
        assert table["publish_time"].tolist() == [T("2026-01-12T00:30Z")]


class TestPerHourCutoffs:
    """A cutoff per delivery hour, as the day-ahead rule needs (each day decides at its own time)."""

    def test_each_hour_uses_its_own_cutoff(self) -> None:
        versions = forecasts(
            ("2026-01-10T12:00Z", "2026-01-10T00:30Z", 100),
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
            ("2026-01-10T13:00Z", "2026-01-10T00:30Z", 300),
            ("2026-01-10T13:00Z", "2026-01-10T03:30Z", 400),
        )
        per_hour = pd.Series(
            [T("2026-01-10T02:00Z"), T("2026-01-10T04:00Z")], index=pd.DatetimeIndex([T("2026-01-10T12:00Z"), T("2026-01-10T13:00Z")])
        )

        selected = select_forecasts_at_cutoff(versions, datetime(2026, 1, 10, 4, tzinfo=UTC), per_hour)

        assert selected["forecast_mw"].tolist() == [100.0, 400.0]

    def test_versions_respect_each_hours_cutoff(self) -> None:
        versions = forecasts(
            ("2026-01-10T12:00Z", "2026-01-10T00:30Z", 100),
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
        )
        hours = delivery_hours(datetime(2026, 1, 10, 12, tzinfo=UTC), datetime(2026, 1, 10, 13, tzinfo=UTC))
        per_hour = pd.Series([T("2026-01-10T02:00Z")], index=hours)

        result = forecast_versions(versions, pd.Series(dtype=float), hours, datetime(2026, 1, 10, 4, tzinfo=UTC), per_hour)

        assert result["forecast_mw"].tolist() == [100.0]

    def test_analyse_applies_the_per_hour_cutoffs(self) -> None:
        versions = forecasts(
            ("2026-01-10T12:00Z", "2026-01-10T00:30Z", 100),
            ("2026-01-10T12:00Z", "2026-01-10T03:30Z", 200),
        )
        actual = actuals(*both_half_hours("2026-01-10T12:00Z", 90, 90))
        start, end = datetime(2026, 1, 10, 12, tzinfo=UTC), datetime(2026, 1, 10, 13, tzinfo=UTC)
        per_hour = pd.Series([T("2026-01-10T02:00Z")], index=delivery_hours(start, end))

        result = analyse(actual, versions, start, end, datetime(2026, 1, 10, 2, tzinfo=UTC), per_hour)

        assert result.hourly["forecast_mw"].tolist() == [100.0]
        assert result.overall.bias_mw == 10.0
