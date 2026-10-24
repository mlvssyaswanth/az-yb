import type { ForecastInterval } from '@/api/types'
import { matchedEnergy } from '@/lib/energy'
import { formatCount, formatGwh, formatMw, formatPercent, formatSignedMw, MISSING } from '@/lib/format'

describe('format', () => {
  test('missing values are never shown as zero', () => {
    for (const format of [formatMw, formatSignedMw, formatGwh, formatPercent]) {
      expect(format(null)).toBe(MISSING)
      expect(format(undefined)).toBe(MISSING)
    }
    expect(formatMw(0)).toBe('0')
  })

  test('numbers use UK grouping and fixed precision', () => {
    expect(formatCount(14383)).toBe('14,383')
    expect(formatMw(1244.6)).toBe('1,245')
    expect(formatGwh(231.24)).toBe('231.2')
    expect(formatPercent(16.54)).toBe('16.5%')
  })

  test('signed values use a plus and a true minus sign', () => {
    expect(formatSignedMw(856.2)).toBe('+856')
    expect(formatSignedMw(-1200)).toBe('−1,200')
    expect(formatSignedMw(0)).toBe('0')
  })
})

function interval(forecast: number | null, actual: number | null): ForecastInterval {
  return {
    start_time: '2026-01-10T00:00:00Z',
    forecast_mw: forecast,
    actual_mw: actual,
    error_mw: forecast != null && actual != null ? forecast - actual : null,
    publish_time: null,
    lead_hours: null,
  }
}

describe('matchedEnergy', () => {
  test('sums only hours with both a forecast and an actual', () => {
    const energy = matchedEnergy([interval(10_000, 8_000), interval(12_000, 10_000), interval(9_000, null), interval(null, 7_000)])
    expect(energy).toEqual({
      forecastGwh: 22,
      actualGwh: 18,
      meanForecastMw: 11_000,
      meanActualMw: 9_000,
      matchedHours: 2,
    })
  })

  test('returns null rather than zero when nothing matched', () => {
    expect(matchedEnergy([interval(9_000, null)])).toBeNull()
    expect(matchedEnergy([])).toBeNull()
  })
})
