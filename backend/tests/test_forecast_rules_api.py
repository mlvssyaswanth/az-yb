from fastapi.testclient import TestClient

from app.main import app


def test_horizon_rule_endpoint_exposes_inclusive_bounds() -> None:
    with TestClient(app) as client:
        response = client.get("/api/forecast-rules/horizon")

    assert response.status_code == 200
    assert response.json() == {"min_hours": 0.0, "max_hours": 66.5, "inclusive": True}
