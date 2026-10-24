# Playwright (end-to-end) guidelines

Unit and component tests stay in Vitest (see `testing.md`); Playwright covers whole-stack user journeys only. It is set up in `frontend/`: specs in `frontend/e2e/*.spec.ts`, config in `frontend/playwright.config.ts`, run with `npm run e2e`. Vitest excludes `e2e/`. On a fresh machine install the browser once:

```bash
cd frontend && npx playwright install --with-deps chromium
```

## What to test

Journeys a user would actually do, against the real stack (`./run.sh`, dashboard on `http://localhost:3000`):

- Overview: choose a day and cutoff, see the chart, KPIs and hourly table update; the URL reflects the selection.
- Accuracy: change the period, see daily error and lead-time charts and their tables.
- Forecast versions: pick an hour, step through versions with the arrow keys.
- Shareable state: load a URL with parameters and get the same view; an invalid parameter falls back to the default.
- Missing data: a gap shows as a gap and the coverage note counts it.
- API failure: the page shows the error state, not a blank screen.

Do not duplicate what Vitest already proves (formatting, metric maths, trace building).

## Writing tests

- Set `baseURL` in `playwright.config.ts` from `E2E_BASE_URL` (default `http://localhost:3000`) and use relative paths: `page.goto('/?date=2026-01-10')`.
- Locate by role and accessible name first: `getByRole('button', { name: 'Accuracy' })`, then `getByLabel`, then `getByText`. Add `data-testid` only when none of these work. Never use CSS or XPath chains.
- Use web-first assertions that auto-wait: `await expect(locator).toBeVisible()`. No `waitForTimeout` or fixed sleeps.
- Assert on the URL with `await expect(page).toHaveURL(/cutoff=/)`.
- For Plotly charts, assert on the container being visible and on the accompanying table values, not on canvas pixels.
- Keep each test independent: no ordering, no shared state. The database is read-only for the dashboard, so tests can share the January 2026 dataset.
- Force error and empty states by routing the API: `await page.route('**/api/forecast*', route => route.fulfill({ status: 503, json: {...} }))`.
- Use the dev stack (`./run.sh --dev`) only when debugging; run CI-style checks against `./run.sh`.

## Running

```bash
./run.sh                       # stack must be healthy first
cd frontend && npm run e2e     # headless
npx playwright test --ui       # inspect and debug
npx playwright show-report     # after a failure
```

- Config: Chromium only at first; `retries: 1` in CI, `0` locally; `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`.
- Commit `playwright.config.ts` and `e2e/`; git-ignore `playwright-report/` and `test-results/`.

## Test-first hook

`e2e/*.spec.ts` files are outside `frontend/src`, so the hook does not gate them. Application code changes still need their Vitest test first.
