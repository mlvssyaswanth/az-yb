# UK Wind Forecast Dashboard

A full-stack application that measures how accurate Great Britain's national wind
generation forecasts are. It compares every Elexon BMRS wind forecast (WINDFOR) published
for January 2026 with the generation actually recorded (FUELHH, fuel type `WIND`). It
answers the day-ahead buyer's question: *using only the forecasts available when the
day-ahead decision is made (12:00 UK time the day before delivery), how far off would the
wind forecast have been?*

## Features

- **Day-ahead basis:** the buying team bids on the day-ahead market the day before
  delivery, so every view uses only forecasts published by 12:00 UK time on the day before
  each delivery date. This is stated on each page. The brief doesn't give a time of day;
  12:00 is an assumption (the constant is `DAY_AHEAD_DECISION_HOUR` in
  `backend/app/services/decision.py`).
- **Overview:** pick one delivery day to see:
  - hourly forecast vs actual (Plotly line chart);
  - MAE and bias;
  - forecast and actual energy totals;
  - an hourly table showing which forecast version was used and its lead time.
- **Accuracy:** daily error over a chosen period (bias bars with an MAE line), and MAE and
  bias by forecast lead time. Both are Plotly charts with a table of the values. A short
  note turns the period's error into a margin for a day-ahead buy: "about ±N MW, and the
  forecast ran N MW above/below outturn".
- **Excel export:** each table downloads as `.xlsx`.
- **Forecast versions:** every forecast published for one delivery hour up to the day-ahead
  cutoff, drawn as a D3 step timeline against publication time. The actual, the cutoff and the
  start of delivery are marked. Arrow keys step through versions.
- **Shareable state:** every selection is kept in the URL, so views can be bookmarked and
  the back button works. Invalid URL values fall back to defaults.
- **Honest missing data:** hours without a forecast or a complete actual appear as gaps,
  never as zeros. They are excluded from metrics and counted in a coverage note.
- **Repeatable ingestion:** an idempotent loader with record validation, a horizon filter,
  freshness checks and a log of every run.
- **REST API:** read-only, documented with OpenAPI.
- **One-command start:** `./run.sh` starts the stack and waits until every service is
  healthy.

## Public deployment

