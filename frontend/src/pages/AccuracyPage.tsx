import { usePeriodAccuracy } from '@/api/queries'
import type { AccuracyResponse, Metrics } from '@/api/types'
import { ChartLegend, type LegendItem } from '@/components/charts/ChartLegend'
import { DailyErrorChart } from '@/components/charts/DailyErrorChart'
import { LeadTimeChart } from '@/components/charts/LeadTimeChart'
import { leadBucketLabel } from '@/components/charts/traces'
import { CHART_COLORS } from '@/components/charts/theme'
import { DAY_AHEAD_BASIS } from '@/lib/cutoff'
import { DeliveryDatePicker } from '@/components/controls/DeliveryDatePicker'
import { CoverageNote } from '@/components/CoverageNote'
import { Button } from '@/components/ui/button'
import { DataTable, ExcelDownloadButton, type ExportData } from '@/components/DataTable'
import { ErrorMarginNote } from '@/components/ErrorMarginNote'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/DataStates'
import { InfoTip } from '@/components/InfoTip'
import { type Kpi, KpiStrip } from '@/components/KpiStrip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel } from '@/components/Panel'
import { ScopeNote } from '@/components/ScopeNote'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DELIVERY_PERIOD } from '@/config'
import type { DashboardState } from '@/hooks/useDashboardState'
import { formatCount, formatMw, formatPercent, formatSignedMw, MISSING } from '@/lib/format'
import { formatShortCalendarDate } from '@/lib/time'

const MAE_LINE: LegendItem = { label: 'MAE', color: CHART_COLORS.forecast, mark: 'line' }
const MAE_BAR: LegendItem = { label: 'MAE', color: CHART_COLORS.forecast, mark: 'bar' }
const BIAS_BARS: LegendItem[] = [
  { label: 'Bias, over-forecast (+)', color: CHART_COLORS.over, mark: 'bar' },
  { label: 'Bias, under-forecast (−)', color: CHART_COLORS.under, mark: 'bar' },
]

function kpis(overall: Metrics | undefined): Kpi[] {
  return [
    {
      label: 'Mean absolute error',
      help: 'Average size of the hourly error, ignoring its sign.',
      value: formatMw(overall?.mae_mw),
      unit: 'MW',
      detail: overall ? `Over ${formatCount(overall.matched_intervals)} matched hours` : MISSING,
    },
    {
      label: 'RMSE',
      help: 'Root mean squared error. Weights large misses more heavily than MAE.',
      value: formatMw(overall?.rmse_mw),
      unit: 'MW',
      detail: 'Same hours as MAE',
    },
    {
      label: 'Bias',
      help: 'Mean of forecast minus actual. Positive means the forecast was too high on average.',
      value: formatSignedMw(overall?.bias_mw),
      unit: 'MW',
      detail: 'Positive: over-forecast',
    },
    {
      label: 'MAPE',
      help: 'Mean absolute percentage error. Hours with a 0 MW actual are excluded to avoid dividing by zero.',
      value: formatPercent(overall?.mape_percent),
      unit: '',
      detail: overall ? `Over ${formatCount(overall.mape_intervals)} hours with a non-zero actual` : MISSING,
    },
  ]
}

function MetricHeads() {
  return (
    <>
      <TableHead className="text-right">Matched</TableHead>
      <TableHead className="text-right">MAE (MW)</TableHead>
      <TableHead className="text-right">RMSE (MW)</TableHead>
      <TableHead className="text-right">Bias (MW)</TableHead>
    </>
  )
}

function MetricCells({ metrics }: { metrics: Metrics }) {
  return (
    <>
      <TableCell className="text-right">
        {formatCount(metrics.matched_intervals)} / {formatCount(metrics.expected_intervals)}
      </TableCell>
      <TableCell className="text-right">{formatMw(metrics.mae_mw)}</TableCell>
      <TableCell className="text-right">{formatMw(metrics.rmse_mw)}</TableCell>
      <TableCell className="text-right">{formatSignedMw(metrics.bias_mw)}</TableCell>
    </>
  )
}

const METRIC_EXPORT_HEADERS = ['Matched hours', 'Expected hours', 'MAE (MW)', 'RMSE (MW)', 'Bias (MW)']

function metricExport(metrics: Metrics) {
  return [metrics.matched_intervals, metrics.expected_intervals, metrics.mae_mw, metrics.rmse_mw, metrics.bias_mw]
}

function leadTimeExport(rows: AccuracyResponse['by_lead_time']): ExportData {
  return {
    fileName: 'accuracy-by-lead-time',
    headers: ['Lead time', ...METRIC_EXPORT_HEADERS],
    rows: rows.map((row) => [leadBucketLabel(row.lead_bucket), ...metricExport(row)]),
  }
}

