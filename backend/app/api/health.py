from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import ErrorResponse, HealthResponse

router = APIRouter()


@router.get("/health", responses={503: {"model": ErrorResponse, "description": "Database unavailable"}})
def health(session: Annotated[Session, Depends(get_session)]) -> HealthResponse:
    """Checks the database connection; a failure becomes a 503 via the error handlers."""
    # Reports the TimescaleDB version so a missing extension is obvious, not just a dead DB.
    timescale_version = session.execute(
        text("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'")
    ).scalar_one_or_none()
    return HealthResponse(status="ok", timescaledb=timescale_version)
