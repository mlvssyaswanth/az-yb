import { addDays, deliveryDayWindow, deliveryHourLabels, deliveryHours, formatUkHour, toApiTime, ukTimeToUtc } from '@/lib/time'

describe('ukTimeToUtc', () => {
  test('winter UK time equals UTC', () => {
    expect(toApiTime(ukTimeToUtc('2026-01-10T12:00'))).toBe('2026-01-10T12:00:00Z')
  })

  test('summer UK time is one hour ahead of UTC', () => {
    expect(toApiTime(ukTimeToUtc('2026-07-01T12:00'))).toBe('2026-07-01T11:00:00Z')
  })

  test('handles the hour after the spring clock change', () => {
    // Clocks go forward at 01:00 UTC on 29 March 2026, so 02:00 UK time is 01:00 UTC.
    expect(toApiTime(ukTimeToUtc('2026-03-29T02:00'))).toBe('2026-03-29T01:00:00Z')
  })

  test('rejects malformed input', () => {
    expect(() => ukTimeToUtc('2026-01-10 12:00')).toThrow(/YYYY-MM-DDTHH:mm/)
  })
})

describe('delivery days', () => {
  test('a normal day has 24 hours starting at UK midnight', () => {
    const { start, end } = deliveryDayWindow('2026-01-10')
    expect(toApiTime(start)).toBe('2026-01-10T00:00:00Z')
    expect(toApiTime(end)).toBe('2026-01-11T00:00:00Z')
    expect(deliveryHours('2026-01-10')).toHaveLength(24)
  })

  test('clock-change days have 23 and 25 hours', () => {
    expect(deliveryHours('2026-03-29')).toHaveLength(23)
    expect(deliveryHours('2026-10-25')).toHaveLength(25)
  })

  test('a summer day starts at 23:00 UTC the day before', () => {
    expect(toApiTime(deliveryDayWindow('2026-07-01').start)).toBe('2026-06-30T23:00:00Z')
  })

  test('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  test('hours are labelled in UK time', () => {
    expect(formatUkHour('2026-07-01T11:00:00Z')).toBe('12:00')
    expect(deliveryHourLabels(['2026-07-01T11:00:00Z'])).toEqual(['12:00–13:00'])
  })

  test('hour labels name the zone around clock changes', () => {
    const autumn = deliveryHourLabels(deliveryHours('2026-10-25'))
    expect(new Set(autumn).size).toBe(25)
    expect(autumn.slice(0, 4)).toEqual(['00:00–01:00', '01:00 BST–01:00 GMT', '01:00 GMT–02:00 GMT', '02:00–03:00'])

    const spring = deliveryHourLabels(deliveryHours('2026-03-29'))
    expect(spring.slice(0, 2)).toEqual(['00:00 GMT–02:00 BST', '02:00–03:00'])
  })
})
