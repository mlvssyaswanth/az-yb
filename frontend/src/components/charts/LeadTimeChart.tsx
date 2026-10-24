import { useMemo } from 'react'

import type { LeadTimeMetrics } from '@/api/types'
import { ChartEmpty } from '@/components/charts/ChartEmpty'
import { PlotlyChart } from '@/components/charts/PlotlyChart'
import { LEAD_TIME_LAYOUT, leadTimeTraces } from '@/components/charts/traces'

/** MAE and bias for each lead-time bucket, side by side. */
export function LeadTimeChart({ rows }: { rows: LeadTimeMetrics[] }) {
  const data = useMemo(() => leadTimeTraces(rows), [rows])

  if (rows.every((row) => row.mae_mw == null)) return <ChartEmpty message="No forecast versions were matched to actuals." />
  return (
    <PlotlyChart
      data={data}
      layout={LEAD_TIME_LAYOUT}
      label="Forecast error by lead time"
      summary={`Grouped bars of mean absolute error and bias in megawatts for ${rows.length} lead-time buckets. Values are listed in the lead-time table.`}
    />
  )
}
