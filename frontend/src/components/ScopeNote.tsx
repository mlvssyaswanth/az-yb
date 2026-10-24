import { InfoIcon } from 'lucide-react'

/** The limit of what wind data can tell a procurement team. */
export function ScopeNote() {
  return (
    <p className="text-muted-foreground flex gap-2 text-sm">
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Wind only. These figures compare Elexon's national wind forecast with metered wind generation. Full electricity
        procurement requirements also depend on demand, other generation, embedded generation and interconnector flows, so
        they cannot be calculated from this data.
      </span>
    </p>
  )
}
