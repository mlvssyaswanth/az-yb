import { useForecastVersions } from '@/api/queries'
import type { ForecastVersion } from '@/api/types'
import { ChartLegend } from '@/components/charts/ChartLegend'
import { PublicationTimeline } from '@/components/charts/PublicationTimeline'
import { CHART_COLORS } from '@/components/charts/theme'
import { DeliveryDatePicker } from '@/components/controls/DeliveryDatePicker'
import { HourPicker } from '@/components/controls/HourPicker'
import { DataTable, ExcelDownloadButton, type ExportData } from '@/components/DataTable'
import { EmptyState, ErrorState, LoadingBlock } from '@/components/DataStates'
import { InfoTip } from '@/components/InfoTip'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel } from '@/components/Panel'
import { ErrorLegend, SignedError } from '@/components/SignedError'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardState } from '@/hooks/useDashboardState'
import { describeDayAhead } from '@/lib/cutoff'
import { formatHours, formatMw } from '@/lib/format'
import { deliveryHourLabels, deliveryHours, formatCalendarDate, formatUkDateTime, formatUkHour } from '@/lib/time'

function versionsExport(rows: ForecastVersion[], fileName: string): ExportData {
  return {
    fileName,
    headers: ['Published (UK)', 'Lead time (hours)', 'Forecast (MW)', 'Actual (MW)', 'Error (MW)'],
    rows: rows.map((row) => [formatUkDateTime(row.publish_time), row.lead_hours, row.forecast_mw, row.actual_mw, row.error_mw]),
  }
}

function VersionsTable({ rows }: { rows: ForecastVersion[] }) {
  const largestError = Math.max(0, ...rows.map((row) => Math.abs(row.error_mw ?? 0)))
  const lastIndex = rows.length - 1

  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead>Published (UK)</TableHead>
          <TableHead className="text-right">Lead time</TableHead>
          <TableHead className="text-right">Forecast (MW)</TableHead>
          <TableHead className="text-right">Actual (MW)</TableHead>
          <TableHead className="text-right">
            <InfoTip label="Error (MW)">Forecast minus actual. Positive means the forecast was too high.</InfoTip>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.publish_time} data-state={index === lastIndex ? 'selected' : undefined}>
            <TableCell>
              {formatUkDateTime(row.publish_time)}
              {index === lastIndex && <span className="text-primary ml-2 text-xs font-medium">Used at this cutoff</span>}
            </TableCell>
            <TableCell className="text-right">{formatHours(row.lead_hours)}</TableCell>
            <TableCell className="text-right">{formatMw(row.forecast_mw)}</TableCell>
            <TableCell className="text-right">{formatMw(row.actual_mw)}</TableCell>
            <TableCell className="text-right">
              <SignedError value={row.error_mw} scale={largestError} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  )
}

export function VersionsPage({
  state,
  onChange,
}: {
  state: DashboardState
  onChange: (changes: Partial<DashboardState>) => void
}) {
  const query = useForecastVersions(state.date, state.hour)
  const hours = deliveryHours(state.date)
  const hour = hours[Math.min(state.hour, hours.length - 1)]
  const hourLabel = deliveryHourLabels(hours)[Math.min(state.hour, hours.length - 1)]

  return (
    <>
      <PageHeader
        title="Forecast versions"
        subtitle={`How the forecast for ${hourLabel} on ${formatCalendarDate(state.date)} changed with each publication.`}
        controls={
          <>
            <DeliveryDatePicker value={state.date} onChange={(date) => onChange({ date })} />
            <HourPicker date={state.date} value={state.hour} onChange={(hourIndex) => onChange({ hour: hourIndex })} />
          </>
        }
      />
      <Panel
        title="Forecast by publication time"
        description="Each dot is a publication; a forecast holds until the next one. Filled dot: the version used."
        actions={
          <ChartLegend
            items={[
              { label: 'Forecast version', color: CHART_COLORS.forecast, mark: 'dot' },
              { label: 'Actual for the hour', color: CHART_COLORS.actual, mark: 'dashed' },
              { label: 'Delivery start', color: CHART_COLORS.ink, mark: 'line' },
            ]}
          />
        }
      >
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <LoadingBlock rows={8} label="Loading forecast timeline" />
        ) : (
          <div className="px-2 pt-2 pb-1">
            <PublicationTimeline
              versions={query.data.items}
              deliveryStart={hour}
              cutoff={new Date(query.data.window.cutoff)}
              hourLabel={formatUkHour(hour)}
            />
          </div>
        )}
      </Panel>
      <Panel
        title="Publications, oldest first"
        description={`${describeDayAhead(state.date)}. Later publications are hidden.`}
        actions={
          <>
            <ErrorLegend />
            {query.data && query.data.items.length > 0 && (
              <ExcelDownloadButton
                exportData={versionsExport(query.data.items, `forecast-versions-${state.date}-hour-${state.hour}`)}
              />
            )}
          </>
        }
      >
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <LoadingBlock rows={8} label="Loading forecast versions" />
        ) : query.data.items.length === 0 ? (
          <EmptyState title="No forecasts published by this cutoff">
            No forecast for this hour was published by the selected time. Choose a later cutoff.
          </EmptyState>
        ) : (
          <VersionsTable rows={query.data.items} />
        )}
      </Panel>
    </>
  )
}
