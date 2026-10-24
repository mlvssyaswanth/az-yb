import { useCallback, useEffect, useRef, useState } from 'react'

import { DELIVERY_PERIOD } from '@/config'

export type View = 'overview' | 'accuracy' | 'versions'

export interface DashboardState {
  view: View
  date: string // UK delivery date, YYYY-MM-DD
  hour: number // index of the delivery hour within the day (days can have 23-25 hours)
  from: string // analysis period for the accuracy view, inclusive UK delivery dates
  to: string
}

const VIEWS: View[] = ['overview', 'accuracy', 'versions']

const DEFAULT_STATE: DashboardState = {
  view: 'overview',
  date: DELIVERY_PERIOD.firstDate,
  hour: 12,
  from: DELIVERY_PERIOD.firstDate,
  to: DELIVERY_PERIOD.lastDate,
}

// ISO dates compare correctly as strings.
function isDateInPeriod(date: string | null): date is string {
  return date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= DELIVERY_PERIOD.firstDate && date <= DELIVERY_PERIOD.lastDate
}

/** Reads state from the query string, falling back to defaults for anything invalid. */
export function readState(search: string): DashboardState {
  const params = new URLSearchParams(search)
  const view = params.get('view') as View | null
  const date = params.get('date')
  const hour = Number(params.get('hour'))
  const from = params.get('from')
  const to = params.get('to')
  // The period is kept only as a pair, and only when it is in order.
  const periodValid = isDateInPeriod(from) && isDateInPeriod(to) && from <= to

  return {
    view: view && VIEWS.includes(view) ? view : DEFAULT_STATE.view,
    date: isDateInPeriod(date) ? date : DEFAULT_STATE.date,
    hour: params.has('hour') && Number.isInteger(hour) && hour >= 0 && hour < 25 ? hour : DEFAULT_STATE.hour,
    from: periodValid ? from : DEFAULT_STATE.from,
    to: periodValid ? to : DEFAULT_STATE.to,
  }
}

export function toSearch(state: DashboardState): string {
  return new URLSearchParams({ ...state, hour: String(state.hour) }).toString()
}

/** Dashboard selections, kept in the URL so views can be shared and the back button works. */
export function useDashboardState() {
  const [state, setState] = useState(() => readState(window.location.search))
  const isFirstRender = useRef(true)

  useEffect(() => {
    const onPopState = () => setState(readState(window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Mirror state into the URL. The first write only normalises the initial URL (no new history
  // entry); state restored by the back button already matches the URL, so nothing is pushed.
  useEffect(() => {
    const search = `?${toSearch(state)}`
    if (isFirstRender.current) {
      isFirstRender.current = false
      window.history.replaceState(null, '', search)
    } else if (search !== window.location.search) {
      window.history.pushState(null, '', search)
    }
  }, [state])

  const update = useCallback((changes: Partial<DashboardState>) => {
    setState((previous) => ({ ...previous, ...changes }))
  }, [])

  return [state, update] as const
}
