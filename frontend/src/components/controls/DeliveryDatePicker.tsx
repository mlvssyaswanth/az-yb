import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DELIVERY_PERIOD } from '@/config'
import { addDays } from '@/lib/time'

/**
 * A UK delivery date: a native date field with previous/next buttons. `min` and `max` narrow the
 * choice within the delivery period, e.g. so the end of a range cannot precede its start.
 */
export function DeliveryDatePicker({
  value,
  onChange,
  label = 'Delivery date (UK)',
  min = DELIVERY_PERIOD.firstDate,
  max = DELIVERY_PERIOD.lastDate,
}: {
  value: string
  onChange: (date: string) => void
  label?: string
  min?: string
  max?: string
}) {
  const inputId = useId()
  // The default picker keeps the short button names; extra pickers on a page say which one they are.
  const prefix = label === 'Delivery date (UK)' ? '' : `${label}: `

  return (
    <div className="flex flex-col gap-1">
      <label className="text-muted-foreground text-xs" htmlFor={inputId}>
        {label}
      </label>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label={`${prefix}Previous day`}
          disabled={value <= min}
          onClick={() => onChange(addDays(value, -1))}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Input
          id={inputId}
          type="date"
          className="w-40 tabular-nums"
          value={value}
          min={min}
          max={max}
          onChange={(event) => {
            // The field is empty or partial while typing; only report a complete date inside the range.
            const date = event.target.value
            if (date >= min && date <= max) onChange(date)
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label={`${prefix}Next day`}
          disabled={value >= max}
          onClick={() => onChange(addDays(value, 1))}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </div>
  )
}
