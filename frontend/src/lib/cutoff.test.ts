import { dayAheadCutoff, DAY_AHEAD_BASIS, describeDayAhead } from '@/lib/cutoff'
import { toApiTime } from '@/lib/time'

describe('day-ahead cutoff', () => {
  test('is 12:00 UK time on the day before delivery', () => {
    expect(toApiTime(dayAheadCutoff('2026-01-10'))).toBe('2026-01-09T12:00:00Z')
  })

  test('follows UK summer time', () => {
    expect(toApiTime(dayAheadCutoff('2026-07-02'))).toBe('2026-07-01T11:00:00Z')
  })

  test('names the rule in words and for a delivery date', () => {
    expect(DAY_AHEAD_BASIS).toBe('Forecasts published by 12:00 UK time the day before each delivery date')
    expect(describeDayAhead('2026-01-10')).toMatch(/^Forecasts published by .*9 Jan.*12:00 UK time$/)
  })
})
