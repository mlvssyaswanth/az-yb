import { formatSignedMw } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Signed error with a small bar scaled to the largest error on screen. The sign is always in
 * the text; the bar colour (amber over, blue under) only reinforces it.
 */
export function SignedError({ value, scale }: { value: number | null; scale: number }) {
  if (value == null) return <span className="text-muted-foreground">{formatSignedMw(value)}</span>
  const width = scale > 0 ? Math.max((Math.abs(value) / scale) * 100, 2) : 0
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="tabular-nums">{formatSignedMw(value)}</span>
      <span className="bg-muted hidden h-2 w-16 overflow-hidden rounded-sm sm:block" aria-hidden>
        <span
          className={cn('block h-full rounded-sm', value >= 0 ? 'bg-over' : 'bg-under')}
          style={{ width: `${width}%` }}
        />
      </span>
    </span>
  )
}

export function ErrorLegend() {
  return (
    <span className="text-muted-foreground flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1">
        <span className="bg-over inline-block size-2.5 rounded-sm" aria-hidden /> Over-forecast (+)
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-under inline-block size-2.5 rounded-sm" aria-hidden /> Under-forecast (−)
      </span>
    </span>
  )
}
