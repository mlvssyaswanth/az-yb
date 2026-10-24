from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import forecast_rules, forecasts, health
from app.api.errors import register_error_handlers
from app.config import get_settings

app = FastAPI(
    title="UK Wind Forecast API",
    description="Read-only access to Elexon wind forecasts, actuals and accuracy metrics. "
    "Timestamps are ISO 8601; responses are in UTC.",
)

# The dashboard served by nginx calls the API on the same origin; CORS only matters for
# other origins such as the Vite dev server. The API is read-only, so only GET is allowed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)
register_error_handlers(app)

app.include_router(health.router, prefix="/api")
app.include_router(forecasts.router, prefix="/api")
app.include_router(forecast_rules.router, prefix="/api")
