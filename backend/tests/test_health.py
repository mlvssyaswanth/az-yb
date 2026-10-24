"""Integration test: needs the database from docker compose (see README)."""
from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_timescaledb() -> None:
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["timescaledb"] is not None
