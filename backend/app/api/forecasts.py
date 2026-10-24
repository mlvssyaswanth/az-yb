from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.schemas import (
    AccuracyResponse,
    ErrorResponse,
    ForecastHistoryResponse,
    ForecastResponse,
    PagedWindowQuery,
    WindowQuery,
)
from app.db import get_session
from app.services import dashboard

router = APIRouter(responses={503: {"model": ErrorResponse, "description": "Database unavailable"}})

SessionDep = Annotated[Session, Depends(get_session)]


@router.get("/forecast")
def get_forecast(query: Annotated[PagedWindowQuery, Query()], session: SessionDep) -> ForecastResponse:
    """Hourly forecast vs actual: for each delivery hour, the latest forecast published by the cutoff."""
    return dashboard.forecast(session, query)


@router.get("/accuracy")
def get_accuracy(query: Annotated[WindowQuery, Query()], session: SessionDep) -> AccuracyResponse:
    """MAE, RMSE, bias, MAPE and coverage overall, per delivery date and per lead-time bucket."""
    return dashboard.accuracy(session, query)


@router.get("/forecast-history")
def get_forecast_history(
    query: Annotated[PagedWindowQuery, Query()], session: SessionDep
) -> ForecastHistoryResponse:
    """Every forecast version published by the cutoff for the delivery hours in the window."""
    return dashboard.forecast_history(session, query)
