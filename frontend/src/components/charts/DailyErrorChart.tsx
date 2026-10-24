import { useMemo } from 'react'

import type { DeliveryDateMetrics } from '@/api/types'
import { ChartEmpty } from '@/components/charts/ChartEmpty'
import { PlotlyChart } from '@/components/charts/PlotlyChart'
import { DAILY_ERROR_LAYOUT, dailyErrorTraces } from '@/components/charts/traces'

/** Daily bias (signed bars) and MAE (line) across the delivery period. */
export function DailyErrorChart({ rows, periodLabel }: { rows: DeliveryDateMetrics[]; periodLabel: string }) {
  const data = useMemo(() => dailyErrorTraces(rows), [rows])

  if (rows.every((row) => row.mae_mw == null)) return <ChartEmpty message="No delivery date has matched hours to compare." />
  return (
    <PlotlyChart
      data={data}
      layout={DAILY_ERROR_LAYOUT}
      label={`Daily forecast error, ${periodLabel}`}
      summary={`Bars show the mean signed error (bias) for each of ${rows.length} delivery dates, a line shows the mean absolute error, both in megawatts. Values are listed in the daily table.`}
    />
  )
}
