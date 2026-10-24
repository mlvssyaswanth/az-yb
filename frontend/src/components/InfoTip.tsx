import { InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** A label followed by a small focusable icon that explains it. */
export function InfoTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={typeof label === 'string' ? `About ${label}` : 'More information'}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <InfoIcon className="size-3.5" aria-hidden />
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-left leading-snug font-normal">{children}</TooltipContent>
      </Tooltip>
    </span>
  )
}
