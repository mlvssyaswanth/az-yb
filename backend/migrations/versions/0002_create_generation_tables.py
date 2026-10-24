"""Create actual_generation and wind_forecast hypertables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-24
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "actual_generation",
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fuel_type", sa.String(20), nullable=False),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("settlement_period", sa.SmallInteger(), nullable=False),
        sa.Column("generation_mw", sa.Integer(), nullable=False),
        sa.Column("publish_time", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("start_time", "fuel_type"),
        sa.CheckConstraint("settlement_period BETWEEN 1 AND 50", name="ck_actual_generation_settlement_period"),
    )
    op.create_table(
        "wind_forecast",
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("publish_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generation_mw", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("start_time", "publish_time"),
        sa.CheckConstraint(
            "start_time - publish_time BETWEEN interval '0' AND interval '66 hours 30 minutes'",
            name="ck_wind_forecast_horizon",
        ),
    )

    # Partition both tables on delivery time in weekly chunks. TimescaleDB's default
    # (start_time DESC) index is skipped: the primary keys already lead with start_time.
    for table in ("actual_generation", "wind_forecast"):
        op.execute(
            f"SELECT create_hypertable('{table}', by_range('start_time', INTERVAL '7 days'), "
            "create_default_indexes => false)"
        )


def downgrade() -> None:
    op.drop_table("wind_forecast")
    op.drop_table("actual_generation")
