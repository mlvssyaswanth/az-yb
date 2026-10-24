import { readState, toSearch } from '@/hooks/useDashboardState'

const DEFAULTS = { view: 'overview', date: '2026-01-01', hour: 12, from: '2026-01-01', to: '2026-01-31' }

describe('dashboard state from the URL', () => {
  test('reads a valid query string and writes it back unchanged', () => {
    const search = 'view=versions&date=2026-01-10&hour=14&from=2026-01-05&to=2026-01-12'
    const state = readState(`?${search}`)
    expect(state).toEqual({ view: 'versions', date: '2026-01-10', hour: 14, from: '2026-01-05', to: '2026-01-12' })
    expect(toSearch(state)).toBe(search)
  })

  test('a removed view falls back to the overview', () => {
    expect(readState('?view=calculator').view).toBe('overview')
  })

  test('replaces invalid values with defaults instead of sending them to the API', () => {
    expect(readState('?view=admin&date=2026-02-10&hour=99')).toEqual(DEFAULTS)
    expect(readState('?date=2026-1-5&hour=-1')).toEqual(DEFAULTS)
    expect(readState('?hour=1.5')).toEqual(DEFAULTS)
  })

  test('an inverted or partial analysis period falls back to the whole month', () => {
    expect(readState('?from=2026-01-20&to=2026-01-10')).toMatchObject({ from: '2026-01-01', to: '2026-01-31' })
    expect(readState('?from=2026-01-20')).toMatchObject({ from: '2026-01-01', to: '2026-01-31' })
    expect(readState('?from=2025-12-31&to=2026-01-10')).toMatchObject({ from: '2026-01-01', to: '2026-01-31' })
  })
})
