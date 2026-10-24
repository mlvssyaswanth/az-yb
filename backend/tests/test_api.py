# covers: errors, forecast_rules, forecasts, schemas, timezones (exercised through the HTTP API)
"""API tests against the database, using hand-checkable March 2026 rows that are rolled back.

Seeded data, delivery hours 00:00-03:00Z on 2 March 2026:
    hour   actual half-hours   hourly actual   forecasts (published -> MW)
    00:00  9000, 9200          9100            18:30Z -> 9000, 21:30Z -> 9500
    01:00  8200, 8400          8300            18:30Z -> 8000
    02:00  7000, (missing)     missing         21:30Z -> 7000
"""
import math
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import get_session
from app.main import app
from app.services import dashboard

WINDOW = {"start": "2026-03-02T00:00:00Z", "end": "2026-03-02T03:00:00Z"}


def seed(session: Session) -> None:
    session.execute(
        text(
            "INSERT INTO actual_generation VALUES "
            "('2026-03-02T00:00Z', 'WIND', '2026-03-02', 1, 9000, '2026-03-02T05:00Z'), "
            "('2026-03-02T00:30Z', 'WIND', '2026-03-02', 2, 9200, '2026-03-02T05:00Z'), "
            "('2026-03-02T01:00Z', 'WIND', '2026-03-02', 3, 8200, '2026-03-02T05:00Z'), "
            "('2026-03-02T01:30Z', 'WIND', '2026-03-02', 4, 8400, '2026-03-02T05:00Z'), "
            "('2026-03-02T02:00Z', 'WIND', '2026-03-02', 5, 7000, '2026-03-02T05:00Z')"
        )
    )
    session.execute(
        text(
            "INSERT INTO wind_forecast VALUES "
            "('2026-03-02T00:00Z', '2026-03-01T18:30Z', 9000), "
            "('2026-03-02T00:00Z', '2026-03-01T21:30Z', 9500), "
            "('2026-03-02T01:00Z', '2026-03-01T18:30Z', 8000), "
            "('2026-03-02T02:00Z', '2026-03-01T21:30Z', 7000)"
        )
    )


@pytest.fixture
def client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    with session_factory() as session:
        seed(session)

        def test_session() -> Iterator[Session]:
            yield session

        app.dependency_overrides[get_session] = test_session
        # raise_server_exceptions=False lets the 500 handler respond instead of re-raising.
        yield TestClient(app, raise_server_exceptions=False)
        app.dependency_overrides.clear()


def get(client: TestClient, path: str, **params: Any) -> Any:
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


class TestHealth:
    def test_ok(self, client: TestClient) -> None:
        assert get(client, "/api/health")["status"] == "ok"


class TestForecast:
    def test_latest_forecast_per_hour_with_actuals_and_errors(self, client: TestClient) -> None:
        body = get(client, "/api/forecast", **WINDOW)

        assert body["window"] == {**WINDOW, "cutoff": WINDOW["end"], "cutoff_rule": None}
        assert [
            (item["start_time"], item["forecast_mw"], item["actual_mw"], item["error_mw"], item["publish_time"])
            for item in body["items"]
        ] == [
            ("2026-03-02T00:00:00Z", 9500, 9100, 400, "2026-03-01T21:30:00Z"),
            ("2026-03-02T01:00:00Z", 8000, 8300, -300, "2026-03-01T18:30:00Z"),
            ("2026-03-02T02:00:00Z", 7000, None, None, "2026-03-01T21:30:00Z"),
        ]
        assert body["items"][0]["lead_hours"] == 2.5

    def test_summary_uses_matched_hours_only(self, client: TestClient) -> None:
        summary = get(client, "/api/forecast", **WINDOW)["summary"]

        assert (summary["expected_intervals"], summary["matched_intervals"], summary["missing_actual"]) == (3, 2, 1)
        assert summary["coverage"] == pytest.approx(2 / 3)
        assert summary["mae_mw"] == 350
        assert summary["bias_mw"] == 50
        assert summary["rmse_mw"] == pytest.approx(math.sqrt((400**2 + 300**2) / 2))

    def test_cutoff_excludes_later_publications(self, client: TestClient) -> None:
        body = get(client, "/api/forecast", **WINDOW, cutoff="2026-03-01T20:00:00Z")

        assert [item["forecast_mw"] for item in body["items"]] == [9000, 8000, None]
        assert body["summary"]["missing_forecast"] == 1

    def test_cutoff_with_utc_offset_is_normalised(self, client: TestClient) -> None:
        body = get(client, "/api/forecast", **WINDOW, cutoff="2026-03-01T21:00:00+01:00")
        assert body["window"]["cutoff"] == "2026-03-01T20:00:00Z"

    def test_pagination(self, client: TestClient) -> None:
        page_two = get(client, "/api/forecast", **WINDOW, page=2, page_size=2)
        assert page_two["pagination"] == {"page": 2, "page_size": 2, "total_items": 3, "total_pages": 2}
        assert [item["start_time"] for item in page_two["items"]] == ["2026-03-02T02:00:00Z"]
        assert page_two["summary"]["expected_intervals"] == 3  # summary covers the whole window

    def test_page_past_the_end_is_empty(self, client: TestClient) -> None:
        assert get(client, "/api/forecast", **WINDOW, page=5, page_size=2)["items"] == []


