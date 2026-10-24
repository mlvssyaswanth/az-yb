import { useMemo } from 'react'

import type { ForecastInterval } from '@/api/types'
import { ChartEmpty } from '@/components/charts/ChartEmpty'
import { PlotlyChart } from '@/components/charts/PlotlyChart'
import { forecastActualLayout, forecastActualTraces } from '@/components/charts/traces'

/** Hourly forecast and actual wind generation for one delivery day. */
export function ForecastActualChart({ items, dateLabel }: { items: ForecastInterval[]; dateLabel: string }) {
  const data = useMemo(() => forecastActualTraces(items), [items])
  const layout = useMemo(() => forecastActualLayout(items), [items])

  if (items.every((row) => row.forecast_mw == null && row.actual_mw == null)) {
    return <ChartEmpty message="No forecast or actual values for this day." />
  }
  return (
    <PlotlyChart
      data={data}
      layout={layout}
      label={`Forecast and actual wind generation, ${dateLabel}`}
      summary={`Line chart of ${items.length} delivery hours in megawatts. Gaps mark hours without a forecast or a complete actual. Values are listed in the hourly table.`}
    />
  )
}
