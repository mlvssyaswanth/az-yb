import type { ReactNode } from 'react'

import { InfoTip } from '@/components/InfoTip'
import { Skeleton } from '@/components/ui/skeleton'

export interface Kpi {
  label: string
  help: ReactNode
  value: string
  unit: string
  detail: ReactNode
}

/** Headline figures in one panel; the 1px grid gap over the border colour draws the dividers. */
export function KpiStrip({ items, loading = false }: { items: Kpi[]; loading?: boolean }) {
  return (
    <dl aria-label="Key figures" className="bg-border grid grid-cols-1 gap-px overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-card flex flex-col gap-1 px-4 py-3">
          <dt className="text-muted-foreground text-sm">
            <InfoTip label={item.label}>{item.help}</InfoTip>
          </dt>
          <dd className="flex items-baseline gap-1.5">
            {loading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <span className="text-[1.75rem] leading-tight font-semibold tabular-nums">{item.value}</span>
                <span className="text-muted-foreground text-sm">{item.unit}</span>
              </>
            )}
          </dd>
          <dd className="text-muted-foreground text-xs">{loading ? <Skeleton className="h-4 w-36" /> : item.detail}</dd>
        </div>
      ))}
    </dl>
  )
}
