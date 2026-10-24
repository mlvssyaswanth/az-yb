import { formatMw } from '@/lib/format'

/** Turns the period's error figures into a margin a day-ahead buyer can apply to a wind forecast. */
export function ErrorMarginNote({ mae, bias }: { mae: number | null; bias: number | null }) {
  if (mae == null || bias == null) return null
  const rounded = Math.round(bias)

  return (
    <aside
      role="note"
      aria-label="What this means for a day-ahead buy"
      className="bg-muted/50 text-foreground rounded-lg border px-4 py-3 text-sm"
    >
      <p>
        Treat a day-ahead wind forecast as uncertain by about ±{formatMw(mae)} MW (the typical absolute error).{' '}
        {rounded === 0
          ? 'There was no net bias.'
          : `On average the forecast was ${formatMw(Math.abs(rounded))} MW ${rounded > 0 ? 'above' : 'below'} the metered outturn, so wind may come in ${rounded > 0 ? 'lower' : 'higher'} than forecast.`}
      </p>
    </aside>
  )
}