**Not deployed.** The application has not been published to a public host, so there is no
public URL. It runs locally with Docker Compose (see [Running](#running)). Once started
with the defaults, it is at:

| | URL |
| --- | --- |
| Dashboard | http://localhost:3000 |
| API health | http://localhost:8000/api/health |
| OpenAPI docs | http://localhost:8000/docs |
| Dev dashboard (`./run.sh --dev` only) | http://localhost:5173 |

## Architecture

![Architecture: Elexon BMRS API, ingest, TimescaleDB, FastAPI + Pandas, React + nginx, day-ahead buyer](docs/video/architecture.png)

The editable source is `docs/video/architecture.excalidraw`. The diagram below shows the
same stack with ports and run details.

```
            Elexon BMRS Insights API (public, no key)
                │  FUELHH stream, WINDFOR stream
                ▼
  ┌────────────────────────┐   one-shot, at startup or by hand
  │ ingest                 │   alembic upgrade head
  │ app/ingest/load.py     │   validate → filter → upsert → log run
  └──────────┬─────────────┘
             ▼
  ┌────────────────────────┐
  │ db                     │   PostgreSQL 17 + TimescaleDB 2.30
  │ hypertables            │   volume: db-data
  └──────────┬─────────────┘
             ▼ SQL (read only)
  ┌────────────────────────┐
  │ backend                │   FastAPI: repository → Pandas analysis → JSON
  │ :8000  /api/*          │
  └──────────┬─────────────┘
             ▼ proxied /api/
  ┌────────────────────────┐
  │ frontend               │   nginx serving the React build
  │ :80 → FRONTEND_PORT    │
  └────────────────────────┘
```

- **Data flow is one-way.** Only `ingest` calls Elexon. Dashboard requests read the
  database and never trigger downloads, so page loads don't depend on Elexon being up.
- **Each layer has one job:**
  - `services/repository.py` runs SQL;
  - `services/analysis.py` holds pure Pandas functions (selection, alignment, metrics);
  - `services/dashboard.py` shapes API responses;
  - route handlers in `api/` stay thin.
- **The horizon rule is defined once**, in `backend/app/services/horizon.py`. Ingestion,
  a database CHECK constraint, the analysis and the dashboard all enforce it (the
  dashboard reads it from `GET /api/forecast-rules/horizon`).

### Technology choices

| Choice | Why |
| --- | --- |
| **TimescaleDB** (PostgreSQL 17) | Both datasets are time series, and every query is bounded by a delivery-time interval. Hypertables partition on `start_time` into 7-day chunks, so a query reads only the chunks in its window. Ingestion stays plain SQL: an atomic `INSERT … ON CONFLICT` upsert in one transaction. Selecting the latest forecast per hour at a cutoff is done in Pandas (`services/analysis.py`). It needs no extra service and grows to more months of data without schema changes. |
| **Indexes: primary keys only** | `wind_forecast (start_time, publish_time)` is the natural key of a forecast version. It blocks duplicate ingestion and serves every forecast query: all versions for a window, latest by cutoff, and single-publication lookups bounded by the horizon rule. `actual_generation (start_time, fuel_type)` does the same for actuals. TimescaleDB's default time index (`create_default_indexes => false`) and a `(publish_time, start_time)` index were left out. The first only duplicates the primary keys' leading column. For the second, `EXPLAIN ANALYZE` showed the cutoff and single-publication queries already use the primary keys with chunk exclusion. Fewer indexes also means cheaper upserts. |
| **FastAPI** | Pydantic models validate query parameters: offset-aware timestamps, values on the hour, `end > start`, a window of at most 93 days, unknown parameters rejected. The same models generate the OpenAPI docs at `/docs`. Python also keeps the API in the same language and process as the Pandas analysis and the ingestion code. |
| **Pandas** | Joining forecasts to actuals on a full grid of delivery hours, and grouping by day and by lead time, are short and easy to test as DataFrame operations. |
| **Plotly** | Used for the standard charts: forecast vs actual, daily error, lead time. Hover, zoom and pan come built in, as do unified tooltips with readable delivery and publication times, and gaps for missing hours (`connectgaps: false`). The bundle is large (about 7 MB raw, 1.7 MB gzipped by nginx), so it is lazy-loaded in its own chunk and the rest of the dashboard doesn't wait for it. |
| **D3.js** | Used for the forecast-version timeline, which no stock chart type fits. It needs step lines over publication time, reference lines for the cutoff and delivery start, versions you can focus and step through with the keyboard, and width-responsive SVG. D3 scales and shapes give that control without fighting a charting library. |
| **React 19, TypeScript, Vite, React Query** | A typed axios client and cached, cancellable requests, with URL-synced state. Tailwind 4 and shadcn/ui (Radix) provide the layout, sidebar, selects and tooltips. |
| **nginx** | Serves the static build and proxies `/api` on the same origin, so the browser needs no CORS. It gzips text assets, caches hashed assets for a year and never caches `index.html`. It resolves the backend on every request, so it starts while the API is down and follows a recreated container. |
| **Vitest and Playwright** | Vitest and Testing Library cover helpers, charts and pages with a mocked API. Playwright covers whole-stack journeys in Chromium. |
| **Docker Compose** | A single command reproduces the stack. Startup is ordered by healthchecks, and the database lives in a named volume. |

## Directory structure

```
.
├── run.sh                    start / rebuild / stop / logs / reset the stack
├── docker-compose.yml        db, ingest, backend, frontend services
├── docker-compose.dev.yml    dev overrides for ./run.sh --dev (hot reload)
├── .env.example              environment template (copied to .env)
├── .gitattributes            keeps shell scripts and container files on LF
├── backend/
│   ├── Dockerfile            Python 3.13 image (includes pytest)
│   ├── pyproject.toml        pinned dependencies
│   ├── alembic.ini
│   ├── migrations/versions/  0001 TimescaleDB extension, 0002 hypertables, 0003 ingestion_run
│   ├── app/
│   │   ├── main.py           FastAPI app, CORS, routers, error handlers
│   │   ├── config.py         settings from environment variables
│   │   ├── db.py             engine (pool_pre_ping), session dependency
│   │   ├── models.py         ActualGeneration, WindForecast, IngestionRun
│   │   ├── schemas.py        query models and response schemas
│   │   ├── timezones.py      UTC / Europe/London helpers
│   │   ├── api/              health, forecasts, forecast_rules, errors
│   │   ├── services/         horizon, decision (day-ahead cutoff), repository, analysis, dashboard
│   │   └── ingest/           elexon_client, validation, load (CLI)
│   └── tests/                pytest suite; fixtures/ holds real Elexon samples
└── frontend/
    ├── Dockerfile            Node 24 build stage → nginx 1.29
    ├── nginx.conf            static files, gzip, caching, /api proxy
    ├── playwright.config.ts  end-to-end config (baseURL from E2E_BASE_URL)
    ├── e2e/                  Playwright specs: overview, accuracy, versions, URL state, API failure
    └── src/
        ├── api/              typed client and React Query hooks
        ├── pages/            Overview, Accuracy, Forecast versions
        ├── components/       layout, controls, tables, KPI strip, notes
        │   ├── charts/       Plotly charts, trace builders, D3 timeline
        │   └── ui/           shadcn/ui components
        ├── hooks/            URL-synced dashboard state, element width
        ├── lib/              UK time, day-ahead cutoff, formatting, energy totals, Excel export
        └── config.ts         delivery period shown (January 2026)
```

Also in the repository: `docs/` (coding guidelines, `docs/evaluation/rubric.md`, and
`docs/video/` with the video script and architecture diagram),
`screenshots/` (browser captures used by the rubric), `CLAUDE.md`, `FEATURES.md` and `REVIEW.md`.

Tests (`*.test.ts(x)`) sit next to the frontend code they cover.

## Prerequisites and installation

- **Docker Engine 25+ with Compose v2.** Docker Desktop on Windows or macOS. Engine 25+ is
  needed for the healthchecks' `start_interval`.
- **Internet access** on the first start, to download data from Elexon (about 20k
  records; no API key).
- **bash** for `run.sh`: Linux, macOS (bash 3.2 works), Git Bash or WSL on Windows.
  PowerShell alternatives are given below.
- **Node.js 24** only for running frontend tests, Playwright or the Vite dev server outside Docker.
  Python does not need to be installed locally; backend tests run in the container.

No other installation is needed. From the repository root, run:

```bash
./run.sh
```

The first start builds the images, applies migrations and loads January 2026 from Elexon,
which took 37 s in testing with the image build layers already cached.

## Environment variables

`run.sh` creates `.env` from `.env.example` if it is missing. Compose reads `.env` from
the project root.

| Variable | Default | Used by | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `energy` | db, ingest, backend | Database credentials. **Required:** Compose stops with a clear message if any is missing. The defaults are for local development only. |
| `POSTGRES_PORT` | `5432` | db | Host port for local database tools, bound to `127.0.0.1` only. |
| `BACKEND_PORT` | `8000` | backend | Host port for the API. |
| `FRONTEND_PORT` | `3000` | frontend | Host port for the dashboard. |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | backend | Comma-separated origins allowed to call the API directly (GET only). The dashboard uses the nginx proxy and needs no entry. |
| `ELEXON_BASE_URL` | `https://data.elexon.co.uk/bmrs/api/v1` | ingest | Elexon Insights API base URL. |
| `INGEST_FRESHNESS_HOURS` | `24` | ingest | Reload a dataset only if its last successful load is older than this; `0` always reloads. |
| `DATABASE_URL` | `postgresql+psycopg://energy:energy@localhost:5432/energy` | backend outside Docker | Ignored by Compose, which builds the URL from the `POSTGRES_*` values. |

If 3000, 8000 or 5432 are taken (a local PostgreSQL usually holds 5432), change the
`*_PORT` values. `run.sh` prints the URLs from `.env`.

## Running

```bash
./run.sh              # build images if missing, start everything, wait until healthy
./run.sh --build      # rebuild images first (after code or dependency changes)
./run.sh --dev        # hot reload: Vite on :5173 and uvicorn --reload, source bind-mounted
./run.sh --stop       # stop and remove containers; database data is kept
./run.sh --logs       # follow logs from all services (Ctrl+C to exit)
./run.sh --reset-db   # delete the database volume and reload from Elexon (asks first)
./run.sh --help
```

`run.sh` changes to its own directory, so it can be run from anywhere. It checks that
Docker is running and Compose v2 is available, creates `.env` if needed, and runs
`docker compose up -d --wait`. If startup fails, it prints container status and recent
logs. `--reset-db` deletes data only after you type `reset`; any other answer cancels it.
If the script is not executable, run `bash run.sh`. In `--dev` mode the frontend container
installs npm packages when it starts, so after adding a dependency restart it with
`docker compose -f docker-compose.yml -f docker-compose.dev.yml restart frontend-dev`.

**Windows (Git Bash):** run `./run.sh` in Git Bash from the project folder. From
PowerShell, use `& "C:\Program Files\Git\bin\bash.exe" ./run.sh --build`.

**Windows (PowerShell without bash):**

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build --wait   # same as ./run.sh --build
docker compose logs -f --tail 100     # same as ./run.sh --logs
docker compose down                   # same as ./run.sh --stop
docker compose down -v                # deletes the database volume (no prompt)
```

## Docker services and migrations

| Service | Image | Starts when | Healthy when |
| --- | --- | --- | --- |
| `db` | `timescale/timescaledb:2.30.2-pg17` | first | `pg_isready` succeeds over TCP |
| `ingest` | `./backend` | `db` is healthy | (one-shot) exits 0 |
| `backend` | `./backend` (uvicorn) | `ingest` completed successfully | `GET /api/health` can query the database |
| `frontend` | `./frontend` (nginx) | `backend` is healthy | nginx serves `/` |

- **Readiness:** the database healthcheck uses TCP on purpose. On a fresh volume, the
  image runs a temporary init server that answers on the Unix socket only and then shuts
  down. A socket check passed during that window, so ingest could connect to a server
  that was about to stop.
- **Persistence:** data lives in the named volume `db-data`. `--stop` and normal restarts
  keep it.
- **Recovery:** `db`, `backend` and `frontend` use `restart: unless-stopped`.
  - If the database restarts, the API returns 503 until it is back, then recovers by
    itself; connections are checked before use.
  - If the API is down, nginx keeps serving the dashboard. The dashboard shows an error
    with a retry button.

**Migrations** are Alembic revisions in `backend/migrations/versions/`. The `ingest`
service applies them on every start (`alembic upgrade head`) before loading data.

| Revision | Creates |
| --- | --- |
| `0001` | `timescaledb` extension |
| `0002` | `actual_generation` and `wind_forecast` hypertables (7-day chunks, CHECK constraints) |
| `0003` | `ingestion_run` log table |

```bash
docker compose run --rm ingest alembic current        # → 0003 (head)
docker compose run --rm ingest alembic history
docker compose run --rm ingest alembic upgrade head   # apply manually
```

## Data ingestion

Data comes from two public Elexon Insights endpoints, relative to `ELEXON_BASE_URL`:

- **Actuals:** `GET /datasets/FUELHH/stream?settlementDateFrom=…&settlementDateTo=…&fuelType=WIND`.
  Average MW per 30-minute settlement period.
- **Forecasts:** `GET /datasets/WINDFOR/stream?publishDateTimeFrom=…&publishDateTimeTo=…`.
  Hourly values, about 8 publications a day, each covering roughly −25 h to +66.5 h
  around its publish time. WINDFOR can only be filtered by publish time, so the loader
  requests from 66.5 h before the window starts.

```bash
docker compose run --rm ingest python -m app.ingest.load                       # refresh stale datasets
docker compose run --rm ingest python -m app.ingest.load --force               # ignore freshness
docker compose run --rm ingest python -m app.ingest.load --dataset forecasts   # actuals | forecasts
docker compose run --rm ingest python -m app.ingest.load --status              # recent runs
```

For each dataset, the loader:

1. **Checks freshness.** It skips the dataset if the last successful load is newer than
   `INGEST_FRESHNESS_HOURS`.
2. **Downloads the full range** in one request, retrying up to 4 times with backoff on
   connection errors, 429 and 5xx responses.
3. **Validates every record.** A record is rejected, with a counted reason, for:
   - missing fields or wrong types;
   - timestamps without a UTC offset (they are never assumed to be UTC);
   - negative or non-integer MW;
   - a fuel type other than `WIND`;
   - a settlement period outside 1–50;
   - an actual whose `startTime` doesn't match its settlement date and period, checked in
     GB local time;
   - a forecast not on the hour;
   - a value above 100,000 MW (implausible).
   The run **fails** (and does not start the freshness clock) if the response is not a JSON
   list, is empty, has every record rejected, or leaves no usable rows after filtering. A
   single bad record only rejects that record.
4. **Filters valid rows**, with counted reasons: outside the delivery window, outside the
   0–66.5 h horizon, or duplicated within the download.
5. **Upserts in one transaction** with
   `INSERT … ON CONFLICT DO UPDATE … WHERE … IS DISTINCT FROM …`:
   - identical rows are not rewritten;
   - an actual is only replaced by one with the same or a later publication;
   - each forecast publication is its own row, so history is never overwritten.

   A failure rolls back that dataset only.
6. **Logs the attempt** in `ingestion_run`. Each row holds:
   - the status: `running`, `succeeded` or `failed`;
   - the counts, where `fetched = rejected + filtered + inserted + updated + unchanged`;
   - the reasons, as JSONB;
   - the error, if the run failed.

The Compose service runs with `--allow-stale`: if Elexon is unreachable but data was loaded
before, the app still starts on that data. A first load with no data still fails.

**Verified load for January 2026** (2026-10-24):

| Dataset | Fetched | Stored | Filtered |
| --- | --- | --- | --- |
| Actuals | 1,488 | 1,488 (31 days × 48 half-hours, no gaps) | 0 |
| Forecasts | 19,710 | 14,383 from 264 publications, covering all 744 delivery hours | 1,630 outside January, 3,697 outside the horizon |

## API

Read-only JSON under `/api`. OpenAPI docs are at `http://localhost:8000/docs`. The same
endpoints are proxied through the dashboard at `http://localhost:3000/api/…`.

| Endpoint | Returns | Paginated |
| --- | --- | --- |
| `GET /api/health` | `{"status": "ok", "timescaledb": "2.30.2"}`; 503 if the database is down | no |
| `GET /api/forecast` | Per delivery hour: the forecast used, actual, error, publish time and lead time, plus window-wide `summary` metrics | yes |
| `GET /api/accuracy` | `overall` metrics, `by_delivery_date` and `by_lead_time` | no |
| `GET /api/forecast-history` | Every forecast version published by the cutoff for each delivery hour, with actual and error | yes |
| `GET /api/forecast-rules/horizon` | Horizon bounds `{min_hours, max_hours, inclusive}` | no |

**Parameters** (all data endpoints):

| Parameter | Default | Rules |
| --- | --- | --- |
| `start` | `2026-01-01T00:00:00Z` | First delivery hour; ISO 8601 with offset; on the hour |
| `end` | `2026-02-01T00:00:00Z` | Exclusive; on the hour; after `start`; at most 93 days later |
| `cutoff` | `end` | Only forecasts with `publishTime ≤ cutoff` are used |
| `cutoff_rule` | none | `day-ahead`: each hour uses forecasts published by 12:00 GB time on the day before its GB delivery date. Mutually exclusive with `cutoff`; the echoed `window.cutoff` is the latest of those per-hour cutoffs |
| `page`, `page_size` | `1`, `168` | `/forecast` and `/forecast-history` only; `page_size` 1–1000 |

- Timestamps must carry an offset; write `+` as `%2B` in URLs.
- Responses are in UTC and echo the resolved `window`.
- Unknown parameters are rejected (422).
- Missing values are `null`, never 0. Every metric object reports `expected_intervals`,
  `matched_intervals`, `missing_forecast`, `missing_actual` and `coverage`.
- `/forecast` returns every hour in the window. Its `summary` covers the whole window,
  not just the current page.

**Status codes:**

| Code | When |
| --- | --- |
| 200 | Success, including windows with no data |
| 422 | Invalid or unknown parameter. The response includes FastAPI's validation detail. |
| 503 | Database unreachable: `{"detail": "Database unavailable. Try again shortly."}` |
| 500 | Unexpected error: `{"detail": "Internal server error."}`. The error is logged and internals are never exposed. |

**Examples:**

```bash
API=http://localhost:8000/api

# 10 January, using only forecasts published by 12:00 UTC on 9 January
curl "$API/forecast?start=2026-01-10T00:00:00Z&end=2026-01-11T00:00:00Z&cutoff=2026-01-09T12:00:00Z"

# January accuracy on the day-ahead basis (what the dashboard shows)
curl "$API/accuracy?cutoff_rule=day-ahead"

# January accuracy as known at 13:00 +01:00 (a single fixed cutoff)
curl "$API/accuracy?cutoff=2026-01-15T13:00:00%2B01:00"

# How the forecast for 12:00 UTC on 10 January evolved
curl "$API/forecast-history?start=2026-01-10T12:00:00Z&end=2026-01-10T13:00:00Z"
```

First example, shortened (values rounded here):

```json
{
  "window": {"start": "2026-01-10T00:00:00Z", "end": "2026-01-11T00:00:00Z", "cutoff": "2026-01-09T12:00:00Z"},
  "summary": {"expected_intervals": 24, "matched_intervals": 24, "coverage": 1.0,
              "mae_mw": 1245.19, "rmse_mw": 1386.35, "bias_mw": 855.98, "mape_percent": 14.16},
  "items": [{"start_time": "2026-01-10T00:00:00Z", "forecast_mw": 12244.0, "actual_mw": 11294.5,
             "error_mw": 949.5, "publish_time": "2026-01-09T11:30:00Z", "lead_hours": 12.5}]
}
```

## Methodology

The analysis is implemented in `backend/app/services/analysis.py` as pure functions
over data loaded by `repository.py`.

### Forecast selection

- **Horizon** = `start_time − publish_time`, computed from timezone-aware timestamps;
  naive timestamps are rejected. A forecast is valid when **0 h ≤ horizon ≤ 66.5 h**,
  with both bounds inclusive.
  - Negative horizons (forecasts published after delivery began) are excluded.
  - 66.5 h is WINDFOR's longest horizon; 31 of the January 2026 forecasts sit exactly
    on it.
- **Decision cutoff:** for each delivery hour, the forecast used is the **latest valid
  version with `publish_time ≤ cutoff`**. A forecast published exactly at the cutoff
  counts. Nothing published later is used: the SQL query filters on the cutoff, and the
  analysis applies it again. The dashboard always uses 12:00 UK time on the day before
  delivery. The API itself still accepts any `cutoff`.
- If an hour has no valid forecast by the cutoff, it is reported as missing a forecast,
  not filled.

### Alignment

- **Hourly comparison**, because WINDFOR is hourly. Each hourly actual is the mean of its
  two half-hourly average-MW values. If either half-hour is missing, the hour is missing;
  nothing is interpolated.
- **Joined on delivery timestamp** over a complete grid of expected hours, so gaps show up
  as missing values rather than shrinking the sample unnoticed.
- **Times are stored and computed in UTC.** Delivery dates are GB local dates
  (`Europe/London`), so clock-change days have 23 or 25 hours.

### Metrics

| Metric | Definition |
| --- | --- |
| Error | `forecast − actual` (positive means over-forecast) |
| MAE | mean of the absolute error, in MW |
| RMSE | √(mean of the squared error), in MW; weights large misses more heavily |
| Bias | mean of the signed error, in MW |
| MAPE | mean(\|error\| / actual) × 100, over hours with a non-zero actual (`mape_intervals` counts them) |
| Coverage | matched hours / expected hours, reported with the counts of missing forecasts and missing actuals |

- Metrics use matched hours only (both forecast and actual present). With no matched hours
  they are `null`, never 0.
- **By delivery date** groups by GB local date.
- **By lead time** matches every valid version published by the cutoff to its delivery
  hour and groups them into buckets: 0–6, 6–12, 12–24, 24–36, 36–48 and 48–66.5 h, each
  including its lower bound. An hour contributes once per version, so the buckets have
  different sample sizes and are not independent.

**January 2026, day-ahead basis** (`GET /api/accuracy?cutoff_rule=day-ahead`, 744 of 744
hours matched): MAE 2,018 MW, RMSE 2,477 MW, bias +1,806 MW, MAPE 19.7%. Every version
available at 12:00 the day before is at least 12 h old, so the lead-time buckets start at
12–24 h (MAE 2,310 MW) and reach 2,381 MW at 48–66.5 h.

For comparison, using the latest forecast before each hour (`GET /api/accuracy` with the
default cutoff) gives MAE 1,800 MW, RMSE 2,287 MW, bias +1,593 MW and MAPE 16.5%. That is
better than a day-ahead buyer could achieve, because those forecasts are published
0.5–3.5 h before delivery, which is why the dashboard does not use that basis.

## Testing

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps backend pytest   # backend; needs the db service
cd frontend && npm ci && npm test && npm run lint && npx tsc -b && npm run build
cd frontend && npx playwright install --with-deps chromium    # once
./run.sh && cd frontend && npm run e2e                        # end to end, against :3000
```

The backend image bakes in the tests it was built with, so use the dev override above (it
mounts `./backend`) or `./run.sh --build` first to test current code.

- **Backend (pytest)** covers:
  - the horizon rule boundaries;
  - Elexon parsing against real response fixtures;
  - record validation;
  - idempotent upserts and rollback on failure;
  - repository queries on TimescaleDB;
  - analysis edge cases: clock changes, duplicates, missing half-hours, the cutoff
    boundary;
  - the day-ahead rule: 12:00 on the previous GB day, clock-change days, per-hour cutoffs;
  - ingestion failure paths: empty or non-list responses, all records rejected,
    implausible values;
  - API validation and error handling, including non-whole-hour UTC offsets.
- **Frontend (Vitest + Testing Library)** covers:
  - the API client's errors and timeout;
  - the day-ahead cutoff and UK-time logic;
  - formatting;
  - chart trace builders;
  - URL-state parsing;
  - the dashboard pages and the error-margin note with a mocked API.
- **Playwright** covers the overview, accuracy (including the `cutoff_rule` request),
  forecast versions, shareable URLs with invalid parameters, and API-failure states.

**Verified results (2026-10-24, after the day-ahead changes):**

| Check | Result |
| --- | --- |
| Backend `pytest` | 151 passed |
| Frontend `npm test` | 65 passed (12 files) |
| Frontend `npm run lint` (oxlint) and `npx tsc -b` | clean (one existing oxlint warning in `use-mobile.ts`) |
| Frontend `npm run build` | succeeded (Plotly chunk over 500 kB, as expected) |
| Playwright `npm run e2e` (against the dev stack on :5173) | 12 passed |
| nginx gzip, in an `nginx:1.29-alpine` container | Plotly 7.27 MB → 1.70 MB; assets cached, `index.html` not |

These infrastructure checks were run on an earlier version and **not re-run** after the
day-ahead changes (they don't touch that code):

| Check | Result |
| --- | --- |
| `./run.sh --build` on an empty volume | all services healthy in 37 s; row counts as above; migrations at `0003` |
| `./run.sh` after `--stop` | data persisted; ingestion skipped both datasets as fresh |
| `--reset-db` | cancelled on any answer other than `reset`; on `reset`, the volume was recreated and reloaded |
| Database stopped, then started | API returned 503, then 200, without restarting the backend |
| Backend process killed | restarted automatically; API back to 200 in about 4 s |

## Known limitations

- **Systematic positive bias.** Bias is about +1.8 GW on the day-ahead basis, and about
  +1.5 GW even for forecasts published 0–6 h before delivery. That is too large to be
  forecast error alone, so WINDFOR and FUELHH `WIND` probably don't measure exactly the
  same quantity. Possible explanations, none of them
  verified:
  - curtailment, if WINDFOR forecasts output before balancing actions;
  - a difference in which wind farms each dataset covers.

  The metrics are reported as calculated, without correction.
- **WINDFOR semantics.** The API documentation doesn't say whether an hourly WINDFOR value
  is a point value or an hourly average. It is compared with the hourly mean of actuals.
- **The 12:00 cutoff is an assumption.** The brief says decisions are made "one day before
  delivery" without a time. The dashboard offers no other cutoff; the API accepts any
  `cutoff` if you want to test a different one.
- **January 2026 only.** The period is fixed in `frontend/src/config.ts`, and the loader
  and API default to it. No endpoint reports the loaded period, publication times or
  ingestion status, so the dashboard cannot show data freshness. It sums energy totals
  from the hourly items in the browser.
- **Wind only.** Procurement needs that also depend on demand, other generation and
  interconnectors can't be derived from this data. The dashboard says so.
- **Plotly bundle size.** Plotly is about 1.7 MB gzipped (nginx gzip is on and hashed
  assets are cached for a year). It is lazy-loaded, but the first chart on a slow
  connection still waits for it.
- **Not production-hardened.** There is no authentication, rate limiting or TLS. Ingestion
  is not scheduled; it runs at startup or by hand. The credentials in `.env.example` are
  development defaults.
- **Layout.** Every table has a fixed height, so short tables leave blank space, and the
  page has two nested `<main>` landmarks (one from the sidebar component, one from the
  app shell).
- **No public deployment** (see [Public deployment](#public-deployment)).

## AI tools disclosure

This project was developed with **Claude Code**, Anthropic's coding agent, using Claude
models. It was used to:

- write most of the application code, tests, migrations, Docker configuration, `run.sh`
  and this README;
- investigate the live Elexon API: field formats, publication patterns, horizon range;
- run verification: test suites, clean Docker starts, restart and outage scenarios,
  `EXPLAIN ANALYZE` checks, and browser checks of the dashboard with Playwright;
- review code quality and fix the bugs those reviews found.

