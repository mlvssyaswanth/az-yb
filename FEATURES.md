# UK Wind Forecast Dashboard: Application Overview, Features and Technical Reference

This document comes from the code at `dfb7eea`. The UI was not opened in a browser.
Known defects are in `REVIEW.md`.

## Contents

1. [Summary](#1-summary)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Technology stack](#4-technology-stack)
5. [Repository layout and modules](#5-repository-layout-and-modules)
6. [Data model](#6-data-model)
7. [Ingestion pipeline](#7-ingestion-pipeline)
8. [Analysis rules](#8-analysis-rules)
9. [API reference](#9-api-reference)
10. [Frontend design](#10-frontend-design)
11. [Configuration](#11-configuration)
12. [Deployment and operations](#12-deployment-and-operations)
13. [Testing and tooling](#13-testing-and-tooling)
14. [Limitations](#14-limitations)

---

## 1. Summary

The application measures how accurate Great Britain's national wind generation forecasts are.
It compares every Elexon BMRS wind forecast (**WINDFOR**) published for January 2026 with the
wind generation actually recorded (**FUELHH**, fuel type `WIND`).

It answers one question: *if a decision had been made at a given cutoff time, using only the
forecasts available then, how far off would it have been?*

- A **loader** downloads, validates and stores the two datasets in TimescaleDB.
- A **read-only API** selects, for each delivery hour, the latest forecast published by a
  chosen cutoff, aligns it with the hourly actual, and computes MAE, RMSE, bias, MAPE and coverage.
- A **dashboard** presents the results in three views (Overview, Accuracy, Forecast versions).
- **Docker Compose** runs the whole stack with one command: `./run.sh`.

It is a local-first application. It is not deployed to a public host.

---

## 2. Features

### Data ingestion

- **Two Elexon BMRS sources:** WINDFOR (hourly national wind forecasts) and FUELHH (half-hourly actual wind output).
- **Retry on failure:** up to 4 attempts with exponential backoff on connection errors, 429 and 5xx responses.
- **Per-record validation:**
  - Each bad record is rejected with a counted reason.
  - Timestamps without a UTC offset are rejected instead of assumed to be UTC.
  - An actual's `startTime` must match its settlement date and period, checked in GB local time.
  - Forecast `startTime` values must fall on the hour.
- **Filtering:** rows outside the delivery window, outside the 0-66.5 h horizon, or duplicated in the download are dropped and counted.
- **Idempotent upserts:**
  - Identical rows are not rewritten.
  - Changed rows are updated.
  - A newer actual replaces an older one, never the reverse.
  - Every forecast publication is kept as its own row.
- **Atomic writes:** one transaction per dataset. A failure rolls that dataset back and leaves the other untouched.
- **Run log:** every attempt is stored in `ingestion_run` with status, counts, reasons and error text.
- **Freshness policy:** a dataset is skipped if it loaded successfully within `INGEST_FRESHNESS_HOURS`.
- **CLI flags:** `--force`, `--dataset`, `--status` and `--allow-stale`.

### Analysis

- **Horizon rule:** a forecast is valid when it was published 0 to 66.5 h before delivery, both ends inclusive.
- **Decision cutoff:** for each delivery hour, use the latest valid forecast published at or before the cutoff.
- **Hourly alignment:** the hourly actual is the mean of two half-hours. If either half-hour is missing, the hour is missing, and nothing is interpolated.
- **Full-grid join:** forecasts and actuals are joined over every expected hour, so gaps show as missing rather than shrinking the sample.
- **Metrics:** MAE, RMSE, bias (forecast minus actual), MAPE (excluding zero actuals) and coverage, with missing-forecast and missing-actual counts. Metrics are `null` when nothing matched.
- **Breakdowns:** by GB local delivery date (23- and 25-hour days handled) and by lead-time bucket.

### REST API

- Read-only, versionless JSON under `/api`, with OpenAPI docs.
- Strict parameter validation: unknown parameters rejected, offsets required, hours aligned, window capped at 93 days.
- Pagination on the two row-level endpoints.
- Uniform JSON errors: 422 for invalid input, 503 when the database is down, 500 with nothing leaked.
- Configurable CORS allow-list (GET only).

### Dashboard

- **Overview (one delivery day):**
  - KPI strip: forecast and actual energy (GWh), MAE with RMSE, and bias.
  - A coverage sentence and a "wind only" scope note.
  - A Plotly forecast-vs-actual line chart that shows gaps where data is missing.
  - An hourly table with the forecast version used, its publish time, lead time and a signed-error bar.
- **Accuracy (a chosen date range):**
  - KPIs for MAE, RMSE, bias and MAPE.
  - A daily chart with bias bars and an MAE line.
  - A lead-time chart and table.
  - A per-day table with "View hours" links back to the Overview.
- **Forecast versions (one delivery hour):**
  - A D3 step timeline against publication time, marking the actual, the cutoff and the start of delivery.
  - Arrow, Home and End keys step through versions, with screen-reader announcements.
  - A table of every publication, with the one used at the cutoff highlighted.
- **Day-ahead basis:** every page uses only forecasts published by 12:00 UK time the day before delivery, and says so. There is no cutoff picker.
- **Date and hour pickers:** previous/next buttons, a month grid, and hour labels that disambiguate clock changes.
- **Shareable state:** every selection lives in the URL, so views can be bookmarked and the back button works. Invalid URL values fall back to defaults.
- **UK local time** throughout the UI; the API works in UTC.
- **Missing data** is shown as "-", never as 0.
- **Loading and error states:** skeletons, and error panels with a retry button. Requests time out after 20 s and are cancelled when filters change.
- **Accessibility:** charts have text summaries and tables with the same data, Radix-based controls, a responsive layout with a sheet menu on mobile.

### Operations

- One-command start with health-gated service ordering (`./run.sh`).
- Safe reset (`--reset-db` asks for confirmation).
- Migrations applied automatically at startup.
- Restart policies, loopback-only database port, fail-fast required environment variables.

---

## 3. Architecture

```
          Elexon BMRS Insights API (public, no key)
              |  FUELHH stream, WINDFOR stream
              v
  +--------------------------+   one-shot, at startup or by hand
  | ingest                   |   alembic upgrade head
  | app/ingest/load.py       |   download -> validate -> filter -> upsert -> log run
  +------------+-------------+
               v
  +--------------------------+
  | db                       |   PostgreSQL 17 + TimescaleDB 2.30
  | hypertables              |   named volume: db-data
  +------------+-------------+
               v  SQL (read only)
  +--------------------------+
  | backend                  |   FastAPI: repository -> Pandas analysis -> JSON
  | :8000  /api/*            |
  +------------+-------------+
               v  proxied /api/
  +--------------------------+
  | frontend                 |   nginx serving the React build
  | :80 -> FRONTEND_PORT     |
  +--------------------------+
```

### Design principles

- **One-way data flow.** Only `ingest` calls Elexon. Dashboard requests read the database and never trigger downloads, so page loads don't depend on Elexon being up.
- **Layered backend**, each layer with one job:

  | Layer | Module | Responsibility |
  | --- | --- | --- |
  | Routes | `app/api/*` | Thin handlers, error mapping |
  | Schemas | `app/schemas.py` | Query validation, response models |
  | Orchestration | `app/services/dashboard.py` | Builds API responses |
  | Data access | `app/services/repository.py` | SQL, returns DataFrames in UTC |
  | Analysis | `app/services/analysis.py` | Pure Pandas functions |
  | Rules | `app/services/horizon.py` | Horizon rule and cutoff filter |

- **The horizon rule** is defined in Python (`horizon.py`) and mirrored in SQL by a CHECK constraint.
- **Same-origin API.** nginx proxies `/api`, so the production dashboard needs no CORS.
- **Store raw, compute on read.** The database holds source values unchanged; hourly means, selection and metrics are computed per request.

### Request lifecycle (`GET /api/forecast`)

1. FastAPI validates the query into `PagedWindowQuery` and resolves defaults (start, end, cutoff).
2. `dashboard.forecast` calls `repository.load_actuals` and `load_forecasts` (cutoff filtered in SQL).
3. `analysis.analyse` builds the hourly grid, averages half-hourly actuals, selects the latest valid forecast per hour, aligns them and computes metrics.
4. The result is paged and serialised to the response model, with NaN converted to `null`.

---

## 4. Technology stack

| Layer | Tool | Version |
| --- | --- | --- |
| Database | PostgreSQL + TimescaleDB image | `timescale/timescaledb:2.30.2-pg17` |
| Backend language | Python | 3.13 image (`requires-python >=3.12`) |
| API framework | FastAPI / uvicorn | 0.143.0 / 0.54.0 |
| ORM and migrations | SQLAlchemy / Alembic | 2.1.4 / 1.20.0 |
| DB driver | psycopg (v3, binary) | 3.3.6 |
| Settings | pydantic-settings | 2.15.0 |
| Analysis | Pandas | 3.0.6 |
| HTTP client | httpx | 0.28.1 |
| Time zone data | tzdata | 2026.5 |
| Backend tests | pytest | 9.1.1 |
| Frontend framework | React + React DOM | ^19.3.1 |
| Language and build | TypeScript / Vite | ~6.0.3 / ^8.3.4 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) | ^4.3.3 |
| UI components | shadcn/ui on Radix (`radix-ui`), `class-variance-authority`, `cn`, `lucide-react`, `tw-animate-css` | |
| Font | IBM Plex Sans Variable (`@fontsource-variable`) | ^5.3.0 |
| Data fetching | TanStack React Query | ^5.104.5 |
| Charts | Plotly (`plotly.js-dist-min`) and D3 | ^4.1.2 / ^7.9.0 |
| Frontend tests | Vitest, Testing Library, jsdom | ^5.0.5 |
| Lint | oxlint | ^1.88.0 |
| Runtime | Node 24 (build), nginx 1.29 (serve) | alpine images |
| Orchestration | Docker Compose v2 | Engine 25+ for `start_interval` |

**Why these choices (from the project's own rationale):**

- **TimescaleDB:** both datasets are time series and every query is bounded by a delivery interval, so 7-day chunks let a query read only its window.
- **Primary keys as the only indexes:** they block duplicate ingestion and serve every read pattern.
- **Pandas:** joining on a full grid of hours and grouping by day or lead time are short and easy to test.
- **Plotly vs D3:** Plotly for the standard charts (hover, gaps, unified tooltips); D3 for the version timeline, where no stock chart fits (step lines, reference lines, keyboard stepping).

---

## 5. Repository layout and modules

```
.
|-- run.sh                     start / rebuild / stop / logs / reset the stack
|-- docker-compose.yml         db, ingest, backend, frontend
|-- .env.example               environment template
|-- .gitattributes             LF endings for scripts and container files
|-- README.md  REVIEW.md  FEATURES.md
|-- backend/
|   |-- Dockerfile  pyproject.toml  alembic.ini
|   |-- migrations/versions/   0001 extension, 0002 hypertables, 0003 ingestion_run
|   |-- app/
|   |   |-- main.py            app, CORS, routers, error handlers
|   |   |-- config.py          Settings (env-driven), cached get_settings()
|   |   |-- db.py              engine (pool_pre_ping), SessionLocal, Base, get_session
|   |   |-- models.py          ActualGeneration, WindForecast, IngestionRun
|   |   |-- schemas.py         query models and response schemas
|   |   |-- timezones.py       GB_TIME = Europe/London
|   |   |-- api/               health, forecasts, forecast_rules, errors
|   |   |-- services/          horizon, repository, analysis, dashboard
|   |   `-- ingest/            elexon_client, validation, load (CLI)
|   `-- tests/                 pytest suite, fixtures/ = real Elexon samples
`-- frontend/
    |-- Dockerfile  nginx.conf  vite.config.ts  components.json
    `-- src/
        |-- api/               client, queries (React Query hooks), types
        |-- pages/             OverviewPage, AccuracyPage, VersionsPage
        |-- components/        layout, controls, tables, KPI strip, notes
        |   |-- charts/        Plotly charts, trace builders, D3 timeline
        |   `-- ui/            generated shadcn/ui components
        |-- hooks/             useDashboardState (URL sync), useElementWidth
        |-- lib/               time, cutoff, format, energy, publications
        `-- config.ts          delivery period (January 2026)
```

### Backend modules

| Module | Role |
| --- | --- |
| `ingest/elexon_client.py` | `ElexonClient`: GET with retry/backoff; `fetch_wind_actuals`, `fetch_wind_forecasts`; `to_utc_string` |
| `ingest/validation.py` | `validate_actuals`, `validate_forecasts`; UTC normalisation; `settlement_period_start` for GB clock-change days; returns rows plus a `Counter` of rejection reasons |
| `ingest/load.py` | `select_actuals` / `select_forecasts` (window, horizon, de-duplication); `upsert`; `ingest_dataset`; `run` (freshness, allow-stale); CLI `main` |
| `services/horizon.py` | `MIN_HORIZON`, `MAX_HORIZON`, `valid_horizon_mask`, `published_by(cutoff)` |
| `services/repository.py` | `load_actuals`, `load_forecasts`: windowed queries, UTC-normalised DataFrames |
| `services/analysis.py` | `delivery_hours`, `hourly_actuals`, `select_forecasts_at_cutoff`, `align`, `error_metrics`, `metrics_by_delivery_date`, `forecast_versions`, `metrics_by_lead_time`, `analyse` |
| `services/dashboard.py` | `forecast`, `accuracy`, `forecast_history`: pagination and response assembly |
| `api/errors.py` | Maps DB connection failures to 503 and anything else to 500 |
| `api/health.py` | DB connectivity plus TimescaleDB version |
| `api/forecast_rules.py` | Exposes the horizon bounds |

### Frontend modules

| Module | Role |
| --- | --- |
| `api/client.ts` | `fetch` wrapper: query building, 20 s timeout, abort support, FastAPI error decoding into `ApiError` |
| `api/queries.ts` | `useDeliveryDay`, `usePeriodAccuracy`, `useForecastVersions`; query client (5 min stale time, retry policy) |
| `hooks/useDashboardState.ts` | View/date/cutoff/hour/period state mirrored to the URL via the History API |
| `lib/time.ts` | UK-time conversion with `Intl`, delivery-day windows, hour labels around clock changes |
| `lib/cutoff.ts` | Cutoff presets and custom times, validation and resolution to a UTC instant |
| `lib/energy.ts` | Matched-hour energy totals (MW x 1 h) |
| `lib/publications.ts` | Summary of which publications fed the displayed values |
| `lib/format.ts` | MW, GWh, percent, hours formatting; "-" for missing |
| `components/charts/traces.ts` | Pure functions building Plotly traces and layouts |
| `components/charts/PlotlyChart.tsx` | Lazy-loads Plotly, `Plotly.react` updates, resize and purge handling |
| `components/charts/PublicationTimeline.tsx` | D3 scales and shapes rendered as React SVG, keyboard and pointer interaction |

---

## 6. Data model

All timestamps are `timestamptz` (stored in UTC). `generation_mw` is the source integer MW value, unchanged.

### `actual_generation` (hypertable)

| Column | Type | Notes |
| --- | --- | --- |
| `start_time` | timestamptz | PK part 1; start of the settlement period; partition column |
| `fuel_type` | varchar(20) | PK part 2; only `WIND` is loaded |
| `settlement_date`, `settlement_period` | date, smallint | source identifiers; CHECK period 1-50 |
| `generation_mw` | integer | average MW over the half-hour |
| `publish_time` | timestamptz | when Elexon published the value; used to keep the newest revision |

### `wind_forecast` (hypertable)

| Column | Type | Notes |
| --- | --- | --- |
| `start_time` | timestamptz | PK part 1; delivery hour; partition column |
| `publish_time` | timestamptz | PK part 2; forecast vintage |
| `generation_mw` | integer | forecast MW |

CHECK `ck_wind_forecast_horizon`: `0 <= start_time - publish_time <= 66.5 h`.

### `ingestion_run` (plain table)

`id`, `dataset`, `period_start`, `period_end`, `status` (`running` / `succeeded` / `failed`),
`started_at`, `finished_at`, `records_fetched` / `rejected` / `filtered` / `inserted` /
`updated` / `unchanged`, `reasons` (JSONB), `error`.
Intended invariant: `fetched = rejected + filtered + inserted + updated + unchanged`.

### Partitioning and indexes

- Both hypertables partition on `start_time` in 7-day chunks.
- The only indexes are the two primary keys; TimescaleDB's default time index is disabled.
- A month of data is about 1,488 actual rows and about 14,400 forecast rows (264 publications).

---

## 7. Ingestion pipeline

Run by the `ingest` Compose service at startup, or by hand:

```bash
docker compose run --rm ingest python -m app.ingest.load [--force] [--dataset actuals|forecasts] [--status] [--allow-stale]
```

Per dataset (actuals, then forecasts):

1. **Freshness check** against the last successful run for the same window.
2. **Download in full**, one request per dataset.
   - FUELHH is requested by settlement date (GB local days).
   - WINDFOR can only be filtered by publish time, so it is requested from 66.5 h before the window starts.
3. **Validate** each record and reject with a counted reason.
4. **Filter** by window, horizon and duplicates.
5. **Upsert in batches of 5,000** in one transaction:
   `INSERT ... ON CONFLICT DO UPDATE ... WHERE (stored) IS DISTINCT FROM (incoming)`.
   Actuals additionally require `stored.publish_time <= incoming.publish_time`.
   Inserted rows are told apart from updated ones via `RETURNING xmax = 0`.
6. **Log** the attempt in `ingestion_run`, in its own transaction so failures are recorded too.

Each dataset is independent: a forecast failure does not undo an actuals load. With
`--allow-stale`, a failure exits 0 if that dataset was loaded before.

---

## 8. Analysis rules

- **Horizon** = `start_time - publish_time`. Valid when `0 h <= horizon <= 66.5 h`, both inclusive. Computed from timezone-aware timestamps; naive timestamps are refused.
- **Decision cutoff:** per delivery hour, the latest valid forecast with `publish_time <= cutoff`. Applied in SQL and again in Pandas.
- **Resolution:** hourly, because WINDFOR is hourly. Hourly actual = mean of the two half-hours; missing if either is missing.
- **Delivery dates** are GB local dates (`Europe/London`), so clock-change days have 23 or 25 hours.
- **Signed error** = forecast - actual (positive means over-forecast).

| Metric | Definition |
| --- | --- |
| MAE | mean of absolute error |
| RMSE | square root of mean squared error |
| Bias | mean signed error |
| MAPE | mean(abs error / actual) x 100 over hours with a non-zero actual; `mape_intervals` gives the count |
| Coverage | matched hours / expected hours, with missing-forecast and missing-actual counts |

Metrics use matched hours only and are `null` when nothing matched.

**Lead-time buckets** (lower bound inclusive): 0-6, 6-12, 12-24, 24-36, 36-48, 48-66.5 h.
Every valid version published by the cutoff is matched to its hour's actual, so an hour
contributes once per version and bucket sizes differ.

---

## 9. API reference

Base path `/api`. Interactive docs at `http://localhost:8000/docs`.

| Endpoint | Returns | Paginated |
| --- | --- | --- |
| `GET /api/health` | `{"status": "ok", "timescaledb": "<version>"}`; 503 if the DB is down | no |
| `GET /api/forecast` | Per delivery hour: forecast used, actual, error, publish time, lead hours; plus whole-window `summary` | yes |
| `GET /api/accuracy` | `overall`, `by_delivery_date`, `by_lead_time` | no |
| `GET /api/forecast-history` | Every forecast version published by the cutoff, per hour, with actual and error | yes |
| `GET /api/forecast-rules/horizon` | `{min_hours, max_hours, inclusive}` | no |

### Query parameters (the three data endpoints)

| Parameter | Default | Rules |
| --- | --- | --- |
| `start` | `2026-01-01T00:00:00Z` | First delivery hour; ISO 8601 with offset; on the hour |
| `end` | `2026-02-01T00:00:00Z` | Exclusive; after `start`; at most 93 days later |
| `cutoff` | `end` | Only forecasts with `publish_time <= cutoff` are used; any time with an offset |
| `page`, `page_size` | 1, 168 | `/forecast` and `/forecast-history` only; `page_size` 1-1000 |

### Response conventions

- Responses are in UTC and echo the resolved `window`.
- Missing values are `null`, never 0.
- Metric objects always carry `expected_intervals`, `matched_intervals`, `missing_forecast`, `missing_actual`, `coverage`, and (`mae_mw`, `rmse_mw`, `bias_mw`, `mape_percent`, `mape_intervals`).
- `/forecast` returns every hour in the window, including hours with no data; `summary` covers the whole window, not the current page. A page past the end returns `items: []`.
- `/forecast-history` is sorted by delivery hour, then publish time.

### Status codes

| Code | When |
| --- | --- |
| 200 | Success, including windows with no data |
| 422 | Invalid or unknown parameter (FastAPI validation detail) |
| 503 | Database unreachable: `{"detail": "Database unavailable. Try again shortly."}` |
| 500 | Unexpected error: `{"detail": "Internal server error."}` |

---

## 10. Frontend design

- **Routing:** no router library. A `view` query parameter selects `overview`, `accuracy` or `versions`; state is synchronised with the History API (`replaceState` for the first write, `pushState` afterwards, `popstate` to restore).
- **URL state:** `view`, `date`, `cutoff`, `hour`, `from`, `to`. Invalid values fall back to defaults.
- **Data layer:** React Query hooks wrap `api.forecast`, `api.accuracy` and `api.forecastHistory`; one retry for network and 5xx failures, none for 4xx.
- **Time handling:** the API speaks UTC; `lib/time.ts` converts to and from UK wall-clock time using the browser's `Intl` data and builds delivery-day windows of 23, 24 or 25 hours.
- **Charts:**
  - Plotly charts (forecast vs actual, daily error, lead time) are built by pure functions in `traces.ts`, which keeps them testable without rendering.
  - Plotly is loaded on first use in its own chunk.
  - The D3 timeline uses D3 only for scales and path generation; React renders the SVG.
- **Styling:** Tailwind v4 design tokens in `index.css`; a petrol accent, an amber/blue pair for over/under-forecast, and a dark navigation rail.
- **Responsive layout:** fixed navigation rail on desktop, sheet menu on mobile.

---

## 11. Configuration

Set in `.env` (created from `.env.example` by `run.sh`).

| Variable | Default | Used by | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `energy` | db, ingest, backend | Credentials; required, Compose fails if missing |
| `POSTGRES_PORT` | 5432 | db | Host port, bound to `127.0.0.1` only |
| `BACKEND_PORT` | 8000 | backend | Host port for the API |
| `FRONTEND_PORT` | 3000 | frontend | Host port for the dashboard |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | backend | Comma-separated origins allowed to call the API directly |
| `ELEXON_BASE_URL` | `https://data.elexon.co.uk/bmrs/api/v1` | ingest | Elexon Insights API |
| `INGEST_FRESHNESS_HOURS` | 24 | ingest | Reload only if the last success is older; 0 = always |
| `DATABASE_URL` | localhost URL | backend outside Docker | Ignored by Compose, which builds the URL from `POSTGRES_*` |

Backend `Settings` also has `analysis_start` / `analysis_end` (the delivery window, default
January 2026) and `max_query_days` (93). These are not forwarded by Compose.
Frontend: `VITE_API_BASE_URL` (build time) points the dashboard at an API on another origin;
`API_PROXY_TARGET` sets the Vite dev-server proxy.

---

## 12. Deployment and operations

### Services

| Service | Image | Starts when | Healthy when |
| --- | --- | --- | --- |
| `db` | `timescale/timescaledb:2.30.2-pg17` | first | `pg_isready` over TCP succeeds |
| `ingest` | `./backend` | `db` healthy | one-shot, exits 0 |
| `backend` | `./backend` (uvicorn) | `ingest` completed | `GET /api/health` can query the database |
| `frontend` | `./frontend` (nginx) | `backend` healthy | nginx serves `/` |

- The database check uses TCP on purpose: on a fresh volume the image runs a temporary init server that answers only on the Unix socket.
- `db`, `backend` and `frontend` use `restart: unless-stopped`.
- Data lives in the named volume `db-data`; `--stop` keeps it.
- nginx resolves the backend per request through Docker's DNS, so it starts while the API is down and follows a recreated container. Proxy timeouts are 5 s to connect and 30 s to read.

### `run.sh`

```bash
./run.sh              # build if missing, start everything, wait until healthy
./run.sh --build      # rebuild images first
./run.sh --stop       # stop and remove containers; data is kept
./run.sh --logs       # follow logs
./run.sh --reset-db   # delete the database volume and reload (asks first)
```

Works on Linux, macOS and Git Bash. It checks Docker and Compose v2, creates `.env`,
runs `docker compose up -d --wait`, and prints container status and recent logs on failure.
PowerShell equivalents are in the README.

### Default endpoints

| | URL |
| --- | --- |
| Dashboard | http://localhost:3000 |
| API health | http://localhost:8000/api/health |
| OpenAPI docs | http://localhost:8000/docs |

---

## 13. Testing and tooling

### Backend: 127 tests (pytest)

| File | Covers |
| --- | --- |
| `test_horizon.py` | Horizon boundaries, time-zone handling, naive-timestamp refusal |
| `test_validation.py` | Real Elexon fixtures, rejection reasons, UTC normalisation, settlement periods across clock changes |
| `test_ingest.py` | Window, horizon and duplicate selection |
| `test_ingestion_service.py` | End-to-end ingestion with a fake source: idempotency, updates, failure and rollback, freshness, allow-stale |
| `test_database.py` | Migrations vs models, indexes, partitioning, constraints, upsert rules |
| `test_repository.py` | Windowing, cutoff filter, UTC regardless of session time zone |
| `test_analysis.py` | Cutoff selection, hourly actuals, metrics, DST delivery dates, lead-time buckets |
| `test_api.py` | Endpoints against hand-checkable data, validation, 503 and 500 handling, CORS |
| `test_health.py`, `test_forecast_rules_api.py` | Health and horizon endpoints |

DB tests run inside rolled-back transactions on a March 2026 window, so loaded data is untouched.
Run with `docker compose exec backend pytest`.

### Frontend: 61 tests (Vitest, 11 files)

API client errors and timeout, UK-time and cutoff logic, formatting, publications summary,
chart trace builders and chart components, URL-state parsing, filters, and the three pages
with a mocked API. Plotly is mocked in `src/test/setup.ts`.
Run with `cd frontend && npm ci && npm test`.

### Tooling

- Frontend: oxlint, strict TypeScript (`tsc -b`), Vite build.
- Backend: no linter or type checker configured.
- No CI configuration.

---

## 14. Limitations

- The delivery period is fixed to January 2026 and hard-coded in `frontend/src/config.ts`; no endpoint reports it.
- No data-freshness or ingestion-status display in the UI.
- Ingestion is not scheduled; it runs at startup or by hand.
- A systematic positive bias of about +1.5 GW appears even at 0-6 h lead time. The cause is unverified; the project suggests curtailment or differing coverage between the two datasets.
- It is wind only; real procurement also depends on demand, other generation and interconnectors.
- No authentication, rate limiting, TLS or public deployment.
- Defects found in review (an offset-handling 500, ingestion reporting success on empty data, uncompressed asset serving, and others) are in `REVIEW.md`.
