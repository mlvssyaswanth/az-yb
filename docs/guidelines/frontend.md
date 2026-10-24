# Frontend guidelines

React 19, TypeScript, Vite, TanStack Query, Tailwind 4, shadcn/ui (Radix), Plotly, D3.

## Layout

| Path | Contents |
| --- | --- |
| `src/api/` | Typed client (`client.ts`), response types (`types.ts`), React Query hooks (`queries.ts`). All network access goes through here. |
| `src/pages/` | `OverviewPage`, `AccuracyPage`, `VersionsPage`. |
| `src/components/` | Shared pieces: layout, controls, tables, KPI strip, notes. |
| `src/components/charts/` | Plotly charts, pure trace builders (`traces.ts`), D3 `PublicationTimeline`. |
| `src/components/ui/` | Generated shadcn components. Add with the shadcn CLI; do not hand-edit. |
| `src/hooks/` | `useDashboardState` (URL-synced state), `useElementWidth`. |
| `src/lib/` | Pure helpers: UK time, cutoff rules, formatting, energy totals. |

## Conventions

- Selections live in the URL via `useDashboardState`. Invalid URL values fall back to defaults.
- Keep computation out of components: put it in `lib/` or `traces.ts` as pure functions, then unit-test it.
- Never show a missing value as zero; render a gap and let the coverage note count it.
- Plotly is lazy-loaded in its own chunk. Do not import `plotly.js-dist-min` outside `PlotlyChart.tsx`.
- Every chart has a table or text equivalent and works from the keyboard. Use semantic elements and accessible names.
- Use design tokens from `index.css` and Tailwind classes; no inline hex colours outside `charts/theme.ts`.
- Function components only; one component per file, named like the file. Props typed with an interface or type alias, no `any`.
- API calls are proxied at `/api` (nginx in production, Vite proxy in dev). Never hard-code a host.
- Dates and times: use `lib/time.ts` (Europe/London aware); do not use bare `new Date().toString()` formatting.

## Before finishing

1. `npm run lint`, `npx tsc -b` and `npm test` pass in `frontend/`.
2. New component or helper has a test (the test-first hook enforces this).
