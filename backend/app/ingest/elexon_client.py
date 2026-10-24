"""Fetches and parses the two Elexon BMRS stream datasets used by the app."""
import logging
import time
from datetime import date, datetime
from typing import Any

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 4


class UnexpectedResponse(Exception):
    """Elexon answered 200 with something other than a list of records (e.g. an error object)."""


class ElexonClient:
    def __init__(self, base_url: str, timeout_seconds: float = 60.0) -> None:
        self._http = httpx.Client(base_url=base_url, timeout=timeout_seconds)

    def close(self) -> None:
        self._http.close()

    def _get(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        # Rate limits are undocumented, so retry transient failures with exponential backoff.
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = self._http.get(path, params=params)
                if response.status_code not in RETRY_STATUSES:
                    response.raise_for_status()
                    body = response.json()
                    if not isinstance(body, list):
                        raise UnexpectedResponse(f"expected a list of records from {path}, got {type(body).__name__}")
                    return body
                error: Exception = httpx.HTTPStatusError(
                    f"HTTP {response.status_code}", request=response.request, response=response
                )
            except httpx.TransportError as exc:
                error = exc
            if attempt == MAX_ATTEMPTS:
                raise error
            delay = 2**attempt
            logger.warning("GET %s failed (%s); retrying in %ss", path, error, delay)
            time.sleep(delay)
        raise AssertionError("unreachable")

    def fetch_wind_actuals(self, first_day: date, last_day: date) -> list[dict[str, Any]]:
        """FUELHH WIND rows for settlement dates first_day..last_day inclusive."""
        return self._get(
            "/datasets/FUELHH/stream",
            {
                "settlementDateFrom": first_day.isoformat(),
                "settlementDateTo": last_day.isoformat(),
                "fuelType": "WIND",
            },
        )

    def fetch_wind_forecasts(self, published_from: datetime, published_to: datetime) -> list[dict[str, Any]]:
        """WINDFOR rows published in the window. The API cannot filter by target time."""
        return self._get(
            "/datasets/WINDFOR/stream",
            {
                "publishDateTimeFrom": to_utc_string(published_from),
                "publishDateTimeTo": to_utc_string(published_to),
            },
        )


def to_utc_string(moment: datetime) -> str:
    if moment.tzinfo is None:
        raise ValueError("timestamps sent to Elexon must be timezone-aware")
    return pd.Timestamp(moment).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")