class TestAccuracy:
    def test_breakdowns(self, client: TestClient) -> None:
        body = get(client, "/api/accuracy", **WINDOW)

        assert body["overall"]["mae_mw"] == 350
        assert [(row["delivery_date"], row["matched_intervals"]) for row in body["by_delivery_date"]] == [
            ("2026-03-02", 2)
        ]
        # Every version by the cutoff: leads 5.5 h and 2.5 h for 00:00, 6.5 h for 01:00, 4.5 h for 02:00.
        by_lead = {row["lead_bucket"]: row for row in body["by_lead_time"]}
        assert list(by_lead) == ["0-6 h", "6-12 h"]
        assert (by_lead["0-6 h"]["expected_intervals"], by_lead["0-6 h"]["matched_intervals"]) == (3, 2)
        assert by_lead["0-6 h"]["bias_mw"] == 150  # errors -100 and +400
        assert by_lead["6-12 h"]["bias_mw"] == -300


class TestForecastHistory:
    def test_all_versions_in_delivery_then_publication_order(self, client: TestClient) -> None:
        body = get(client, "/api/forecast-history", **WINDOW)

        assert [(item["start_time"][11:16], item["publish_time"][11:16], item["error_mw"]) for item in body["items"]] == [
            ("00:00", "18:30", -100),
            ("00:00", "21:30", 400),
            ("01:00", "18:30", -300),
            ("02:00", "21:30", None),
        ]

    def test_single_delivery_hour(self, client: TestClient) -> None:
        body = get(client, "/api/forecast-history", start="2026-03-02T00:00:00Z", end="2026-03-02T01:00:00Z")
        assert [item["forecast_mw"] for item in body["items"]] == [9000, 9500]

    def test_cutoff_and_pagination(self, client: TestClient) -> None:
        body = get(client, "/api/forecast-history", **WINDOW, cutoff="2026-03-01T20:00:00Z", page_size=1)
        assert body["pagination"]["total_items"] == 2
        assert body["items"][0]["publish_time"] == "2026-03-01T18:30:00Z"


class TestEmptyResults:
    EMPTY = {"start": "2026-04-10T00:00:00Z", "end": "2026-04-10T02:00:00Z"}

    def test_forecast_reports_missing_hours_with_null_metrics(self, client: TestClient) -> None:
        body = get(client, "/api/forecast", **self.EMPTY)

        assert [item["forecast_mw"] for item in body["items"]] == [None, None]
        assert body["summary"]["matched_intervals"] == 0
        assert body["summary"]["coverage"] == 0
        assert body["summary"]["mae_mw"] is None

    def test_accuracy_has_no_lead_time_rows(self, client: TestClient) -> None:
        body = get(client, "/api/accuracy", **self.EMPTY)
        assert body["by_lead_time"] == []
        assert body["by_delivery_date"][0]["rmse_mw"] is None

    def test_history_is_empty(self, client: TestClient) -> None:
        body = get(client, "/api/forecast-history", **self.EMPTY)
        assert body["items"] == []
        assert body["pagination"]["total_pages"] == 0


