import type { ForecastInterval } from '@/api/types'

export interface MatchedEnergy {
  forecastGwh: number
  actualGwh: number
  meanForecastMw: number
  meanActualMw: number
  matchedHours: number
}

/**
 * Forecast and actual energy over hours that have both values, so the two totals cover the
 * same hours and are comparable. Each value is an hourly average MW, so MW x 1 h = MWh.
 * Returns null when no hour matched rather than reporting zero generation.
 */
export function matchedEnergy(intervals: ForecastInterval[]): MatchedEnergy | null {
  const matched = intervals.filter((row) => row.forecast_mw != null && row.actual_mw != null)
  if (matched.length === 0) return null
  const forecastMwh = matched.reduce((sum, row) => sum + row.forecast_mw!, 0)
  const actualMwh = matched.reduce((sum, row) => sum + row.actual_mw!, 0)
  return {
    forecastGwh: forecastMwh / 1000,
    actualGwh: actualMwh / 1000,
    meanForecastMw: forecastMwh / matched.length,
    meanActualMw: actualMwh / matched.length,
    matchedHours: matched.length,
  }
}
