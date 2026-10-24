import type { Config, Data, Layout } from 'plotly.js'
import { useEffect, useRef, useState } from 'react'

import { CHART_COLORS, CHART_FONT, CHART_HEIGHT } from '@/components/charts/theme'
import { Skeleton } from '@/components/ui/skeleton'

type PlotlyModule = typeof import('plotly.js-dist-min').default

// Plotly is large (about 1.4 MB gzipped), so it is loaded on first use, in its own chunk.
let plotlyPromise: Promise<PlotlyModule> | null = null
function loadPlotly(): Promise<PlotlyModule> {
  plotlyPromise ??= import('plotly.js-dist-min').then((module) => module.default)
  return plotlyPromise
}

const BASE_LAYOUT: Partial<Layout> = {
  autosize: true,
  height: CHART_HEIGHT,
  margin: { t: 8, r: 16, b: 56, l: 64 },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: CHART_FONT, size: 12, color: CHART_COLORS.muted },
  hoverlabel: { bgcolor: '#ffffff', bordercolor: CHART_COLORS.axis, font: { family: CHART_FONT, color: CHART_COLORS.ink } },
  legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1, yanchor: 'bottom', font: { color: CHART_COLORS.ink } },
  xaxis: { gridcolor: CHART_COLORS.grid, linecolor: CHART_COLORS.axis, fixedrange: true, automargin: true },
  yaxis: {
    gridcolor: CHART_COLORS.grid,
    zerolinecolor: CHART_COLORS.axis,
    fixedrange: true,
    automargin: true,
    tickformat: ',.0f',
  },
}

// Zoom and the toolbar add little to charts of at most a month; the tables hold exact values.
const CONFIG: Partial<Config> = { displayModeBar: false, responsive: true, scrollZoom: false }

/** Merges per-chart layout over the shared defaults, one level deep for axes and legend. */
function mergeLayout(layout: Partial<Layout>): Partial<Layout> {
  return {
    ...BASE_LAYOUT,
    ...layout,
    legend: { ...BASE_LAYOUT.legend, ...layout.legend },
    xaxis: { ...BASE_LAYOUT.xaxis, ...layout.xaxis },
    yaxis: { ...BASE_LAYOUT.yaxis, ...layout.yaxis },
  }
}

/**
 * Renders Plotly traces into a div and re-renders when they change. `label` names the chart
 * for assistive technology and `summary` describes what it shows; the same values are always
 * available in a table next to the chart, so the plot itself is hidden from screen readers.
 */
export function PlotlyChart({ data, layout, label, summary }: { data: Data[]; layout: Partial<Layout>; label: string; summary: string }) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const element = plotRef.current
    if (!element) return
    let cancelled = false
    loadPlotly()
      .then((Plotly) => {
        // Plotly.react diffs against the previous render, so filter changes update in place.
        if (!cancelled) return Plotly.react(element, data, mergeLayout(layout), CONFIG)
      })
      .then(() => {
        if (!cancelled) setDrawn(true)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [data, layout])

  // `responsive` only follows window resizes; this also catches layout changes such as the
  // navigation rail appearing at the md breakpoint.
  useEffect(() => {
    const element = plotRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      loadPlotly().then((Plotly) => {
        if (element.isConnected && element.querySelector('.main-svg')) void Plotly.Plots.resize(element)
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = plotRef.current
    return () => {
      if (element) void loadPlotly().then((Plotly) => Plotly.purge(element))
    }
  }, [])

  return (
    <figure aria-label={label} className="m-0">
      {loadFailed ? (
        <p className="text-muted-foreground px-4 py-10 text-center text-sm">The chart could not be loaded. The table below has the same data.</p>
      ) : (
        <div className="relative">
          {/* Plotly downloads on first use; hold the space and show progress until it has drawn. */}
          {!drawn && <Skeleton role="status" aria-label="Loading chart" className="absolute inset-4" />}
          <div ref={plotRef} aria-hidden style={{ minHeight: layout.height ?? CHART_HEIGHT }} />
        </div>
      )}
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}
