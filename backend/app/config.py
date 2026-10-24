from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://energy:energy@localhost:5432/energy"
    elexon_base_url: str = "https://data.elexon.co.uk/bmrs/api/v1"

    # Delivery window to ingest, and the API's default query window: [analysis_start, analysis_end).
    analysis_start: datetime = datetime(2026, 1, 1, tzinfo=UTC)
    analysis_end: datetime = datetime(2026, 2, 1, tzinfo=UTC)

    # A dataset is re-downloaded only if its last successful ingestion is older than this.
    # 0 means always re-download.
    ingest_freshness_hours: float = 24.0

    # Comma-separated origins allowed to call the API from a browser, e.g. the Vite dev server.
    cors_allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

    # Longest delivery window one API request may ask for; bounds query and response size.
    max_query_days: int = 93

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