class TestValidation:
    @pytest.mark.parametrize(
        ("params", "message"),
        [
            ({"start": "2026-03-02T00:00:00"}, "timezone"),
            ({"start": "not-a-date"}, "datetime"),
            ({"start": "2026-03-02T00:30:00Z"}, "must be on the hour"),
            ({"start": "2026-03-02T03:00:00Z", "end": "2026-03-02T00:00:00Z"}, "end must be after start"),
            ({"start": "2026-01-01T00:00:00Z", "end": "2026-06-01T00:00:00Z"}, "at most 93 days"),
            ({"page": 0}, "greater than or equal to 1"),
            ({"page_size": 5000}, "less than or equal to 1000"),
            ({"cutof": "2026-03-01T20:00:00Z"}, "Extra inputs are not permitted"),
        ],
    )
    def test_invalid_parameters_return_422_with_reason(
        self, client: TestClient, params: dict[str, Any], message: str
    ) -> None:
        response = client.get("/api/forecast", params=params)
        assert response.status_code == 422
        assert message in response.text

    @pytest.mark.parametrize("offset", ["+05:30", "+05:45", "-03:30"])
    def test_half_hour_offsets_are_checked_on_the_utc_hour(self, client: TestClient, offset: str) -> None:
        # 00:00 local is not on the UTC hour for these offsets: a clean 422, never a 500.
        response = client.get("/api/forecast", params={"start": f"2026-03-02T00:00:00{offset}", "end": WINDOW["end"]})
        assert response.status_code == 422
        assert "must be on the hour" in response.text

    def test_an_instant_on_the_utc_hour_is_accepted_with_any_offset(self, client: TestClient) -> None:
        params = {"start": "2026-03-02T05:30:00+05:30", "end": "2026-03-02T08:30:00+05:30"}
        response = client.get("/api/forecast", params=params)
        assert response.status_code == 200
        assert response.json()["window"]["start"] == "2026-03-02T00:00:00Z"

    def test_cutoff_and_cutoff_rule_cannot_be_combined(self, client: TestClient) -> None:
        params = {**WINDOW, "cutoff": "2026-03-01T12:00:00Z", "cutoff_rule": "day-ahead"}
        assert client.get("/api/accuracy", params=params).status_code == 422

    def test_unknown_cutoff_rule_is_rejected(self, client: TestClient) -> None:
        assert client.get("/api/accuracy", params={**WINDOW, "cutoff_rule": "whenever"}).status_code == 422

    def test_accuracy_does_not_accept_pagination(self, client: TestClient) -> None:
        assert client.get("/api/accuracy", params={"page": 1}).status_code == 422


class TestBackendFailures:
    def test_database_down_returns_503(self) -> None:
        unreachable = sessionmaker(bind=create_engine("postgresql+psycopg://user:pw@127.0.0.1:1/db"))

        def broken_session() -> Iterator[Session]:
            with unreachable() as session:
                yield session

        app.dependency_overrides[get_session] = broken_session
        try:
            client = TestClient(app, raise_server_exceptions=False)
            for path in ("/api/health", "/api/forecast", "/api/accuracy", "/api/forecast-history"):
                response = client.get(path)
                assert response.status_code == 503, path
                assert response.json() == {"detail": "Database unavailable. Try again shortly."}
        finally:
            app.dependency_overrides.clear()

    def test_unexpected_error_returns_json_500(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
        def crash(*args: Any) -> None:
            raise RuntimeError("boom")

        monkeypatch.setattr(dashboard, "accuracy", crash)

        response = client.get("/api/accuracy")

        assert response.status_code == 500
        assert response.json() == {"detail": "Internal server error."}  # no internals leaked


class TestCors:
    def test_configured_origin_is_allowed(self, client: TestClient) -> None:
        response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"

    def test_other_origins_are_not(self, client: TestClient) -> None:
        response = client.get("/api/health", headers={"Origin": "https://example.com"})
        assert "access-control-allow-origin" not in response.headers

    def test_origins_are_read_as_a_comma_separated_list(self) -> None:
        settings = Settings(cors_allowed_origins="http://localhost:5173, https://dash.example.com")
        assert settings.cors_allowed_origins == ["http://localhost:5173", "https://dash.example.com"]


class TestDayAheadRule:
    """The day-ahead rule only uses forecasts published by 12:00 UK time on the day before delivery."""

    def test_forecasts_published_after_the_decision_time_are_not_used(self, client: TestClient) -> None:
        # The seeded forecasts were published at 18:30Z and 21:30Z on 1 March, after 12:00Z.
        body = client.get("/api/forecast", params={**WINDOW, "cutoff_rule": "day-ahead"}).json()

        assert body["window"]["cutoff_rule"] == "day-ahead"
        assert body["window"]["cutoff"] == "2026-03-01T12:00:00Z"
        assert [item["forecast_mw"] for item in body["items"]] == [None, None, None]
        assert body["summary"]["missing_forecast"] == 3

    def test_without_the_rule_the_same_forecasts_are_used(self, client: TestClient) -> None:
        body = client.get("/api/forecast", params=WINDOW).json()

        assert body["window"]["cutoff_rule"] is None
        assert body["items"][0]["forecast_mw"] == 9500

    def test_accuracy_and_history_accept_the_rule(self, client: TestClient) -> None:
        params = {**WINDOW, "cutoff_rule": "day-ahead"}
        accuracy = client.get("/api/accuracy", params=params)
        history = client.get("/api/forecast-history", params=params)

        assert accuracy.status_code == 200 and accuracy.json()["overall"]["matched_intervals"] == 0
        assert history.status_code == 200 and history.json()["items"] == []
