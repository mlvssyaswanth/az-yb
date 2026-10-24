// covers: queries, CoverageNote, DataStates, InfoTip, IntervalTable, KpiStrip, Panel, ScopeNote, SignedError, ChartEmpty, ChartLegend, PlotlyChart, DeliveryDatePicker, HourPicker, AppShell, PageHeader, config, useElementWidth, utils (rendered through the pages)
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

import type { AccuracyResponse, ForecastInterval, ForecastResponse, Metrics } from '@/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { DashboardState } from '@/hooks/useDashboardState'
import { AccuracyPage } from '@/pages/AccuracyPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { requestUrl } from '@/test/requests'

const STATE: DashboardState = {
  view: 'overview',
  date: '2026-01-10',
  hour: 12,
  from: '2026-01-01',
  to: '2026-01-31',
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  )
}

function mockFetch(...responses: { status: number; body: unknown }[]) {
  const fetchMock = vi.fn()
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function metrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    expected_intervals: 2,
    matched_intervals: 2,
    missing_forecast: 0,
    missing_actual: 0,
    coverage: 1,
    mae_mw: 1245,
    rmse_mw: 1400,
    bias_mw: 856,
    mape_percent: 12.3,
    mape_intervals: 2,
    ...overrides,
  }
}

const WINDOW = { start: '2026-01-10T00:00:00Z', end: '2026-01-11T00:00:00Z', cutoff: '2026-01-09T12:00:00Z' }
const PAGINATION = { page: 1, page_size: 200, total_items: 2, total_pages: 1 }

function forecastResponse(items: ForecastInterval[], summary: Metrics): ForecastResponse {
  return { window: WINDOW, summary, pagination: PAGINATION, items }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OverviewPage', () => {
  test('shows a loading state while the request is pending', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderWithClient(<OverviewPage state={STATE} onChange={() => {}} />)
    expect(screen.getByRole('status', { name: 'Loading hourly data' })).toBeInTheDocument()
  })

  test('requests the selected day at the day-before-noon cutoff and shows the results', async () => {
    const fetchMock = mockFetch({
      status: 200,
      body: forecastResponse(
        [
          {
            start_time: '2026-01-10T00:00:00Z',
            forecast_mw: 10_000,
            actual_mw: 9_000,
            error_mw: 1_000,
            publish_time: '2026-01-09T11:30:00Z',
            lead_hours: 12.5,
          },
          {
            start_time: '2026-01-10T01:00:00Z',
            forecast_mw: 11_000,
            actual_mw: null,
            error_mw: null,
            publish_time: '2026-01-09T11:30:00Z',
            lead_hours: 13.5,
          },
        ],
        metrics({ expected_intervals: 2, matched_intervals: 1, missing_actual: 1 }),
      ),
    })
    renderWithClient(<OverviewPage state={STATE} onChange={() => {}} />)

    expect(await screen.findByText('1,245')).toBeInTheDocument()
    expect(screen.getByText('+856')).toBeInTheDocument()
    expect(screen.getByText('Forecast above actual on average')).toBeInTheDocument()
    // Energy totals only cover the hour that has both values.
    expect(screen.getByText('10.0')).toBeInTheDocument()
    expect(screen.getByText('9.0')).toBeInTheDocument()
    expect(screen.getByText(/1 hour without complete actuals/)).toBeInTheDocument()

    const rows = screen.getAllByRole('row')
    expect(within(rows[2]).getByText('01:00–02:00')).toBeInTheDocument()
    expect(within(rows[2]).getAllByText('—').length).toBeGreaterThan(0)

    const url = requestUrl(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('cutoff')).toBe('2026-01-09T12:00:00Z')
    expect(screen.getByText(/Forecasts published by .*12:00 UK time\./)).toBeInTheDocument()
    expect(url.searchParams.get('start')).toBe('2026-01-10T00:00:00Z')
  })

  test('explains an empty result instead of showing zeros', async () => {
    mockFetch({
      status: 200,
      body: forecastResponse(
        [{ start_time: '2026-01-10T00:00:00Z', forecast_mw: null, actual_mw: 9_000, error_mw: null, publish_time: null, lead_hours: null }],
        metrics({ matched_intervals: 0, missing_forecast: 2, mae_mw: null, rmse_mw: null, bias_mw: null, mape_percent: null, mape_intervals: 0 }),
      ),
    })
    renderWithClient(<OverviewPage state={STATE} onChange={() => {}} />)

    expect(await screen.findByText('No forecasts published by this cutoff')).toBeInTheDocument()
    expect(screen.getAllByText('No matched hours')).toHaveLength(3)
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
  })

  test('shows the API error and retries on request', async () => {
    const fetchMock = mockFetch(
      { status: 503, body: { detail: 'Database unavailable. Try again shortly.' } },
      { status: 200, body: forecastResponse([], metrics()) },
    )
    renderWithClient(<OverviewPage state={STATE} onChange={() => {}} />)

    expect(await screen.findByText('Data is unavailable right now')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable. Try again shortly.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('1,245')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('labels a rejected request differently from an outage', async () => {
    mockFetch({ status: 422, body: { detail: [{ loc: ['query', 'cutoff'], msg: 'Input should be a valid datetime' }] } })
    renderWithClient(<OverviewPage state={STATE} onChange={() => {}} />)

    expect(await screen.findByText('The request was not accepted')).toBeInTheDocument()
    expect(screen.getByText('cutoff: Input should be a valid datetime')).toBeInTheDocument()
  })
})

describe('AccuracyPage', () => {
  const accuracy: AccuracyResponse = {
    window: { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z', cutoff: '2026-02-01T00:00:00Z' },
    overall: metrics({ expected_intervals: 744, matched_intervals: 744, mae_mw: 1800, bias_mw: 1593 }),
    by_delivery_date: [{ ...metrics(), delivery_date: '2026-01-10' }],
    by_lead_time: [{ ...metrics({ matched_intervals: 1200 }), lead_bucket: '0-6 h' }],
  }

  test('shows period metrics, lead-time and daily tables', async () => {
    mockFetch({ status: 200, body: accuracy })
    renderWithClient(<AccuracyPage state={STATE} onChange={() => {}} />)

    expect(await screen.findByText('1,800')).toBeInTheDocument()
    expect(screen.getByText('+1,593')).toBeInTheDocument()
    expect(screen.getByText('0–6 h')).toBeInTheDocument()
  })

  test('shows an error state when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderWithClient(<AccuracyPage state={STATE} onChange={() => {}} />)

    expect(await screen.findByText(/Cannot reach the API/)).toBeInTheDocument()
  })
})
