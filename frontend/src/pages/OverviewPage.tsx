import { useDeliveryDay } from '@/api/queries'
import { ChartLegend } from '@/components/charts/ChartLegend'
import { ForecastActualChart } from '@/components/charts/ForecastActualChart'
import { CHART_COLORS } from '@/components/charts/theme'
import type { ForecastResponse } from '@/api/types'
import { DeliveryDatePicker } from '@/components/controls/DeliveryDatePicker'
import { CoverageNote } from '@/components/CoverageNote'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/DataStates'
import { describeDayAhead } from '@/lib/cutoff'
import { intervalExport } from '@/lib/intervalExport'
import { ExcelDownloadButton } from '@/components/DataTable'
import { IntervalTable } from '@/components/IntervalTable'
import { type Kpi, KpiStrip } from '@/components/KpiStrip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel } from '@/components/Panel'
import { ScopeNote } from '@/components/ScopeNote'
import { ErrorLegend } from '@/components/SignedError'
import type { DashboardState } from '@/hooks/useDashboardState'
import { matchedEnergy } from '@/lib/energy'
import { formatGwh, formatMw, formatSignedMw } from '@/lib/format'
import { formatCalendarDate } from '@/lib/time'

function kpis(data: ForecastResponse | undefined): Kpi[] {
  const energy = data ? matchedEnergy(data.items) : null
  const summary = data?.summary
  const basis = `over ${energy?.matchedHours ?? 0} matched hours`
  const bias = summary?.bias_mw ?? null

  return [
    {
      label: 'Forecast generation',
      help: 'Total forecast wind energy over the hours that also have an actual, so it is comparable with actual generation.',
      value: formatGwh(energy?.forecastGwh),
      unit: 'GWh',
      detail: energy ? `Mean ${formatMw(energy.meanForecastMw)} MW ${basis}` : 'No matched hours',
    },
    {
      label: 'Actual generation',
      help: 'Metered wind outturn (FUELHH) over the same matched hours.',
      value: formatGwh(energy?.actualGwh),
      unit: 'GWh',
      detail: energy ? `Mean ${formatMw(energy.meanActualMw)} MW ${basis}` : 'No matched hours',
    },
    {
      label: 'Mean absolute error',
      help: 'Average size of the hourly error, ignoring its sign. Calculated only from matched hours.',
      value: formatMw(summary?.mae_mw),
      unit: 'MW',
      detail: summary?.rmse_mw != null ? `RMSE ${formatMw(summary.rmse_mw)} MW` : 'RMSE not available',
    },
    {
      label: 'Bias',
      help: 'Mean of forecast minus actual. Positive means the forecast was too high on average.',
      value: formatSignedMw(bias),
      unit: 'MW',
      detail: bias == null ? 'No matched hours' : bias > 0 ? 'Forecast above actual on average' : bias < 0 ? 'Forecast below actual on average' : 'No net bias',
    },
  ]
}

export function OverviewPage({
  state,
  onChange,
}: {
  state: DashboardState
  onChange: (changes: Partial<DashboardState>) => void
}) {
  const query = useDeliveryDay(state.date)
  const data = query.data
  const hasMatches = (data?.summary.matched_intervals ?? 0) > 0

  return (
    <>
      <PageHeader
        title="Wind forecast overview"
        subtitle={`${formatCalendarDate(state.date)}. Wind generation forecast against metered outturn, by UK delivery hour. ${describeDayAhead(state.date)}.`}
        controls={
          <DeliveryDatePicker value={state.date} onChange={(date) => onChange({ date })} />
        }
      />

      {query.isError ? (
        <Panel>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Panel>
      ) : (
        <>
          <KpiStrip items={kpis(data)} loading={query.isPending} />
          <div className="flex flex-col gap-2">
            {data && <CoverageNote metrics={data.summary} />}
            <ScopeNote />
          </div>

          <Panel
            title="Forecast and actual generation"
            description="Hourly average MW. Gaps are hours without a forecast or a complete actual."
            actions={
              <ChartLegend
                items={[
                  { label: 'Actual', color: CHART_COLORS.actual, mark: 'line' },
                  { label: 'Forecast', color: CHART_COLORS.forecast, mark: 'dashed' },
                ]}
              />
            }
          >
            {query.isPending ? (
              <LoadingBlock rows={8} label="Loading chart" />
            ) : (
              data && <ForecastActualChart items={data.items} dateLabel={formatCalendarDate(state.date)} />
            )}
          </Panel>

          <Panel title="Hourly detail" description="Forecast used for each delivery hour and the outturn." actions={
              <>
                <ErrorLegend />
                {data && <ExcelDownloadButton exportData={intervalExport(data.items, `hourly-detail-${state.date}`)} />}
              </>
            }
          >
            {query.isPending ? (
              <LoadingBlock rows={8} label="Loading hourly data" />
            ) : data && !hasMatches && data.items.every((row) => row.forecast_mw == null) ? (
              <EmptyState title="No forecasts published by this cutoff">
                No forecast for {formatCalendarDate(state.date)} was published by the selected time. Choose a later cutoff
                to see forecasts for this day.
              </EmptyState>
            ) : (
              data && <IntervalTable rows={data.items} />
            )}
          </Panel>
        </>
      )}
    </>
  )
}
