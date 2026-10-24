// The API works in UTC; the team thinks in UK local time. These helpers convert between the two
// using the browser's time-zone database, so clock-change days get 23 or 25 hours.

export const UK_TIME_ZONE = 'Europe/London'

const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  timeZoneName: 'longOffset',
})

/** Minutes UK local time is ahead of UTC at the given instant (0 in winter, 60 in summer). */
function ukOffsetMinutes(instant: Date): number {
  const name = offsetFormatter.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '')
  if (!match) return 0 // "GMT" with no offset
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '+' ? minutes : -minutes
}

/** Converts a UK wall-clock time "YYYY-MM-DDTHH:mm" to the UTC instant it denotes. */
export function ukTimeToUtc(local: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!match) throw new Error(`Expected YYYY-MM-DDTHH:mm, got "${local}"`)
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute)
  // The offset depends on the instant we are solving for, so refine the guess once.
  const firstGuess = asIfUtc - ukOffsetMinutes(new Date(asIfUtc)) * 60_000
  return new Date(asIfUtc - ukOffsetMinutes(new Date(firstGuess)) * 60_000)
}

/** Adds days to a "YYYY-MM-DD" calendar date. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** UTC bounds [start, end) of a UK delivery day. */
export function deliveryDayWindow(date: string): { start: Date; end: Date } {
  return { start: ukTimeToUtc(`${date}T00:00`), end: ukTimeToUtc(`${addDays(date, 1)}T00:00`) }
}

/** Each delivery hour of a UK day, as UTC instants. */
export function deliveryHours(date: string): Date[] {
  const { start, end } = deliveryDayWindow(date)
  const hours: Date[] = []
  for (let time = start.getTime(); time < end.getTime(); time += 3_600_000) hours.push(new Date(time))
  return hours
}

/** ISO 8601 in UTC without milliseconds, as the API expects. */
export function toApiTime(instant: Date): string {
  return instant.toISOString().replace('.000Z', 'Z')
}

const formatters = {
  hour: new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIME_ZONE, hour: '2-digit', minute: '2-digit' }),
  dateTime: new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }),
  longDate: new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', // calendar dates are already UK dates; format them without shifting
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  shortDate: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }),
  ukShortDate: new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }),
}

/** UK date of an instant, e.g. "Fri 9 Jan". */
export const formatUkShortDate = (instant: Date | string) => formatters.ukShortDate.format(new Date(instant))

const zoneFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: UK_TIME_ZONE, timeZoneName: 'short' })

export const formatUkHour = (instant: Date | string) => formatters.hour.format(new Date(instant))

/** "GMT" or "BST" at the given instant. */
const ukZone = (instant: Date) => zoneFormatter.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ?? ''

/**
 * UK wall-clock labels for delivery hours, e.g. "14:00–15:00". Around a clock change the
 * plain form is ambiguous (01:00 happens twice in October) or odd (00:00–02:00 in March), so
 * those hours name the zone at each end: "01:00 BST–01:00 GMT", "01:00 GMT–02:00 GMT".
 */
export function deliveryHourLabels(starts: (Date | string)[]): string[] {
  const hours = starts.map((value) => {
    const start = new Date(value)
    return { start, end: new Date(start.getTime() + 3_600_000) }
  })
  const startTexts = hours.map(({ start }) => formatUkHour(start))
  return hours.map(({ start, end }, index) => {
    const repeated = startTexts.indexOf(startTexts[index]) !== startTexts.lastIndexOf(startTexts[index])
    const crossesChange = ukZone(start) !== ukZone(end)
    return repeated || crossesChange
      ? `${formatUkHour(start)} ${ukZone(start)}–${formatUkHour(end)} ${ukZone(end)}`
      : `${formatUkHour(start)}–${formatUkHour(end)}`
  })
}

/** Label for a single delivery hour, with the same clock-change handling. */
export const deliveryHourLabel = (start: Date | string) => deliveryHourLabels([start])[0]
export const formatUkDateTime = (instant: Date | string) => formatters.dateTime.format(new Date(instant))
export const formatCalendarDate = (date: string) => formatters.longDate.format(new Date(`${date}T00:00:00Z`))
export const formatShortCalendarDate = (date: string) => formatters.shortDate.format(new Date(`${date}T00:00:00Z`))
