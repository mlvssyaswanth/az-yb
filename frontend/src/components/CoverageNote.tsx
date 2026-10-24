import type { Metrics } from '@/api/types'
import { formatCount } from '@/lib/format'

function plural(count: number, word: string) {
  return `${formatCount(count)} ${word}${count === 1 ? '' : 's'}`
}

/** One sentence on how many intervals the metrics are based on, and why any are missing. */
export function CoverageNote({ metrics, unit = 'hour' }: { metrics: Metrics; unit?: string }) {
  const { expected_intervals: expected, matched_intervals: matched, missing_forecast, missing_actual } = metrics
  const gaps = [
    missing_forecast > 0 && `${plural(missing_forecast, unit)} without a forecast published by the cutoff`,
    missing_actual > 0 && `${plural(missing_actual, unit)} without complete actuals`,
  ].filter(Boolean)

  return (
    <p className="text-muted-foreground text-sm">
      Metrics use {formatCount(matched)} of {plural(expected, unit)} with both a forecast and an actual
      {gaps.length > 0 ? `: ${gaps.join('; ')}.` : '.'}
    </p>
  )
}
