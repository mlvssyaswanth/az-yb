from datetime import UTC, datetime, timedelta, timezone

import pandas as pd
import pytest

from app.services.horizon import horizon, published_by, valid_horizon_mask

DELIVERY = pd.Timestamp("2026-01-10T12:00:00Z")


def forecast_with_lead(hours: float) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "start_time": [DELIVERY],
            "publish_time": [DELIVERY - pd.Timedelta(hours=hours)],
            "generation_mw": [10_000],
        }
    )


@pytest.mark.parametrize(
    ("lead_hours", "is_valid"),
    [
        (-0.5, False),  # published after delivery began
        (0, True),  # published exactly at the start of delivery
        (66, True),
        (66.5, True),  # inclusive upper boundary
        (67, False),
    ],
)
def test_horizon_bounds(lead_hours: float, is_valid: bool) -> None:
    assert valid_horizon_mask(forecast_with_lead(lead_hours)).item() is is_valid


def test_horizon_uses_absolute_time_across_utc_offsets() -> None:
    # 14:00+02:00 is 12:00Z, so this is a 2 h horizon, not 4 h.
    start = pd.Series(pd.to_datetime(["2026-01-10T14:00:00+02:00"]))
    publish = pd.Series(pd.to_datetime(["2026-01-10T10:00:00Z"]))
    assert horizon(start, publish).item() == pd.Timedelta(hours=2)


def test_naive_timestamps_are_rejected() -> None:
    naive = pd.DataFrame(
        {"start_time": [datetime(2026, 1, 10, 12)], "publish_time": [datetime(2026, 1, 10, 6)]}
    )
    with pytest.raises(ValueError, match="timezone-aware"):
        valid_horizon_mask(naive)


def test_published_by_keeps_forecasts_published_at_the_cutoff() -> None:
    forecasts = pd.concat([forecast_with_lead(6), forecast_with_lead(3)], ignore_index=True)
    cutoff = (DELIVERY - pd.Timedelta(hours=6)).to_pydatetime()

    available = published_by(forecasts, cutoff)

    assert available["publish_time"].tolist() == [DELIVERY - pd.Timedelta(hours=6)]


def test_published_by_still_applies_the_horizon_rule() -> None:
    forecasts = pd.concat([forecast_with_lead(67), forecast_with_lead(-0.5)], ignore_index=True)
    assert published_by(forecasts, datetime(2026, 2, 1, tzinfo=UTC)).empty


def test_published_by_compares_cutoffs_in_absolute_time() -> None:
    forecasts = forecast_with_lead(6)  # published 06:00Z
    cutoff_in_other_zone = datetime(2026, 1, 10, 7, tzinfo=timezone(timedelta(hours=1)))  # 06:00Z
    assert len(published_by(forecasts, cutoff_in_other_zone)) == 1


def test_published_by_rejects_naive_cutoff() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        published_by(forecast_with_lead(6), datetime(2026, 1, 10, 6))
