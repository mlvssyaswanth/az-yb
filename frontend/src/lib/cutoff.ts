import { addDays, formatUkDateTime, ukTimeToUtc } from '@/lib/time'

/**
 * The buyer's decision point: the UK day-ahead market is bid on the day before delivery, so only
 * forecasts published by 12:00 UK time that day can be used.
 */
export const DAY_AHEAD_BASIS = 'Forecasts published by 12:00 UK time the day before each delivery date'

export function dayAheadCutoff(deliveryDate: string): Date {
  return ukTimeToUtc(`${addDays(deliveryDate, -1)}T12:00`)
}

export function describeDayAhead(deliveryDate: string): string {
  return `Forecasts published by ${formatUkDateTime(dayAheadCutoff(deliveryDate))} UK time`
}
