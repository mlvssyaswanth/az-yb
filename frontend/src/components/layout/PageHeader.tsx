import type { ReactNode } from 'react'

/**
 * Page heading with the filters beneath it. From md up it stays pinned under the app bar while the
 * page content scrolls; it bleeds to the edges of the padded content area so nothing shows around it.
 */
export function PageHeader({ title, subtitle, controls }: { title: string; subtitle?: ReactNode; controls?: ReactNode }) {
  return (
    <header className="bg-background -mx-4 -mt-6 border-b px-4 pt-5 pb-4 sm:-mx-6 sm:px-6 md:sticky md:top-14 md:z-10 lg:-mx-8 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
      {controls && (
        <div className="bg-card mt-4 flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg border px-4 py-3" role="group" aria-label="Filters">
          {controls}
        </div>
      )}
    </header>
  )
}
