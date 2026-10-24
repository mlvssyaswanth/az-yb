"""Request query models and response schemas for the dashboard API."""
import math
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import get_settings

# ---------------------------------------------------------------- queries


class WindowQuery(BaseModel):
    """Delivery window [start, end) and decision cutoff. Unknown parameters are rejected."""

    model_config = ConfigDict(extra="forbid")

    start: AwareDatetime | None = Field(
        None, description="First delivery hour, ISO 8601 with offset. Defaults to the start of the loaded period."
    )
    end: AwareDatetime | None = Field(
        None, description="End of the delivery window (exclusive), on the hour. Defaults to the end of the loaded period."
    )
    cutoff: AwareDatetime | None = Field(
        None,
        description="Decision cutoff: only forecasts published at or before this time are used. Defaults to `end`, "
        "i.e. the latest forecast published before each delivery hour.",
    )

    cutoff_rule: Literal["day-ahead"] | None = Field(
        None,
        description="Decision rule instead of a single `cutoff`: `day-ahead` uses, for each delivery date, only "
        "forecasts published by 12:00 UK time on the day before. Cannot be combined with `cutoff`.",
    )

    @field_validator("start", "end")
    @classmethod
    def on_the_hour(cls, value: datetime | None) -> datetime | None:
        # Checked on the UTC instant, which is what the analysis uses; a +05:30 offset has no UTC hour at :00 local.
        if value is not None:
            utc = value.astimezone(UTC)
            if (utc.minute, utc.second, utc.microsecond) != (0, 0, 0):
                raise ValueError("must be on the hour, e.g. 2026-01-01T00:00:00Z")
        return value

    @model_validator(mode="after")
    def resolve_window(self) -> "WindowQuery":
        settings = get_settings()
        self.start = self.start or settings.analysis_start
        self.end = self.end or settings.analysis_end
        if self.end <= self.start:
            raise ValueError("end must be after start")
        if self.end - self.start > timedelta(days=settings.max_query_days):
            raise ValueError(f"the delivery window may span at most {settings.max_query_days} days")
        if self.cutoff_rule and self.cutoff:
            raise ValueError("cutoff and cutoff_rule cannot be combined")
        self.cutoff = self.cutoff or self.end
        # Echoed back in responses, so normalise to UTC.
        self.start, self.end, self.cutoff = (moment.astimezone(UTC) for moment in (self.start, self.end, self.cutoff))
        return self


class PagedWindowQuery(WindowQuery):
    page: int = Field(1, ge=1, description="1-based page number.")
    page_size: int = Field(168, ge=1, le=1000, description="Items per page (168 = one week of hours).")


# ---------------------------------------------------------------- responses


class Window(BaseModel):
    start: datetime
    end: datetime
    cutoff: datetime = Field(description="With a cutoff rule, the latest cutoff in the window.")
    cutoff_rule: str | None = Field(None, description="The decision rule applied, if any (`day-ahead`).")


class Pagination(BaseModel):
    page: int
    page_size: int
    total_items: int
    total_pages: int

    @classmethod
    def of(cls, page: int, page_size: int, total_items: int) -> "Pagination":
        return cls(
            page=page, page_size=page_size, total_items=total_items, total_pages=math.ceil(total_items / page_size)
        )


class Metrics(BaseModel):
    """Error metrics over matched intervals (both forecast and actual present).

    Error values are null when no interval matched; they are never computed from unmatched data.
    """

    expected_intervals: int
    matched_intervals: int
    missing_forecast: int
    missing_actual: int
    coverage: float | None = Field(description="matched_intervals / expected_intervals")
    mae_mw: float | None
    rmse_mw: float | None
    bias_mw: float | None = Field(description="Mean of forecast - actual; positive means over-forecast.")
    mape_percent: float | None = Field(description="Excludes intervals with a 0 MW actual; see mape_intervals.")
    mape_intervals: int


class DeliveryDateMetrics(Metrics):
    delivery_date: date = Field(description="GB local date (Europe/London).")


class LeadTimeMetrics(Metrics):
    lead_bucket: str = Field(description="Hours between publication and delivery, e.g. '0-6 h' (lower bound inclusive).")


class ForecastInterval(BaseModel):
    start_time: datetime = Field(description="Delivery hour start (UTC).")
    forecast_mw: float | None
    actual_mw: float | None = Field(description="Hourly mean of the two half-hourly actuals; null if either is missing.")
    error_mw: float | None = Field(description="forecast_mw - actual_mw; null unless both exist.")
    publish_time: datetime | None = Field(description="Publication time of the forecast used.")
    lead_hours: float | None


class ForecastResponse(BaseModel):
    window: Window
    summary: Metrics = Field(description="Metrics for the whole window, not just this page.")
    pagination: Pagination
    items: list[ForecastInterval]


class AccuracyResponse(BaseModel):
    window: Window
    overall: Metrics
    by_delivery_date: list[DeliveryDateMetrics]
    by_lead_time: list[LeadTimeMetrics] = Field(
        description="All forecast versions published by the cutoff, grouped by lead time. Buckets without data are omitted."
    )


class ForecastVersion(BaseModel):
    start_time: datetime
    publish_time: datetime
    lead_hours: float
    forecast_mw: float
    actual_mw: float | None
    error_mw: float | None


class ForecastHistoryResponse(BaseModel):
    window: Window
    pagination: Pagination
    items: list[ForecastVersion]


class HealthResponse(BaseModel):
    status: str
    timescaledb: str | None


class ErrorResponse(BaseModel):
    detail: str
