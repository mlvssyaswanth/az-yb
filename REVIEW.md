# Code Review: UK Wind Forecast Dashboard

**Reviewed:** `main` at `dfb7eea`, plus the uncommitted `frontend/package-lock.json` change.
**Date:** 2026-10-24
**Scope:** every tracked file except the generated shadcn `components/ui/*` (skimmed) and the
lockfile contents.

## How this was reviewed

I read all backend, frontend, migration, Docker, nginx and test code, then checked the claims I
could check instead of trusting them.

| Check | Result |
| --- | --- |
| Backend `pytest` (127 tests) against a throwaway TimescaleDB 2.30.2 container, after `alembic upgrade head` | **127 passed**, matching the README |
| Frontend `tsc -b`, `oxlint`, `vitest run` | clean, clean, **61 passed (11 files)**, matching the README |
| `vite build` | succeeds; Plotly chunk is 4,644 kB raw / 1,419 kB gzipped |
| Probes against the throwaway DB and the running stack | five defects reproduced (marked **Reproduced** below) |

I did not run the browser UI. The throwaway container is removed. I did not write to your
database; the only calls to your running stack were read-only `GET`s.

## Verdict

This is better than most projects of its size. The ingestion pipeline is careful, the time
handling is correct (I checked the DST arithmetic), the tests are meaningful, and the
cutoff semantics are enforced in both SQL and Pandas. The fixes to the first draft
(loopback-only DB port, `:?` required env vars, nginx runtime DNS resolution, healthcheck
timing) are real improvements.

It is not finished. There is **one user-reachable 500 in the API**, **ingestion can report
success while having stored nothing**, **the production bundle is served uncompressed (3.3x
what the README advertises)**, and **several README claims describe code that does not exist**.
None are hard to fix.

| Severity | Count |
| --- | --- |
| High | 4 |
| Medium | 12 |
| Low / nit | 20 |

---

## High

### H1. Valid timestamps with a non-whole-hour UTC offset return HTTP 500 (Reproduced)

`schemas.py:29-34` checks "on the hour" on the **local** clock fields of the supplied
datetime. `analysis.py:58-64` checks it again on the **UTC** instant. The two disagree
whenever the offset is not a whole number of hours (India `+05:30`, Nepal `+05:45`,
Newfoundland `-03:30`).

```
GET /api/forecast?start=2026-01-10T00:00:00+05:30&end=2026-01-10T06:00:00+05:30
  -> 500 {"detail":"Internal server error."}          (live stack, and all three data endpoints)
GET /api/forecast?start=2026-01-10T05:30:00+05:30&end=2026-01-10T11:30:00+05:30   (= 00:00Z..06:00Z)
  -> 422 "must be on the hour"
```

So a correct request is a 500, and a correct instant is rejected. The README promises 422
for bad parameters. The dashboard itself always sends UTC, so it never hits this; any other
API client can. The test suite has no offset-with-minutes case, which is why it passed.

**Fix:** in `on_the_hour`, convert first: `value.astimezone(UTC)` then check. Add parametrised
cases `+05:30`, `+05:45`, `-03:30` to `TestValidation`. Separately, `ValueError` from the
analysis layer should never be able to reach the client as a 500 (see M7).

### H2. An empty or garbled Elexon response is recorded as a successful run (Reproduced)

`elexon_client.py:30` returns `response.json()` with no shape check, and `load.py:176-198`
marks any run that does not raise as `succeeded`. Probed with a fake source:

| Elexon returns | Result |
| --- | --- |
| `[]` | `succeeded`, 0 fetched, 0 stored |
| `{"error": "rate limited", "status": 200}` | `succeeded`, 2 "fetched", both rejected as `record: not an object`, 0 stored |

