"""Turns unexpected failures into JSON errors shaped like FastAPI's own: {"detail": ...}."""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, OperationalError

logger = logging.getLogger(__name__)


async def database_unavailable(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Database unavailable on %s", request.url.path)
    return JSONResponse(status_code=503, content={"detail": "Database unavailable. Try again shortly."})


async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error."})


async def database_error(request: Request, exc: Exception) -> JSONResponse:
    # A dropped connection is temporary (503); any other database error is a bug (500).
    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return await database_unavailable(request, exc)
    return await unexpected_error(request, exc)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(OperationalError, database_unavailable)  # e.g. database down
    app.add_exception_handler(DBAPIError, database_error)
    app.add_exception_handler(Exception, unexpected_error)
