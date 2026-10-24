import type { PlotData } from 'plotly.js'

import type { DeliveryDateMetrics, ForecastInterval, LeadTimeMetrics, Metrics } from '@/api/types'
import { CHART_COLORS } from '@/components/charts/theme'
import {
  dailyErrorTraces,
  forecastActualLayout,
  forecastActualTraces,
  leadBucketLabel,
  leadTimeTraces,
} from '@/components/charts/traces'

const asPlot = (trace: unknown) => trace as Partial<PlotData>

function interval(start: string, forecast: number | null, actual: number | null): ForecastInterval {
  return {
    start_time: start,
    forecast_mw: forecast,
    actual_mw: actual,
    error_mw: forecast != null && actual != null ? forecast - actual : null,
    publish_time: forecast != null ? '2026-01-09T11:30:00Z' : null,
    lead_hours: forecast != null ? 12.5 : null,
  }
}

const METRICS: Metrics = {
  expected_intervals: 24,
  matched_intervals: 24,
  missing_forecast: 0,
  missing_actual: 0,
  coverage: 1,
  mae_mw: 1000,
  rmse_mw: 1200,
  bias_mw: 500,
  mape_percent: 10,
  mape_intervals: 24,
}

describe('forecast vs actual traces', () => {
  const items = [
    interval('2026-01-10T00:00:00Z', 10_000, 9_000),
    interval('2026-01-10T01:00:00Z', null, 9_500),
    interval('2026-01-10T02:00:00Z', 11_000, null),
  ]

  test('keep missing values as gaps rather than zeros or bridged lines', () => {
    const [actual, forecast] = forecastActualTraces(items).map(asPlot)
    expect(actual.y).toEqual([9_000, 9_500, null])
    expect(forecast.y).toEqual([10_000, null, 11_000])
    expect(actual.connectgaps).toBe(false)
    expect(forecast.connectgaps).toBe(false)
  })

  test('label delivery hours in UK time and put publication time in the forecast hover', () => {
    const [actual, forecast] = forecastActualTraces(items).map(asPlot)
    expect(actual.x).toEqual(['00:00–01:00', '01:00–02:00', '02:00–03:00'])
    expect(forecast.customdata?.[0]).toEqual(['Fri 9 Jan, 11:30', '12.5 h'])
    expect(forecast.hovertemplate).toContain('published')
    expect(forecastActualLayout(items).xaxis?.title).toEqual({ text: 'Delivery hour (UK time)' })
  })

  test('an empty day gives empty traces', () => {
    for (const trace of forecastActualTraces([]).map(asPlot)) expect(trace.x).toEqual([])
  })
})

describe('error traces', () => {
  test('daily bias is coloured by sign and missing days stay null', () => {
    const rows: DeliveryDateMetrics[] = [
      { ...METRICS, delivery_date: '2026-01-01', bias_mw: 800 },
      { ...METRICS, delivery_date: '2026-01-02', bias_mw: -300 },
      { ...METRICS, delivery_date: '2026-01-03', matched_intervals: 0, mae_mw: null, bias_mw: null },
    ]
    const [bias, mae] = dailyErrorTraces(rows).map(asPlot)
    expect(bias.y).toEqual([800, -300, null])
    expect((bias.marker as { color: string[] }).color.slice(0, 2)).toEqual([CHART_COLORS.over, CHART_COLORS.under])
    expect(mae.y).toEqual([1000, 1000, null])
    expect(mae.connectgaps).toBe(false)
  })

  test('lead-time buckets keep the API order and use an en dash', () => {
    const rows: LeadTimeMetrics[] = ['0-6 h', '6-12 h', '48-66.5 h'].map((bucket) => ({ ...METRICS, lead_bucket: bucket }))
    const [mae] = leadTimeTraces(rows).map(asPlot)
    expect(mae.x).toEqual(['0–6 h', '6–12 h', '48–66.5 h'])
    expect(leadBucketLabel('12-24 h')).toBe('12–24 h')
  })
})
