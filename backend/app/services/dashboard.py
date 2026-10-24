"""Builds dashboard API responses from stored data and the analysis functions."""
from dataclasses import asdict
from datetime import datetime
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.schemas import (
    AccuracyResponse,
    DeliveryDateMetrics,
    ForecastHistoryResponse,
    ForecastInterval,
    ForecastResponse,
    ForecastVersion,
    LeadTimeMetrics,
    Metrics,
    PagedWindowQuery,
    Pagination,
    Window,
    WindowQuery,
)
from app.services.analysis import AnalysisResult, analyse, delivery_hours, forecast_versions, hourly_actuals
from app.services.decision import day_ahead_cutoffs
from app.services.repository import load_actuals, load_forecasts


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    """DataFrame rows as dicts, with NaN/NaT turned into None for JSON."""
    return [{key: None if pd.isna(value) else value for key, value in row.items()} for row in frame.to_dict("records")]


def _page(frame: pd.DataFrame, query: PagedWindowQuery) -> tuple[pd.DataFrame, Pagination]:
    offset = (query.page - 1) * query.page_size
    return frame.iloc[offset : offset + query.page_size], Pagination.of(query.page, query.page_size, len(frame))


def _per_hour_cutoffs(query: WindowQuery) -> pd.Series | None:
    """Each delivery hour's own cutoff when a decision rule is in force, else None (one cutoff for all)."""
    return day_ahead_cutoffs(delivery_hours(query.start, query.end)) if query.cutoff_rule == "day-ahead" else None


def _effective_cutoff(query: WindowQuery, per_hour: pd.Series | None) -> datetime:
    """The single cutoff to load forecasts with: the latest of the per-hour cutoffs, if any."""
    return per_hour.max().to_pydatetime() if per_hour is not None else query.cutoff


def _window(query: WindowQuery) -> Window:
    cutoff = _effective_cutoff(query, _per_hour_cutoffs(query))
    return Window(start=query.start, end=query.end, cutoff=cutoff, cutoff_rule=query.cutoff_rule)


def _analyse(session: Session, query: WindowQuery) -> AnalysisResult:
    per_hour = _per_hour_cutoffs(query)
    cutoff = _effective_cutoff(query, per_hour)
    actuals = load_actuals(session, query.start, query.end)
    forecasts = load_forecasts(session, query.start, query.end, cutoff)
    return analyse(actuals, forecasts, query.start, query.end, cutoff, per_hour)


def forecast(session: Session, query: PagedWindowQuery) -> ForecastResponse:
    result = _analyse(session, query)
    page, pagination = _page(result.hourly.reset_index(), query)
    return ForecastResponse(
        window=_window(query),
        summary=Metrics(**asdict(result.overall)),
        pagination=pagination,
        items=[ForecastInterval(**row) for row in _records(page)],
    )


def accuracy(session: Session, query: WindowQuery) -> AccuracyResponse:
    result = _analyse(session, query)
    return AccuracyResponse(
        window=_window(query),
        overall=Metrics(**asdict(result.overall)),
        by_delivery_date=[DeliveryDateMetrics(**row) for row in _records(result.by_delivery_date)],
        by_lead_time=[LeadTimeMetrics(**row) for row in _records(result.by_lead_time)],
    )


def forecast_history(session: Session, query: PagedWindowQuery) -> ForecastHistoryResponse:
    """Every forecast version published by the cutoff for delivery hours in the window."""
    per_hour = _per_hour_cutoffs(query)
    cutoff = _effective_cutoff(query, per_hour)
    actual_mw = hourly_actuals(load_actuals(session, query.start, query.end))
    forecasts = load_forecasts(session, query.start, query.end, cutoff)
    versions = forecast_versions(forecasts, actual_mw, delivery_hours(query.start, query.end), cutoff, per_hour)
    versions["error_mw"] = versions["forecast_mw"] - versions["actual_mw"]
    ordered = versions.sort_values(["start_time", "publish_time"]).drop(columns="lead_bucket")
    page, pagination = _page(ordered, query)
    return ForecastHistoryResponse(
        window=_window(query),
        pagination=pagination,
        items=[ForecastVersion(**row) for row in _records(page)],
    )
