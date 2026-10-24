"""Tables for raw Elexon data. Both are TimescaleDB hypertables partitioned on delivery time.

Only the primary keys are indexed. Every query filters on a delivery interval, which the
(start_time, ...) primary keys serve directly, and TimescaleDB skips chunks outside the
interval. See the README's Database section for the query patterns behind this.
"""
from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ActualGeneration(Base):
    """FUELHH rows: average MW over each half-hour settlement period, as published.

    The primary key prevents duplicate half-hours. start_time maps one-to-one to the
    source key (settlement_date, settlement_period), and TimescaleDB requires unique keys
    to include the partition column, so start_time stands in for that source key.
    """

    __tablename__ = "actual_generation"
    __table_args__ = (
        # 46 and 50 periods occur on clock-change days.
        CheckConstraint("settlement_period BETWEEN 1 AND 50", name="ck_actual_generation_settlement_period"),
    )

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    fuel_type: Mapped[str] = mapped_column(String(20), primary_key=True)
    settlement_date: Mapped[date] = mapped_column(Date)
    settlement_period: Mapped[int] = mapped_column(SmallInteger)
    generation_mw: Mapped[int] = mapped_column(Integer)
    # Kept so a resubmitted half-hour only replaces the stored row when it is newer.
    publish_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class WindForecast(Base):
    """WINDFOR rows: one row per (delivery hour, forecast publication).

    The primary key is the natural key of a forecast version: a delivery hour can have many
    forecasts, but only one per publication.
    """

    __tablename__ = "wind_forecast"
    __table_args__ = (
        # Mirrors app.services.horizon: 0 h <= start_time - publish_time <= 66.5 h.
        CheckConstraint(
            "start_time - publish_time BETWEEN interval '0' AND interval '66 hours 30 minutes'",
            name="ck_wind_forecast_horizon",
        ),
    )

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    publish_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    generation_mw: Mapped[int] = mapped_column(Integer)


class IngestionRun(Base):
    """One attempt to ingest one dataset. A plain table: it is a small log, not time-series data.

    Counts always add up: records_fetched = rejected + filtered + inserted + updated + unchanged.
    """

    __tablename__ = "ingestion_run"
    __table_args__ = (
        CheckConstraint("status IN ('running', 'succeeded', 'failed')", name="ck_ingestion_run_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dataset: Mapped[str] = mapped_column(String(20))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(10))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    records_fetched: Mapped[int | None] = mapped_column(Integer)
    # Failed validation (malformed or impossible values).
    records_rejected: Mapped[int | None] = mapped_column(Integer)
    # Valid but not stored: outside the delivery window or horizon rule, or a duplicate.
    records_filtered: Mapped[int | None] = mapped_column(Integer)
    records_inserted: Mapped[int | None] = mapped_column(Integer)
    records_updated: Mapped[int | None] = mapped_column(Integer)
    # Already stored with identical values (or, for actuals, superseded by a newer revision).
    records_unchanged: Mapped[int | None] = mapped_column(Integer)
    # Counts per rejection/filter reason, e.g. {"generation: negative": 2}.
    reasons: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
