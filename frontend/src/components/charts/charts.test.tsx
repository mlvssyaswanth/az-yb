import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PlotData } from 'plotly.js'
import Plotly from 'plotly.js-dist-min'

import type { ForecastInterval, ForecastVersion } from '@/api/types'
import { DailyErrorChart } from '@/components/charts/DailyErrorChart'
import { ForecastActualChart } from '@/components/charts/ForecastActualChart'
import { LeadTimeChart } from '@/components/charts/LeadTimeChart'
import { PublicationTimeline } from '@/components/charts/PublicationTimeline'

const DELIVERY = new Date('2026-01-10T14:00:00Z')

function version(publish: string, forecast: number): ForecastVersion {
  const lead = (DELIVERY.getTime() - new Date(publish).getTime()) / 3_600_000
  return { start_time: DELIVERY.toISOString(), publish_time: publish, lead_hours: lead, forecast_mw: forecast, actual_mw: 8_000, error_mw: forecast - 8_000 }
}

const VERSIONS = [
  version('2026-01-08T09:30:00Z', 7_000),
  version('2026-01-09T09:30:00Z', 7_500),
  version('2026-01-10T09:30:00Z', 8_400),
]

describe('Plotly charts', () => {
  test('render nothing to Plotly when there is no data', () => {
    render(
      <>
        <ForecastActualChart items={[]} dateLabel="10 January" />
        <DailyErrorChart rows={[]} periodLabel="January 2026" />
        <LeadTimeChart rows={[]} />
      </>,
    )
    expect(screen.getByText('No forecast or actual values for this day.')).toBeInTheDocument()
    expect(screen.getByText('No delivery date has matched hours to compare.')).toBeInTheDocument()
    expect(screen.getByText('No forecast versions were matched to actuals.')).toBeInTheDocument()
    expect(Plotly.react).not.toHaveBeenCalled()
  })

  test('a day with only actuals is still plotted', async () => {
    const items: ForecastInterval[] = [
      { start_time: '2026-01-10T00:00:00Z', forecast_mw: null, actual_mw: 9_000, error_mw: null, publish_time: null, lead_hours: null },
    ]
    render(<ForecastActualChart items={items} dateLabel="10 January" />)

    expect(screen.getByRole('figure', { name: 'Forecast and actual wind generation, 10 January' })).toBeInTheDocument()
    await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1))
    const [actual, forecast] = vi.mocked(Plotly.react).mock.calls[0][1] as Partial<PlotData>[]
    expect(actual.y).toEqual([9_000])
    expect(forecast.y).toEqual([null])
  })

  test('re-renders in place when the data changes', async () => {
    const day = (actual: number): ForecastInterval[] => [
      { start_time: '2026-01-10T00:00:00Z', forecast_mw: 10_000, actual_mw: actual, error_mw: 10_000 - actual, publish_time: '2026-01-09T11:30:00Z', lead_hours: 12.5 },
    ]
    const { rerender } = render(<ForecastActualChart items={day(9_000)} dateLabel="10 January" />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1))

    rerender(<ForecastActualChart items={day(7_000)} dateLabel="10 January" />)
    await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2))
    const [actual] = vi.mocked(Plotly.react).mock.calls[1][1] as Partial<PlotData>[]
    expect(actual.y).toEqual([7_000])
    // The same element is updated rather than a new plot created.
    expect(vi.mocked(Plotly.react).mock.calls[1][0]).toBe(vi.mocked(Plotly.react).mock.calls[0][0])
  })
})

describe('PublicationTimeline', () => {
  function renderTimeline(versions: ForecastVersion[], cutoff = DELIVERY) {
    return render(<PublicationTimeline versions={versions} deliveryStart={DELIVERY} cutoff={cutoff} hourLabel="14:00" />)
  }

  test('shows a message when nothing was published by the cutoff', () => {
    renderTimeline([])
    expect(screen.getByText('No forecast for this hour was published by the selected cutoff.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('draws one dot per publication and fills only the version in use', () => {
    const { container } = renderTimeline(VERSIONS)
    const dots = container.querySelectorAll('circle[data-version]')
    expect(dots).toHaveLength(3)
    expect([...dots].map((dot) => dot.getAttribute('fill'))).toEqual(['#ffffff', '#ffffff', '#009383'])
    expect(screen.getByRole('img', { name: /Forecast versions for 14:00: 3 publications/ })).toBeInTheDocument()
    expect(screen.getByText('Delivery 14:00')).toBeInTheDocument()
  })

  test('marks the cutoff only when it falls before delivery', () => {
    renderTimeline(VERSIONS.slice(0, 2), new Date('2026-01-09T12:00:00Z'))
    expect(screen.getByText('Cutoff')).toBeInTheDocument()
  })

  test('updates when the versions change, as they do when the cutoff moves earlier', () => {
    const { container, rerender } = renderTimeline(VERSIONS)
    rerender(
      <PublicationTimeline versions={VERSIONS.slice(0, 1)} deliveryStart={DELIVERY} cutoff={new Date('2026-01-08T12:00:00Z')} hourLabel="14:00" />,
    )
    expect(container.querySelectorAll('circle[data-version]')).toHaveLength(1)
    expect(screen.getByRole('img', { name: /1 publications/ })).toBeInTheDocument()
  })

  test('arrow keys step through versions and announce each one', () => {
    renderTimeline(VERSIONS)
    const chart = screen.getByRole('img')

    fireEvent.keyDown(chart, { key: 'End' })
    expect(screen.getByText(/forecast 8,400 MW, 4\.5 h ahead, error \+400 MW\. Used at this cutoff\./)).toBeInTheDocument()

    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(screen.getByText(/Published Fri 9 Jan, 09:30 UK: forecast 7,500 MW/)).toBeInTheDocument()
  })
})
