import type { ForecastInterval } from '@/api/types'
import { DataTable } from '@/components/DataTable'
import { InfoTip } from '@/components/InfoTip'
import { SignedError } from '@/components/SignedError'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatHours, formatMw, MISSING } from '@/lib/format'
import { deliveryHourLabels, formatUkDateTime } from '@/lib/time'

export function IntervalTable({ rows }: { rows: ForecastInterval[] }) {
  const hourLabels = deliveryHourLabels(rows.map((row) => row.start_time))
  const largestError = Math.max(0, ...rows.map((row) => Math.abs(row.error_mw ?? 0)))

  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead>Hour (UK)</TableHead>
          <TableHead className="text-right">
            <InfoTip label="Forecast (MW)">WINDFOR forecast for the hour, from the latest publication by the cutoff.</InfoTip>
          </TableHead>
          <TableHead className="text-right">
            <InfoTip label="Actual (MW)">
              Mean of the two half-hourly FUELHH wind outturn values in the hour. Missing if either half-hour is missing.
            </InfoTip>
          </TableHead>
          <TableHead className="text-right">
            <InfoTip label="Error (MW)">Forecast minus actual. Positive means the forecast was too high.</InfoTip>
          </TableHead>
          <TableHead>Published (UK)</TableHead>
          <TableHead className="text-right">
            <InfoTip label="Lead time">Hours between publication and the start of delivery.</InfoTip>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.start_time}>
            <TableCell className="font-medium">
              {hourLabels[index]}
            </TableCell>
            <TableCell className="text-right">{formatMw(row.forecast_mw)}</TableCell>
            <TableCell className="text-right">{formatMw(row.actual_mw)}</TableCell>
            <TableCell className="text-right">
              <SignedError value={row.error_mw} scale={largestError} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.publish_time ? formatUkDateTime(row.publish_time) : 'No forecast by cutoff'}
            </TableCell>
            <TableCell className="text-right">{row.lead_hours == null ? MISSING : formatHours(row.lead_hours)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  )
}
