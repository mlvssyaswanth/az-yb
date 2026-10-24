import { CHART_HEIGHT } from '@/components/charts/theme'

/** Shown in place of a chart when there is nothing to plot, at the chart's height so the page does not jump. */
export function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center px-4 text-center text-sm" style={{ minHeight: CHART_HEIGHT }}>
      {message}
    </div>
  )
}
