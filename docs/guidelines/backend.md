# Backend guidelines

Python 3.13, FastAPI, SQLAlchemy 2, Alembic, Pandas, psycopg 3.

## Layout

| Path | Responsibility |
| --- | --- |
| `app/api/` | Thin route handlers: validate via `schemas.py`, call `services/dashboard.py`, return a response model. No SQL, no Pandas. |
| `app/services/repository.py` | All SQL. Returns rows or DataFrames. |
| `app/services/analysis.py` | Pure functions over DataFrames (selection, alignment, metrics). No I/O. |
| `app/services/dashboard.py` | Combines repository + analysis into API response shapes. |
| `app/services/horizon.py` | The single definition of the forecast horizon rule. |
| `app/ingest/` | Elexon client, record validation, idempotent loader (CLI). The only code that talks to Elexon. |
| `migrations/versions/` | Alembic migrations, numbered `000N_description.py`. |

## Conventions

- Type-annotate every function. Use `X | None`, not `Optional`.
- Query parameters are Pydantic models in `schemas.py` (offset-aware timestamps, on the hour, `end > start`, window ≤ 93 days, unknown parameters rejected). Add new parameters there, not in handlers.
- Errors go through `app/api/errors.py`; return the shared `ErrorResponse` model.
- Config comes from `app/config.py` (environment). Never read `os.environ` elsewhere.
- Keep API routes read-only. Writes happen only in ingestion.
- Ingestion must stay idempotent: `INSERT ... ON CONFLICT` in one transaction, and log every run in `ingestion_run`.
- Schema changes need a new Alembic migration, never an edit to an applied one. Primary keys are the only indexes; justify any new index with `EXPLAIN ANALYZE`.
- Timestamps are timezone-aware UTC. Convert to Europe/London only through `app/timezones.py`.
- Docstrings: one line saying what and why for public functions; skip them when the name says it all.

## Before finishing

1. `docker compose run --rm backend pytest` passes.
2. New behaviour has a test (the test-first hook enforces this for new modules).