function dailyExport(rows: AccuracyResponse['by_delivery_date']): ExportData {
  return {
    fileName: 'accuracy-by-delivery-date',
    headers: ['Delivery date', ...METRIC_EXPORT_HEADERS],
    rows: rows.map((row) => [row.delivery_date, ...metricExport(row)]),
  }
}

function LeadTimeTable({ rows }: { rows: AccuracyResponse['by_lead_time'] }) {
  if (rows.length === 0) return <EmptyState title="No forecast versions to compare">No forecasts were matched to actuals.</EmptyState>
  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead>Lead time</TableHead>
          <MetricHeads />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.lead_bucket}>
            <TableCell className="font-medium">{leadBucketLabel(row.lead_bucket)}</TableCell>
            <MetricCells metrics={row} />
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  )
}

function DailyTable({ rows }: { rows: AccuracyResponse['by_delivery_date'] }) {
  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead>Delivery date</TableHead>
          <MetricHeads />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.delivery_date}>
            <TableCell className="font-medium">{formatShortCalendarDate(row.delivery_date)}</TableCell>
            <MetricCells metrics={row} />
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  )
}

function periodLabel(from: string, to: string): string {
  if (from === DELIVERY_PERIOD.firstDate && to === DELIVERY_PERIOD.lastDate) return DELIVERY_PERIOD.label
  return from === to ? formatShortCalendarDate(from) : `${formatShortCalendarDate(from)} to ${formatShortCalendarDate(to)}`
}

export function AccuracyPage({
  state,
  onChange,
}: {
  state: DashboardState
  onChange: (changes: Partial<DashboardState>) => void
}) {
  const query = usePeriodAccuracy(state.from, state.to)
  const data = query.data
  const label = periodLabel(state.from, state.to)
  const isWholePeriod = state.from === DELIVERY_PERIOD.firstDate && state.to === DELIVERY_PERIOD.lastDate

  return (
    <>
      <PageHeader
        title="Forecast accuracy"
        subtitle={`${label}. ${DAY_AHEAD_BASIS}, compared with outturn.`}
        controls={
          <>
            {/* Each end is limited by the other, so the period can never be inverted. */}
            <DeliveryDatePicker label="Period from (UK)" value={state.from} max={state.to} onChange={(from) => onChange({ from })} />
            <DeliveryDatePicker label="Period to (UK)" value={state.to} min={state.from} onChange={(to) => onChange({ to })} />
            {!isWholePeriod && (
              <Button
                variant="outline"
                className="self-end"
                onClick={() => onChange({ from: DELIVERY_PERIOD.firstDate, to: DELIVERY_PERIOD.lastDate })}
              >
                All of {DELIVERY_PERIOD.label}
              </Button>
            )}
          </>
        }
      />
      {query.isError ? (
        <Panel>
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </Panel>
      ) : (
        <>
          <KpiStrip items={kpis(data?.overall)} loading={query.isPending} />
          <div className="flex flex-col gap-2">
            {data && <CoverageNote metrics={data.overall} />}
            <ScopeNote />
          </div>
          {data && <ErrorMarginNote mae={data.overall.mae_mw} bias={data.overall.bias_mw} />}

          <Panel
            title="Error by delivery date"
            description="Each hour uses the latest forecast available at the day-ahead cutoff. Bars: bias (forecast minus actual). Line: MAE."
            actions={<ChartLegend items={[MAE_LINE, ...BIAS_BARS]} />}
          >
            {query.isPending ? (
              <LoadingBlock rows={8} label="Loading daily error chart" />
            ) : (
              data && <DailyErrorChart rows={data.by_delivery_date} periodLabel={label} />
            )}
          </Panel>

          <Panel
            title={
              <InfoTip label="By lead time">
                Each forecast version is grouped by how long before delivery it was published. One hour appears once per
                version, so the groups have different sizes.
              </InfoTip>
            }
            description="How accuracy changes with forecast lead time. Matched counts forecast versions."
            actions={
              <>
                <ChartLegend items={[MAE_BAR, ...BIAS_BARS]} />
                {data && data.by_lead_time.length > 0 && <ExcelDownloadButton exportData={leadTimeExport(data.by_lead_time)} />}
              </>
            }
          >
            {query.isPending ? (
              <LoadingBlock rows={6} label="Loading lead-time accuracy" />
            ) : (
              data && (
                <>
                  <LeadTimeChart rows={data.by_lead_time} />
                  <LeadTimeTable rows={data.by_lead_time} />
                </>
              )
            )}
          </Panel>

          <Panel
            title="By delivery date"
            description="Each hour uses the latest forecast allowed by the cutoff, per UK delivery date."
            actions={data && <ExcelDownloadButton exportData={dailyExport(data.by_delivery_date)} />}
          >
            {query.isPending ? (
              <LoadingBlock rows={8} label="Loading daily accuracy" />
            ) : (
              data && <DailyTable rows={data.by_delivery_date} />
            )}
          </Panel>
        </>
      )}
    </>
  )
}
