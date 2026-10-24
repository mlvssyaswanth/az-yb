import { curveStepAfter, extent, line, max, scaleLinear, scaleUtc } from 'd3'
import { type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from 'react'

import type { ForecastVersion } from '@/api/types'
import { ChartEmpty } from '@/components/charts/ChartEmpty'
import { CHART_COLORS, CHART_HEIGHT } from '@/components/charts/theme'
import { useElementWidth } from '@/hooks/useElementWidth'
import { formatHours, formatMw, formatSignedMw } from '@/lib/format'
import { formatUkDateTime, formatUkHour, formatUkShortDate } from '@/lib/time'

const MARGIN = { top: 36, right: 20, bottom: 62, left: 64 }
const HOUR = 3_600_000

interface Point {
  version: ForecastVersion
  published: Date
}

/**
 * How the forecast for one delivery hour changed across publications. The x axis is
 * publication time, so delivery is a single marker at the right; each forecast holds until
 * the next one is published (a step), and the version in use at the cutoff is the last one.
 *
 * Built with D3 scales and shapes; React renders the SVG so it re-renders with the filters.
 */
export function PublicationTimeline({
  versions,
  deliveryStart,
  cutoff,
  hourLabel,
}: {
  versions: ForecastVersion[]
  deliveryStart: Date
  cutoff: Date
  hourLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(containerRef)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const points: Point[] = useMemo(
    () =>
      versions
        .map((version) => ({ version, published: new Date(version.publish_time) }))
        .sort((a, b) => a.published.getTime() - b.published.getTime()),
    [versions],
  )
  const actual = versions.find((version) => version.actual_mw != null)?.actual_mw ?? null
  const showCutoff = cutoff.getTime() < deliveryStart.getTime()

  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 120)
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom

  const { x, y } = useMemo(() => {
    const [first] = extent(points, (point) => point.published.getTime())
    const start = first ?? deliveryStart.getTime() - HOUR
    // A little room either side so the first dot and the delivery marker are not on the edge.
    const padding = Math.max((deliveryStart.getTime() - start) * 0.03, HOUR / 2)
    const xScale = scaleUtc()
      .domain([new Date(start - padding), new Date(deliveryStart.getTime() + padding)])
      .range([0, innerWidth])
    const top = max([...points.map((point) => point.version.forecast_mw), actual ?? 0]) ?? 0
    const yScale = scaleLinear()
      .domain([0, top * 1.1 || 1000])
      .nice()
      .range([innerHeight, 0])
    return { x: xScale, y: yScale }
  }, [points, actual, deliveryStart, innerWidth, innerHeight])

  if (points.length === 0) return <ChartEmpty message="No forecast for this hour was published by the selected cutoff." />

  // Each forecast stands until the next publication; the last one stands until delivery.
  const stepPath =
    line<{ time: Date; mw: number }>()
      .x((d) => x(d.time))
      .y((d) => y(d.mw))
      .curve(curveStepAfter)([
      ...points.map((point) => ({ time: point.published, mw: point.version.forecast_mw })),
      { time: deliveryStart, mw: points[points.length - 1].version.forecast_mw },
    ]) ?? ''

  const xTicks = x.ticks(Math.max(2, Math.floor(innerWidth / 90)))
  const yTicks = y.ticks(5)
  const usedIndex = points.length - 1
  const active = activeIndex === null ? null : points[Math.min(activeIndex, usedIndex)]

  function nearestIndex(pointerX: number): number {
    const time = x.invert(pointerX).getTime()
    let best = 0
    points.forEach((point, index) => {
      if (Math.abs(point.published.getTime() - time) < Math.abs(points[best].published.getTime() - time)) best = index
    })
    return best
  }

  function onPointerMove(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    setActiveIndex(nearestIndex(event.clientX - bounds.left))
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const current = activeIndex ?? usedIndex
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: usedIndex }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setActiveIndex(Math.max(0, Math.min(usedIndex, next)))
  }

  const tooltipLeft = active ? MARGIN.left + x(active.published) : 0

  return (
    <div ref={containerRef} className="relative">
      <svg
        width={width}
        height={CHART_HEIGHT}
        role="img"
        tabIndex={0}
        aria-label={`Forecast versions for ${hourLabel}: ${points.length} publications. Use the left and right arrow keys to step through them.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActiveIndex(null)}
        className="focus-visible:ring-ring/50 block rounded-sm outline-none focus-visible:ring-[3px]"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`} fontSize={12} fill={CHART_COLORS.muted}>
          {yTicks.map((tick) => (
            <g key={tick} transform={`translate(0,${y(tick)})`}>
              <line x2={innerWidth} stroke={tick === 0 ? CHART_COLORS.axis : CHART_COLORS.grid} />
              <text x={-8} dy="0.32em" textAnchor="end">
                {formatMw(tick)}
              </text>
            </g>
          ))}
          <text transform={`translate(${-MARGIN.left + 14},${innerHeight / 2}) rotate(-90)`} textAnchor="middle">
            Forecast for the hour (MW)
          </text>

          {xTicks.map((tick, index) => {
            const day = formatUkShortDate(tick)
            const showDay = index === 0 || day !== formatUkShortDate(xTicks[index - 1])
            return (
              <g key={tick.getTime()} transform={`translate(${x(tick)},${innerHeight})`}>
                <line y2={5} stroke={CHART_COLORS.axis} />
                <text y={18} textAnchor="middle">
                  {formatUkHour(tick)}
                </text>
                {showDay && (
                  <text y={32} textAnchor="middle">
                    {day}
                  </text>
                )}
              </g>
            )
          })}
          <text x={innerWidth} y={innerHeight + 54} textAnchor="end">
            Publication time (UK)
          </text>

          {actual !== null && (
            <g>
              <line x2={innerWidth} y1={y(actual)} y2={y(actual)} stroke={CHART_COLORS.actual} strokeWidth={2} strokeDasharray="6 4" />
            </g>
          )}

          {showCutoff && (
            <g transform={`translate(${x(cutoff)},0)`}>
              <line y1={-8} y2={innerHeight} stroke={CHART_COLORS.muted} strokeDasharray="2 3" />
              <text y={-12} textAnchor="end" dx={-4}>
                Cutoff
              </text>
            </g>
          )}
          <g transform={`translate(${x(deliveryStart)},0)`}>
            <line y1={-24} y2={innerHeight} stroke={CHART_COLORS.ink} />
            <text y={-28} textAnchor="end" dx={4} fill={CHART_COLORS.ink}>
              Delivery {hourLabel}
            </text>
          </g>

          <path d={stepPath} fill="none" stroke={CHART_COLORS.forecast} strokeWidth={2} />
          {active && <line x1={x(active.published)} x2={x(active.published)} y2={innerHeight} stroke={CHART_COLORS.axis} />}
          {points.map((point, index) => (
            <circle
              key={point.version.publish_time}
              data-version={point.version.publish_time}
              cx={x(point.published)}
              cy={y(point.version.forecast_mw)}
              r={index === usedIndex || index === activeIndex ? 5.5 : 4}
              fill={index === usedIndex ? CHART_COLORS.forecast : '#ffffff'}
              stroke={CHART_COLORS.forecast}
              strokeWidth={2}
            />
          ))}

          {/* Pointer target over the whole plot, larger than the dots so they are easy to hit. */}
          <rect
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActiveIndex(null)}
          />
        </g>
      </svg>

      <div aria-live="polite" className="sr-only">
        {active && describeVersion(active.version, active === points[usedIndex])}
      </div>
      {active && (
        <div
          aria-hidden
          className="bg-popover text-popover-foreground pointer-events-none absolute top-2 z-10 w-max max-w-60 rounded-md border px-3 py-2 text-xs shadow-sm"
          style={
            tooltipLeft > width / 2 ? { right: width - tooltipLeft + 12 } : { left: tooltipLeft + 12 }
          }
        >
          <p className="font-medium">Published {formatUkDateTime(active.version.publish_time)} UK</p>
          <p className="tabular-nums">Forecast {formatMw(active.version.forecast_mw)} MW, {formatHours(active.version.lead_hours)} ahead</p>
          {active.version.error_mw !== null && (
            <p className="tabular-nums">Error {formatSignedMw(active.version.error_mw)} MW</p>
          )}
          {active === points[usedIndex] && <p className="text-primary font-medium">Used at this cutoff</p>}
        </div>
      )}
    </div>
  )
}

function describeVersion(version: ForecastVersion, used: boolean): string {
  const error = version.error_mw === null ? '' : `, error ${formatSignedMw(version.error_mw)} MW`
  return `Published ${formatUkDateTime(version.publish_time)} UK: forecast ${formatMw(version.forecast_mw)} MW, ${formatHours(
    version.lead_hours,
  )} ahead${error}${used ? '. Used at this cutoff.' : '.'}`
}
