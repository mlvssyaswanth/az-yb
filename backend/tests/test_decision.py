import pandas as pd

from app.services.decision import DAY_AHEAD_DECISION_HOUR, day_ahead_cutoffs


def hours(*values: str) -> pd.DatetimeIndex:
    return pd.DatetimeIndex(pd.to_datetime(list(values), utc=True))


def test_decision_is_noon_uk_time() -> None:
    assert DAY_AHEAD_DECISION_HOUR == 12


def test_every_hour_of_a_day_shares_noon_the_day_before() -> None:
    cutoffs = day_ahead_cutoffs(hours("2026-01-10T00:00Z", "2026-01-10T12:00Z", "2026-01-10T23:00Z"))

    assert set(cutoffs) == {pd.Timestamp("2026-01-09T12:00Z")}


def test_the_next_delivery_date_gets_the_next_cutoff() -> None:
    cutoffs = day_ahead_cutoffs(hours("2026-01-10T23:00Z", "2026-01-11T00:00Z"))

    assert list(cutoffs) == [pd.Timestamp("2026-01-09T12:00Z"), pd.Timestamp("2026-01-10T12:00Z")]


def test_summer_delivery_dates_use_the_uk_date_and_noon_bst() -> None:
    # 23:00Z on 9 July is 00:00 BST on 10 July, so it belongs to the 10th and decides at noon BST (11:00Z) on the 9th.
    cutoffs = day_ahead_cutoffs(hours("2026-07-09T23:00Z", "2026-07-10T23:00Z"))

    assert list(cutoffs) == [pd.Timestamp("2026-07-09T11:00Z"), pd.Timestamp("2026-07-10T11:00Z")]


def test_the_result_is_indexed_by_delivery_hour() -> None:
    index = hours("2026-01-10T00:00Z", "2026-01-10T01:00Z")

    assert day_ahead_cutoffs(index).index.equals(index)