Because a success starts the 24 h freshness clock (`load.py:221`), the next un-forced start
**skips** the dataset. With `--allow-stale` (what Compose uses) the container exits 0 too.
On a fresh database this ships a healthy-looking stack with an empty dashboard and a "fresh"
log entry. The README even states the expected counts (1,488 actuals, 14,383 forecasts) but
nothing asserts them or anything like them.

**Fix:** reject a non-list body in `_get`; treat `fetched == 0`, or `rejected == fetched`,
as a failure; consider a minimum-expected-count check for actuals (the window length in
half-hours is known exactly).

### H3. One out-of-range value fails the whole dataset (Reproduced)

`validation.py:48-57` accepts any non-negative whole number. `generation_mw` is a 32-bit
`Integer`. A record with `generation: 3000000000` passes validation, then
`NumericValueOutOfRange` aborts the **entire** upsert transaction:

```
3 good rows + 1 row with generation=3_000_000_000 -> run failed, 0 rows stored
```

This contradicts the module's own promise ("one bad record never stops an ingestion run",
`validation.py:3`) and the docstring on `models.py` ("failed validation: malformed or
impossible values"). GB wind capacity is roughly 30 GW; there is no plausibility ceiling at
all. **Fix:** reject values above a sane bound (for example 100,000 MW) as
`generation: implausibly large`.

### H4. nginx serves every asset uncompressed and uncached; the README quotes the gzipped size (Reproduced)

`frontend/nginx.conf` has no `gzip` directive (nginx defaults to off) and no
`Cache-Control`. Measured on the running container with `Accept-Encoding: gzip`:

| Asset | Served | README claims |
| --- | --- | --- |
| `index-*.js` | 519,555 B, no `Content-Encoding` | n/a (gzip would be ~165 kB) |
| `plotly.min-*.js` | **4,643,761 B**, no `Content-Encoding` | "about 1.4 MB gzipped" (README.md:89, 476) |

Users download 4.6 MB for the first chart, not 1.4 MB. Hashed filenames also get only an
`ETag`, so every page load revalidates every asset. **Fix:** add `gzip on; gzip_types
text/css application/javascript image/svg+xml application/json;`, and
`add_header Cache-Control "public, max-age=31536000, immutable"` on `/assets/`. (`brotli` is
better but needs a module.) The README sentence is only true after this change.

---

## Medium

### M1. `alembic check` cannot see CHECK-constraint drift (Reproduced)

`test_database.py:41` (`test_models_match_migrations`) is presented as a guard that models and
migrations agree. Alembic's autogenerate does not compare CHECK constraints. I replaced
`ck_wind_forecast_horizon` with `CHECK (true)` in the database; `command.check` still passed.
The 66.5 h rule in SQL is separately covered by `test_database_rejects_invalid_horizons`
(good), but `ck_actual_generation_settlement_period` and `ck_ingestion_run_status` have no
such guard. Either rename the test to what it proves, or add behavioural tests for those two.

### M2. The README claims things the code does not do

- **README.md:85**: "`DISTINCT ON` for 'latest forecast by cutoff'". No `DISTINCT ON` exists
  in `backend/app`. `repository.py` loads all matching rows and `analysis.py` picks the latest
  in Pandas. The `EXPLAIN` result that justifies the index choice is therefore about a query
  the app never runs. (I ran that query shape: it prunes to one chunk and uses the primary
  key, plus an explicit `Sort`, so the index decision is still fine.)
- **README.md:77-79**: "the dashboard reads it from `GET /api/forecast-rules/horizon`".
  Nothing under `frontend/src` references that endpoint or the horizon. The endpoint
  (`api/forecast_rules.py`) and its test exist only to back a claim that is not true. Either
  consume it (for example in the CutoffIndicator copy) or delete it.
- **"The horizon rule is defined once"** (README.md:77): the bounds live in
  `horizon.py:12-13`, `models.py:51`, `0002_...py:37` (SQL strings, so partly unavoidable),
  and the labels `"horizon outside 0-66.5 h"` (`load.py:92`) and `"48-66.5 h"`
  (`analysis.py:30`). `forecast_rules.py:21` hard-codes `inclusive=True`. Reword to "defined
  in Python and mirrored in SQL by a CHECK constraint", and derive the two labels from the
  constants.

### M3. The dashboard hard-codes facts the backend already knows

`frontend/src/config.ts` fixes the period to January 2026 and the README lists this and
three other "gaps in the API the dashboard works around". You own both sides. A
`GET /api/meta` returning `{period_start, period_end, last_successful_ingest}` (the data is
in `settings` and `ingestion_run`) closes all of them, removes a silent
config-drift hazard (`ANALYSIS_START` changed in the backend, UI still shows January), and
gives the dashboard a data-freshness line.

### M4. A non-JSON `200` is accepted as data; Versions page then crashes, with no error boundary

`client.ts:55-57` turns an unparseable body into `null` and returns it as `T`. If `/api` ever
answers 200 with HTML (wrong `VITE_API_BASE_URL`, a proxy fallback, Vite dev without the
proxy), Overview and Accuracy silently render empty panels, and `VersionsPage.tsx:113`
(`query.data.items`) throws. `App.tsx` has no error boundary, so the whole app goes blank.
**Fix:** if `response.ok` and the body is `null`, throw `ApiError`; add a top-level
`ErrorBoundary`.

### M5. Each dataset re-download overwrites without ever deleting

`upsert` inserts and updates only. If Elexon retracts a forecast version, if a stored row
would now fail validation, or if `ANALYSIS_START/END` is narrowed, stale rows stay forever and
keep feeding the analysis. For a fixed historical month this is tolerable; say so in the
README.

### M6. `select_forecasts` de-duplication is order-dependent

`load.py:88`: `drop_duplicates([...], keep="last")` on unsorted input. If the source repeats a
`(start, publish)` pair with different values, which one wins depends on download order.
`select_actuals` (`load.py:74`) sorts by `publish_time` first, so the two functions disagree
in style. Sort before de-duplicating, or fail loudly on conflicting duplicates.

### M7. The `Exception` handler is weaker than it looks

`api/errors.py:31` registers `Exception` handling, which Starlette routes to
`ServerErrorMiddleware`. Two consequences: (1) after sending the 500 it **re-raises**, so every
failure is logged twice (once by this handler's `logger.exception`, once by uvicorn); the
test client hides this with `raise_server_exceptions=False`; (2) that middleware sits outside
`CORSMiddleware`, so cross-origin callers get a CORS error instead of the 500 body.
Also, `database_unavailable` logs a full traceback on every request while the DB is down;
with the 10 s healthcheck that is a stack trace per 10 s, indefinitely.
`OperationalError → 503` also catches statement cancellations and serialization failures,
which are not "unavailable".

### M8. Actual `settlement_period` is checked against 1-50, not against the day

`validation.py:80-84`. A record with `settlementDate=2026-03-29`, `settlementPeriod=47`
(a 46-period day) and the matching `startTime` (`2026-03-29T23:30Z`) passes both the range
and the cross-check, because 47 × 30 min from local midnight lands on the next day's period 2.
It would then collide with the real row on the primary key and the later publication wins
silently. Low probability, but the max period for the date is computable.

### M9. `Settings` does not validate `analysis_start/end`

`config.py:16-17`. `ANALYSIS_START=2026-01-01` (naive) parses fine, then
`to_utc_string` and the window comparisons raise at ingest time; end before start, or
non-hour-aligned values, are not rejected. `docker-compose.yml` also does not forward
`ANALYSIS_START/END` or `MAX_QUERY_DAYS` into any container, so they can only be changed by
editing the Compose file, which the README does not say.

### M10. Failed or killed ingestion leaves misleading state

`running` rows left by a killed process stay forever (README admits it) and nothing prevents two
concurrent ingests (`docker compose run --rm ingest` while the startup job runs). The upserts
are idempotent so data stays correct, but the log and the counts can interleave. Add a
Postgres advisory lock around `ingest_dataset` and mark stale `running` rows as `failed` at
start. `--allow-stale` has no age bound either: a month-old load keeps the app "healthy".

### M11. Tests need the full stack and there is no CI

`pytest` for 5 of 10 files needs a live TimescaleDB, run inside the production image
(`Dockerfile` installs `[dev]`). There is no `.github/`, no pre-commit and no backend
linter or type checker (no ruff, no mypy). The suite is good; nothing runs it automatically.
Also unaddressed warnings from my run: Starlette's `TestClient` + `httpx` deprecation (it
asks for `httpx2`) and Alembic's missing `path_separator`.

### M12. Timeline width tracking can detach from its element

`useElementWidth.ts:7-16` observes `ref.current` once, in an effect with `[ref]` deps.
`PublicationTimeline` returns `ChartEmpty` (no container `div`) when there are no points, and
a different `div` when it returns to having points. If the first render is empty, or you move
cutoff A (empty) → B → A → B through the React Query cache (no pending state, so no remount),
the observer is attached to a missing or detached node and the SVG stays at the 640 px
fallback or stale width, overflowing on a phone. Fix: render the container `div` always and
put the empty message inside it, or use a callback ref.

---

## Low / nits

**Backend**

- `load.py:165` local variable `run` shadows the module function `run` (`load.py:202`).
- `load.py:115` `if model is ActualGeneration` special-cases inside a generic `upsert`; pass
  the extra "only if newer" predicate in as a parameter instead.
- `load.py:121` `xmax = 0` to count inserts relies on a PostgreSQL implementation detail. It is
  tested and works, but deserves a one-line comment saying why it is safe on hypertables.
- `elexon_client.py:25-40` ignores `Retry-After` on 429, has no jitter, and backs off a
  total of 14 s. There is no unit test for the client at all (retry paths, 4xx not retried).
- `health.py:20` returns `"status": "ok"` even when `timescaledb` is `None`; the comment says
  it makes a missing extension "obvious" but only the test fails.
- `migrations/0001`: `downgrade()` drops the `timescaledb` extension, which on a shared server
  is destructive. Make the downgrade a no-op.
- `forecasts.py:6-15` imports are not sorted (`app.schemas` before `app.db`).
- `pyproject.toml` pins direct dependencies but not transitive ones (starlette, pydantic,
  numpy, ...); builds are not reproducible. Add a constraints/lock file.
- `backend/Dockerfile`: runs as root, ships pytest in the runtime image, and the
  `mkdir app && pip install ".[dev]"` trick installs nothing real (the code is used from
  `/app` via the working directory). Install dependencies only, and add a non-root user.
- `docker-compose.yml`: `DATABASE_URL` interpolates the password unencoded, so a password
  containing `@`, `/` or `%` breaks the URL.
- `models.py` hypertables for ~16k rows: justified only if TimescaleDB is a requirement. If
  it is optional, plain PostgreSQL with the same two primary keys is equivalent here.

**Frontend**

- `client.ts:10` assumes one page of 200 always suffices and never checks
  `pagination.total_pages`; if the assumption breaks, data is truncated silently.
- `CutoffPicker.tsx:53` `step={1800}` makes the :25 publication times unselectable.
- The Daily table's "View hours" button (`AccuracyPage.tsx:127`) repeats identical text 31
  times; give each an `aria-label` with the date. `PublicationTimeline.tsx:116` is a
  focusable, keyboard-operated `svg` with `role="img"`; `role="application"` or a labelled
  group describes it more honestly.
- `index.css`: `.dark` is unreachable (nothing toggles it) and incomplete (no `--over`,
  `--under`, `--rail*` there); `--chart-1..5` are unused; `--sidebar*` duplicates `--rail*`.
  `charts/theme.ts:1-3` says its colours "mirror the tokens in index.css", but the
  forecast (`#009383`) and actual (`#6250d6`) colours are not in `index.css`.
- `time.ts` implements DST gap and overlap handling and the pickers, `readState`,
  `HourPicker` all cater for 23- and 25-hour days, but the shipped period (January) has none.
  It is correct and tested, just currently unreachable; do not mistake the tests for
  coverage of shipped behaviour.
- `App.test.tsx:12` calls `vi.unstubAllGlobals()` at the end of the test body, so a failing
  assertion leaves `fetch` stubbed for later tests. Move it to `afterEach`.
- `PublicationTimeline.tsx:1` imports from the `d3` umbrella; `d3-scale`, `d3-shape` and
  `d3-array` would cut the main chunk.
- `nginx.conf`: no `X-Forwarded-*` headers on the proxy, no security headers, and
  `/docs` on the nginx origin returns the SPA shell (OpenAPI is only on `:8000/docs`).

---

## Pending working-tree change

`frontend/package-lock.json` is modified (+18 / -87). It removes the `libc` markers from the
optional native-binary packages and adds `peer: true` flags, which is what a different npm
version writes. It is not a dependency change. Dropping `libc` removes npm's glibc/musl
selection, and the frontend image builds with `npm ci` on `node:24-alpine` (musl). Unless you
intended it, run `git checkout frontend/package-lock.json`. If you do want a lockfile
refresh, regenerate it with the npm version the Dockerfile's Node image ships.

---

## Checked and fine

So you do not re-check these:

- **`cn` npm package**: legitimate. It is shadcn's own package (`shadcn-ui/cn`) and replaces
  clsx + tailwind-merge.
- **TypeScript strictness**: TS 6.0.3 defaults `strict` on, verified with a probe file; the
  missing `"strict"` key in `tsconfig.app.json` is harmless.
- **DST maths**: `settlement_period_start`, GB-local delivery dates, 23/25-hour days and the
  UK-time conversion all check out against the tests.
- **Upsert correctness**: the `IS DISTINCT FROM` + `RETURNING xmax = 0` counting, the
  newer-actual-wins rule, the savepoint-based rollback tests.
- **Cutoff selection** is applied in SQL (`repository.py:44`) and again in Pandas
  (`horizon.published_by`), with the boundary tested at exactly the cutoff.
- **Latency**: the default January accuracy request takes ~150 ms; a 93-day history page at
  1000 rows takes ~16 ms. No performance problem at this data size.
- **Robustness probes on the live API**: cutoffs in years 0001 and 9999, windows in year 0001
  and 9990, and an over-size page all return 200 or a clean 422. (The `+05:30` case in H1 is the
  exception.)
- **README test and build claims**: 127 backend tests and 61 frontend tests, lint, and build
  all reproduce.

## Not verified

- The `+1.5 GW` bias explanation (README "Known limitations"). It is honestly labelled
  unverified. A cheap experiment before shipping it as a finding: recompute bias with the
  actual shifted by ±30 and ±60 minutes. If the bias moves a lot, it is an alignment
  convention (what WINDFOR's `startTime` marks), not curtailment or coverage.
- Browser rendering, keyboard behaviour and screen-reader output of the UI.
- Pinned dependency versions against their registries.

## Suggested order of work

1. **H1** (offset handling) + tests; it is a five-line change.
2. **H2** and **H3** (ingestion success criteria, plausibility bound) + tests.
3. **H4** (gzip, cache headers), then fix the README sentence.
4. **M2** (README accuracy): delete or use `forecast-rules`; drop the `DISTINCT ON` line.
5. **M4** (null body → `ApiError`, error boundary) and **M12** (container div always rendered).
6. **M3** (`/api/meta`) if you plan to load any month other than January.
7. **M1**, **M10**, **M11**: guards, locking, and CI.
8. `git checkout frontend/package-lock.json` unless the change was intentional.
