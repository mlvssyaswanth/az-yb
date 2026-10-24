import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { deliveryHourLabels, deliveryHours } from '@/lib/time'

/** A delivery hour of the day, with previous/next buttons so neighbouring hours are one click away. */
export function HourPicker({
  date,
  value,
  onChange,
}: {
  date: string
  value: number
  onChange: (hourIndex: number) => void
}) {
  const hours = deliveryHours(date)
  const selected = Math.min(value, hours.length - 1)
  const labels = deliveryHourLabels(hours)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs" id="hour-label">
        Delivery hour (UK)
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Previous hour" disabled={selected <= 0} onClick={() => onChange(selected - 1)}>
          <ChevronLeftIcon aria-hidden />
        </Button>
        <Select value={String(selected)} onValueChange={(next) => onChange(Number(next))}>
          <SelectTrigger className="min-w-36 tabular-nums" aria-labelledby="hour-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hours.map((hour, index) => (
              <SelectItem key={hour.toISOString()} value={String(index)} className="tabular-nums">
                {labels[index]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next hour"
          disabled={selected >= hours.length - 1}
          onClick={() => onChange(selected + 1)}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </div>
  )
}
