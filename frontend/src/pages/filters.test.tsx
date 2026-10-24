import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlotData } from 'plotly.js'
import Plotly from 'plotly.js-dist-min'
import { type ReactNode, useState } from 'react'

import type { AccuracyResponse, ForecastResponse, ForecastVersion } from '@/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DashboardState } from '@/hooks/useDashboardState'
import { AccuracyPage } from '@/pages/AccuracyPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { VersionsPage } from '@/pages/VersionsPage'
import { requestUrl } from '@/test/requests'

// Charts must follow the filters: changing a control triggers a new request, and the chart is
// redrawn from that response.

type PageComponent = (props: { state: DashboardState; onChange: (changes: Partial<DashboardState>) => void }) => ReactNode

function Harness({ initial, Page }: { initial: DashboardState; Page: PageComponent }) {
  const [state, setState] = useState(initial)
  return <Page state={state} onChange={(changes) => setState((previous) => ({ ...previous, ...changes }))} />
}

function renderPage(initial: DashboardState, Page: PageComponent) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness initial={initial} Page={Page} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

/** Stubs fetch with a handler that sees the request's query parameters. */
function serve(handler: (params: URLSearchParams) => unknown) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const params = requestUrl(input).searchParams
    return new Response(JSON.stringify(handler(params)), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const PERIOD = { from: '2026-01-01', to: '2026-01-31' }

const METRICS = {
  expected_intervals: 1,
  matched_intervals: 1,
  missing_forecast: 0,
  missing_actual: 0,
  coverage: 1,
  mae_mw: 500,
  rmse_mw: 500,
  bias_mw: 500,
  mape_percent: 5,
  mape_intervals: 1,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('the forecast vs actual chart redraws for the next delivery day', async () => {
  // Each day gets a different actual so the plotted values identify the day.
  const fetchMock = serve((params): ForecastResponse => {
    const start = params.get('start')!
    return {
      window: { start, end: params.get('end')!, cutoff: params.get('cutoff')! },
      summary: METRICS,
      pagination: { page: 1, page_size: 200, total_items: 1, total_pages: 1 },
      items: [
        {
          start_time: start,
          forecast_mw: 9_000,
          actual_mw: start.startsWith('2026-01-10') ? 8_500 : 6_000,
          error_mw: null,
          publish_time: '2026-01-09T11:30:00Z',
          lead_hours: 12.5,
        },
      ],
    }
  })
  renderPage({ ...PERIOD, view: 'overview', date: '2026-01-10', hour: 12 }, OverviewPage)

  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1))
  expect((vi.mocked(Plotly.react).mock.calls[0][1] as Partial<PlotData>[])[0].y).toEqual([8_500])

  await userEvent.click(screen.getByRole('button', { name: 'Next day' }))

  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2))
  expect((vi.mocked(Plotly.react).mock.calls[1][1] as Partial<PlotData>[])[0].y).toEqual([6_000])
  expect(requestUrl(fetchMock.mock.calls[1][0]).searchParams.get('start')).toBe('2026-01-11T00:00:00Z')
})

test('the publication timeline redraws for the previous delivery day', async () => {
  serve((params) => {
    const start = params.get('start')!
    const count = start.startsWith('2026-01-10') ? 3 : 2
    const items: ForecastVersion[] = Array.from({ length: count }, (_, index) => ({
      start_time: start,
      publish_time: new Date(new Date(start).getTime() - (index + 1) * 6 * 3_600_000).toISOString(),
      lead_hours: (index + 1) * 6,
      forecast_mw: 7_000 + index * 100,
      actual_mw: 7_500,
      error_mw: -500 + index * 100,
    }))
    items.reverse()
    return { window: { start, end: params.get('end')!, cutoff: params.get('cutoff')! }, pagination: { page: 1, page_size: 200, total_items: count, total_pages: 1 }, items }
  })
  renderPage({ ...PERIOD, view: 'versions', date: '2026-01-10', hour: 14 }, VersionsPage)

  expect(await screen.findByRole('img', { name: /3 publications/ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Previous day' }))
  expect(await screen.findByRole('img', { name: /2 publications/ })).toBeInTheDocument()
})

function accuracyFor(start: string, end: string): AccuracyResponse {
  const mae = start === '2026-01-01T00:00:00Z' ? 1_800 : 1_650
  const metrics = { ...METRICS, mae_mw: mae, bias_mw: mae - 200 }
  return {
    window: { start, end, cutoff: end },
    overall: metrics,
    by_delivery_date: [{ ...metrics, delivery_date: start.slice(0, 10) }],
    by_lead_time: [{ ...metrics, lead_bucket: '0-6 h' }],
  }
}

test('changing the analysis period refetches accuracy and redraws both charts', async () => {
  const fetchMock = serve((params) => accuracyFor(params.get('start')!, params.get('end')!))
  renderPage({ ...PERIOD, view: 'accuracy', date: '2026-01-10', hour: 12 }, AccuracyPage)

  expect(await screen.findByText(/^January 2026\. Forecasts published by 12:00 UK time the day before each delivery date/)).toBeInTheDocument()
  const keyFigures = screen.getByLabelText('Key figures')
  expect(await within(keyFigures).findByText('1,800')).toBeInTheDocument()
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2))

  await userEvent.click(screen.getByRole('button', { name: 'Period from (UK): Next day' }))

  expect(await screen.findByText(/^Fri 2 Jan to Sat 31 Jan\. Forecasts published by 12:00 UK time the day before each delivery date/)).toBeInTheDocument()
  expect(await within(keyFigures).findByText('1,650')).toBeInTheDocument()
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(4))
  const lastRequest = requestUrl(fetchMock.mock.calls.at(-1)![0]).searchParams
  expect(lastRequest.get('start')).toBe('2026-01-02T00:00:00Z')
  expect(lastRequest.get('end')).toBe('2026-02-01T00:00:00Z')

  await userEvent.click(screen.getByRole('button', { name: 'All of January 2026' }))
  expect(await screen.findByText(/^January 2026\. Forecasts published by 12:00 UK time the day before each delivery date/)).toBeInTheDocument()
})

