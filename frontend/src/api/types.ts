// Mirrors backend/app/schemas.py. Timestamps are ISO 8601 strings in UTC.

export interface Window {
  start: string
  end: string
  cutoff: string
  cutoff_rule?: 'day-ahead' | null
}

export interface Pagination {
  page: number
  page_size: number
  total_items: number
  total_pages: number
}

/** Error values are null when no interval matched; they are never computed from unmatched data. */
export interface Metrics {
  expected_intervals: number
  matched_intervals: number
  missing_forecast: number
  missing_actual: number
  coverage: number | null
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  mape_percent: number | null
  mape_intervals: number
}

export interface DeliveryDateMetrics extends Metrics {
  delivery_date: string
}

export interface LeadTimeMetrics extends Metrics {
  lead_bucket: string
}

export interface ForecastInterval {
  start_time: string
  forecast_mw: number | null
  actual_mw: number | null
  error_mw: number | null
  publish_time: string | null
  lead_hours: number | null
}

export interface ForecastResponse {
  window: Window
  summary: Metrics
  pagination: Pagination
  items: ForecastInterval[]
}

export interface AccuracyResponse {
  window: Window
  overall: Metrics
  by_delivery_date: DeliveryDateMetrics[]
  by_lead_time: LeadTimeMetrics[]
}

export interface ForecastVersion {
  start_time: string
  publish_time: string
  lead_hours: number
  forecast_mw: number
  actual_mw: number | null
  error_mw: number | null
}

export interface ForecastHistoryResponse {
  window: Window
  pagination: Pagination
  items: ForecastVersion[]
}

export interface WindowParams {
  start?: Date
  end?: Date
  cutoff?: Date
  cutoffRule?: 'day-ahead'
}
