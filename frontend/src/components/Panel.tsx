import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** A bordered white section with an optional title row. */
export function Panel({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('bg-card rounded-md border', className)}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="text-muted-foreground text-sm">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