test('accuracy always uses the day-ahead rule rather than a fixed cutoff', async () => {
  const fetchMock = serve((params) => accuracyFor(params.get('start')!, params.get('end')!))
  renderPage({ ...PERIOD, view: 'accuracy', date: '2026-01-10', hour: 12 }, AccuracyPage)

  expect(
    await screen.findByText(/^January 2026\. Forecasts published by 12:00 UK time the day before each delivery date/),
  ).toBeInTheDocument()
  const first = requestUrl(fetchMock.mock.calls[0][0]).searchParams
  expect(first.get('cutoff_rule')).toBe('day-ahead')
  expect(first.has('cutoff')).toBe(false)
  expect(screen.queryByRole('combobox', { name: 'Forecasts published by' })).not.toBeInTheDocument()
})

test('accuracy ends with a note on what the error means for a day-ahead buy', async () => {
  serve((params) => accuracyFor(params.get('start')!, params.get('end')!))
  renderPage({ ...PERIOD, view: 'accuracy', date: '2026-01-10', hour: 12 }, AccuracyPage)

  const note = await screen.findByRole('note', { name: 'What this means for a day-ahead buy' })
  expect(note).toHaveTextContent('±1,800 MW')
  expect(note).toHaveTextContent('1,600 MW above')
  expect(note).toHaveTextContent('wind may come in lower than forecast')
})

test('the period ends cannot cross each other', async () => {
  serve((params) => accuracyFor(params.get('start')!, params.get('end')!))
  renderPage({ view: 'accuracy', date: '2026-01-10', hour: 12, from: '2026-01-10', to: '2026-01-10' }, AccuracyPage)

  expect(await screen.findByText(/^Sat 10 Jan\. Forecasts published by 12:00 UK time the day before each delivery date/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Period from (UK): Next day' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Period to (UK): Previous day' })).toBeDisabled()
})

test('KPIs, chart and table are built from the same response', async () => {
  // Hours with a missing forecast or actual must be left out of the totals and the chart alike.
  const items = [
    { forecast: 10_000, actual: 8_000 },
    { forecast: 12_000, actual: null },
    { forecast: null, actual: 9_000 },
    { forecast: 11_000, actual: 12_000 },
  ].map(({ forecast, actual }, index) => ({
    start_time: `2026-01-10T0${index}:00:00Z`,
    forecast_mw: forecast,
    actual_mw: actual,
    error_mw: forecast != null && actual != null ? forecast - actual : null,
    publish_time: forecast != null ? '2026-01-09T11:30:00Z' : null,
    lead_hours: forecast != null ? 12.5 + index : null,
  }))
  serve((params): ForecastResponse => ({
    window: { start: params.get('start')!, end: params.get('end')!, cutoff: params.get('cutoff')! },
    // What the API computes for the two matched hours: errors +2,000 and -1,000.
    summary: { ...METRICS, expected_intervals: 4, matched_intervals: 2, missing_forecast: 1, missing_actual: 1, mae_mw: 1_500, bias_mw: 500 },
    pagination: { page: 1, page_size: 200, total_items: 4, total_pages: 1 },
    items,
  }))
  renderPage({ ...PERIOD, view: 'overview', date: '2026-01-10', hour: 12 }, OverviewPage)

  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1))
  const [actual, forecast] = vi.mocked(Plotly.react).mock.calls[0][1] as Partial<PlotData>[]
  const plotted = (actual.y as (number | null)[]).map((value, index) => [(forecast.y as (number | null)[])[index], value])
  const matched = plotted.filter((pair): pair is [number, number] => pair[0] != null && pair[1] != null)
  const errors = matched.map(([f, a]) => f - a)

  const keyFigures = screen.getByLabelText('Key figures')
  // Energy KPIs are computed in the browser from the plotted hours ...
  expect(within(keyFigures).getByText(String(matched.reduce((sum, [f]) => sum + f, 0) / 1000) + '.0')).toBeInTheDocument()
  expect(within(keyFigures).getByText(String(matched.reduce((sum, [, a]) => sum + a, 0) / 1000) + '.0')).toBeInTheDocument()
  // ... and the error KPIs from the API summary agree with the same plotted hours.
  const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length
  const bias = errors.reduce((sum, e) => sum + e, 0) / errors.length
  expect(within(keyFigures).getByText(mae.toLocaleString('en-GB'))).toBeInTheDocument()
  expect(within(keyFigures).getByText(`+${bias}`)).toBeInTheDocument()
  expect(screen.getByText(/Metrics use 2 of 4 hours/)).toBeInTheDocument()
  // Every plotted hour has a table row with the same values.
  const rows = screen.getAllByRole('row').slice(1)
  expect(rows).toHaveLength(plotted.length)
  expect(within(rows[1]).getByText('12,000')).toBeInTheDocument()
  expect(within(rows[1]).getAllByText('—').length).toBeGreaterThan(0)
})
