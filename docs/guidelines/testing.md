# Testing guidelines

## Test-first hook

`.claude/hooks/require_test.py` runs before every `Write`, `Edit` and `MultiEdit`. It blocks changes to source files that have no test, so create the test first (it may fail; that is the point).

| Source | Counts as covered when |
| --- | --- |
| `backend/app/**/<name>.py` | `backend/tests/test_<name>.py` exists, a `backend/tests/test_*.py` imports `<name>` from `app`, or a test has a `# covers: <name>` comment |
| `frontend/src/**/<Name>.ts(x)` | `<Name>.test.ts(x)` sits beside it, any `*.test.ts(x)` imports `<Name>`, or a test has a `// covers: <Name>` comment |

Exempt: test files, `__init__.py`, `migrations/`, `frontend/src/test/`, `components/ui/`, `*.d.ts`, `main.tsx`, and everything outside `backend/app` and `frontend/src`.

Use a `covers:` comment only when a higher-level test genuinely exercises the module (for example a component rendered by a page test). Do not add one to get past the hook.

## Backend (pytest)

- Tests live in `backend/tests/`, named `test_<module>.py`.
- Database tests use the fixtures in `conftest.py`: every test runs in a transaction that is rolled back. Needs `docker compose up -d db`.
- Use hand-checkable rows with known expected values; real Elexon samples are in `tests/fixtures/`.
- Analysis functions are pure: test them with small DataFrames, no database.
- Cover missing data explicitly (no forecast, incomplete actual) and the horizon boundary.

## Frontend (Vitest + Testing Library, jsdom)

- Tests sit next to the code as `*.test.ts(x)`; shared setup is `src/test/setup.ts`.
- Test pure helpers (`lib/`, `traces.ts`) directly; test pages and components through what the user sees (roles, text), not implementation details.
- Mock the API client, not `fetch` internals.

## What a good test covers

1. The normal case with exact expected numbers.
2. An edge: empty data, a gap, a timezone change (BST/GMT), the cutoff boundary.
3. The failure path: invalid input, API/database error.
