from datetime import UTC, datetime

import pandas as pd
import pytest

from app.ingest.elexon_client import to_utc_string
from app.ingest.load import Window, select_actuals, select_forecasts

JANUARY = Window(datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC))


def test_select_forecasts_applies_horizon_rule_and_window() -> None:
    delivery = pd.Timestamp("2026-01-05T12:00:00Z")
    rows = [
        (delivery, delivery + pd.Timedelta(hours=0.5)),  # -0.5 h: filtered
        (delivery, delivery),  # 0 h: kept
        (delivery, delivery - pd.Timedelta(hours=66)),  # kept
        (delivery, delivery - pd.Timedelta(hours=66.5)),  # boundary: kept
        (delivery, delivery - pd.Timedelta(hours=67)),  # filtered
        (pd.Timestamp("2025-12-31T23:00:00Z"), pd.Timestamp("2025-12-31T12:00:00Z")),  # December: filtered
        (pd.Timestamp("2026-02-01T00:00:00Z"), pd.Timestamp("2026-01-31T12:00:00Z")),  # February: filtered
    ]
    forecasts = pd.DataFrame(rows, columns=["start_time", "publish_time"]).assign(generation_mw=1)

    selection = select_forecasts(forecasts, JANUARY)

    kept_leads = (selection.rows["start_time"] - selection.rows["publish_time"]) / pd.Timedelta(hours=1)
    assert sorted(kept_leads) == [0, 66, 66.5]
    assert selection.filtered == {"delivery outside window": 2, "horizon outside 0-66.5 h": 2}


def test_select_forecasts_removes_duplicate_versions() -> None:
    delivery = pd.Timestamp("2026-01-05T12:00:00Z")
    published = delivery - pd.Timedelta(hours=6)
    forecasts = pd.DataFrame(
        {"start_time": [delivery, delivery], "publish_time": [published, published], "generation_mw": [1, 1]}
    )

    selection = select_forecasts(forecasts, JANUARY)

    assert len(selection.rows) == 1
    assert selection.filtered == {"duplicate in download": 1}


def test_select_actuals_keeps_latest_publication_of_a_repeated_half_hour() -> None:
    start = pd.Timestamp("2026-01-05T12:00:00Z")
    actuals = pd.DataFrame(
        {
            "start_time": [start, start, start + pd.Timedelta(minutes=30)],
            "fuel_type": ["WIND"] * 3,
            "generation_mw": [9300, 9200, 9400],
            "publish_time": pd.to_datetime(
                ["2026-01-05T13:00:00Z", "2026-01-05T12:30:00Z", "2026-01-05T13:00:00Z"], utc=True
            ),
        }
    )

    selection = select_actuals(actuals, JANUARY)

    assert selection.rows.sort_values("start_time")["generation_mw"].tolist() == [9300, 9400]
    assert selection.filtered == {"duplicate in download": 1}


def test_elexon_timestamps_are_sent_in_utc() -> None:
    assert to_utc_string(datetime(2026, 1, 1, tzinfo=UTC)) == "2026-01-01T00:00:00Z"
    with pytest.raises(ValueError):
        to_utc_string(datetime(2026, 1, 1))


def test_a_response_that_is_not_a_list_is_an_error() -> None:
    import httpx

    from app.ingest.elexon_client import ElexonClient, UnexpectedResponse

    client = ElexonClient("http://elexon.test")
    client._http = httpx.Client(
        base_url="http://elexon.test",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"error": "rate limited"})),
    )

    with pytest.raises(UnexpectedResponse, match="expected a list"):
        client.fetch_wind_actuals(datetime(2026, 1, 1).date(), datetime(2026, 1, 2).date())
