import type { ForecastInterval } from '@/api/types'
import type { ExportData } from '@/components/DataTable'
import { deliveryHourLabels, formatUkDateTime } from '@/lib/time'

const HEADERS = ['Hour (UK)', 'Forecast (MW)', 'Actual (MW)', 'Error (MW)', 'Published (UK)', 'Lead time (hours)']

export function intervalExport(rows: ForecastInterval[], fileName = 'hourly-detail'): ExportData {
  const hourLabels = deliveryHourLabels(rows.map((row) => row.start_time))
  return {
    fileName,
    headers: HEADERS,
    rows: rows.map((row, index) => [
      hourLabels[index],
      row.forecast_mw,
      row.actual_mw,
      row.error_mw,
      row.publish_time ? formatUkDateTime(row.publish_time) : 'No forecast by cutoff',
      row.lead_hours,
    ]),
  }
}
