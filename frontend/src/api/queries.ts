import { QueryClient, useQuery } from '@tanstack/react-query'

import { api, ApiError } from '@/api/client'
import { dayAheadCutoff } from '@/lib/cutoff'
import { deliveryDayWindow, deliveryHours } from '@/lib/time'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000, // stored data only changes when ingestion runs
      // Retry network failures and 5xx once; a 4xx will not succeed on retry.
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status !== null && error.status < 500),
    },
  },
})

/** One delivery day on the day-ahead basis. */
export function useDeliveryDay(date: string) {
  return useQuery({
    queryKey: ['forecast', date],
    queryFn: ({ signal }) =>
      api.forecast({ ...deliveryDayWindow(date), cutoff: dayAheadCutoff(date) }, signal),
  })
}

/** Accuracy over UK delivery dates `from` to `to`, both inclusive. */
export function usePeriodAccuracy(from: string, to: string) {
  return useQuery({
    queryKey: ['accuracy', from, to],
    queryFn: ({ signal }) => {
      const end = deliveryDayWindow(to).end
      return api.accuracy({ start: deliveryDayWindow(from).start, end, cutoffRule: 'day-ahead' }, signal)
    },
  })
}

export function useForecastVersions(date: string, hourIndex: number) {
  const hours = deliveryHours(date)
  const start = hours[Math.min(hourIndex, hours.length - 1)]
  return useQuery({
    queryKey: ['forecast-history', date, hourIndex],
    queryFn: ({ signal }) =>
      api.forecastHistory(
        { start, end: new Date(start.getTime() + 3_600_000), cutoff: dayAheadCutoff(date) },
        signal,
      ),
  })
}
