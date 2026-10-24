// Pure functions that turn API rows into Plotly traces and layouts. Kept apart from the chart
// components so they can be tested without rendering Plotly.
import type { Data, Layout, LayoutAxis } from 'plotly.js'

import type { DeliveryDateMetrics, ForecastInterval, LeadTimeMetrics } from '@/api/types'
import { CHART_COLORS } from '@/components/charts/theme'
import { formatHours } from '@/lib/format'
import { deliveryHourLabels, formatUkDateTime, formatUkHour } from '@/lib/time'

// Plotly supports a custom title for the unified hover box; @types/plotly.js does not list it yet.
type Axis = Partial<LayoutAxis> & { unifiedhovertitle?: { text: string } }

export function forecastActualTraces(items: ForecastInterval[]): Data[] {
  // One category per delivery hour, labelled with its UK wall-clock span.
  const x = deliveryHourLabels(items.map((row) => row.start_time))
  // Nulls stay null so Plotly breaks the line at missing hours instead of bridging them.
  const common = { type: 'scatter', mode: 'lines+markers', x, connectgaps: false, marker: { size: 6 } } as const
  return [
    {
      ...common,
      name: 'Actual',
      y: items.map((row) => row.actual_mw),
      line: { color: CHART_COLORS.actual, width: 2 },
      hovertemplate: 'Actual %{y:,.0f} MW<extra></extra>',
    },
    {
      ...common,
      name: 'Forecast',
      y: items.map((row) => row.forecast_mw),
      line: { color: CHART_COLORS.forecast, width: 2, dash: 'dash' },
      customdata: items.map((row) => [row.publish_time ? formatUkDateTime(row.publish_time) : '', formatHours(row.lead_hours)]),
      hovertemplate: 'Forecast %{y:,.0f} MW<br>published %{customdata[0]} UK, %{customdata[1]} ahead<extra></extra>',
    },
  ]
}

export function forecastActualLayout(items: ForecastInterval[]): Partial<Layout> {
  const labels = deliveryHourLabels(items.map((row) => row.start_time))
  // Label every third hour by its start time; the hover shows the full span.
  const tickIndexes = labels.map((_, index) => index).filter((index) => index % 3 === 0)
  return {
    hovermode: 'x unified',
    showlegend: false,
    xaxis: {
      type: 'category',
      title: { text: 'Delivery hour (UK time)' },
      unifiedhovertitle: { text: 'Delivery %{x} UK' },
      tickvals: tickIndexes.map((index) => labels[index]),
      ticktext: tickIndexes.map((index) => formatUkHour(items[index].start_time)),
    } satisfies Axis as Partial<LayoutAxis>,
    yaxis: { title: { text: 'Generation (MW)' }, rangemode: 'tozero' },
  }
}

/** Bar colour for a signed error: amber above zero, blue below, matching the tables. */
export function signColors(values: (number | null)[]): string[] {
  return values.map((value) => ((value ?? 0) >= 0 ? CHART_COLORS.over : CHART_COLORS.under))
}

export function dailyErrorTraces(rows: DeliveryDateMetrics[]): Data[] {
  const x = rows.map((row) => row.delivery_date)
  const bias = rows.map((row) => row.bias_mw)
  return [
    {
      type: 'bar',
      name: 'Bias',
      x,
      y: bias,
      marker: { color: signColors(bias) },
      hovertemplate: 'Bias %{y:+,.0f} MW<extra></extra>',
    },
    {
      type: 'scatter',
      mode: 'lines+markers',
      name: 'MAE',
      x,
      y: rows.map((row) => row.mae_mw),
      connectgaps: false, // a day without matched hours is a gap, not an interpolated value
      line: { color: CHART_COLORS.forecast, width: 2 },
      marker: { size: 6 },
      customdata: rows.map((row) => [row.matched_intervals, row.expected_intervals]),
      hovertemplate: 'MAE %{y:,.0f} MW<br>%{customdata[0]} of %{customdata[1]} hours matched<extra></extra>',
    },
  ]
}

export const DAILY_ERROR_LAYOUT: Partial<Layout> = {
  hovermode: 'x unified',
  showlegend: false,
  bargap: 0.35,
  xaxis: {
    type: 'date',
    title: { text: 'Delivery date (UK)' },
    tickformat: '%-d %b',
    unifiedhovertitle: { text: 'Delivery %{x|%a %-d %b}' },
  } satisfies Axis as Partial<LayoutAxis>,
  yaxis: { title: { text: 'Error (MW)' }, zeroline: true },
}

/** "0-6 h" from the API becomes "0–6 h" (an en dash for a range). */
export const leadBucketLabel = (bucket: string) => bucket.replace('-', '–')

export function leadTimeTraces(rows: LeadTimeMetrics[]): Data[] {
  const x = rows.map((row) => leadBucketLabel(row.lead_bucket))
  const bias = rows.map((row) => row.bias_mw)
  return [
    {
      type: 'bar',
      name: 'MAE',
      x,
      y: rows.map((row) => row.mae_mw),
      marker: { color: CHART_COLORS.forecast },
      customdata: rows.map((row) => [row.rmse_mw, row.matched_intervals]),
      hovertemplate: 'MAE %{y:,.0f} MW<br>RMSE %{customdata[0]:,.0f} MW<br>%{customdata[1]:,} forecast versions<extra></extra>',
    },
    {
      type: 'bar',
      name: 'Bias',
      x,
      y: bias,
      marker: { color: signColors(bias) },
      hovertemplate: 'Bias %{y:+,.0f} MW<extra></extra>',
    },
  ]
}

export const LEAD_TIME_LAYOUT: Partial<Layout> = {
  hovermode: 'x unified',
  showlegend: false,
  barmode: 'group',
  bargap: 0.3,
  bargroupgap: 0.08,
  xaxis: {
    type: 'category',
    title: { text: 'Lead time (publication to delivery)' },
    unifiedhovertitle: { text: 'Published %{x} before delivery' },
  } satisfies Axis as Partial<LayoutAxis>,
  yaxis: { title: { text: 'Error (MW)' }, zeroline: true },
}
