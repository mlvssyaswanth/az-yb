import axios, { AxiosError } from 'axios'

import type { AccuracyResponse, ForecastHistoryResponse, ForecastResponse, WindowParams } from '@/api/types'
import { toApiTime } from '@/lib/time'

// Empty by default: requests go to /api on the same origin (nginx in Docker, the Vite proxy in
// development). Set VITE_API_BASE_URL to call an API on another origin (it must allow CORS).
const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}/api`

// One delivery day has at most 25 hours and one hour about 25 forecast versions, so a single
// page always holds everything the dashboard asks for.
const PAGE_SIZE = 200

// The largest query (a month of accuracy) answers in well under a second; anything near this
// limit means the API is stuck, so give up and show an error rather than an endless loader.
const REQUEST_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Turns FastAPI's {"detail": ...} (a string, or a list of validation errors) into one message. */
function describeError(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item: { loc?: unknown[]; msg?: string }) => `${item.loc?.at(-1) ?? 'request'}: ${item.msg ?? 'invalid'}`)
      .join('; ')
  }
  // No JSON body: typically the proxy answering because the API itself is down.
  if (status >= 500) return `The API is not responding (HTTP ${status}). Check that the backend is running.`
  return `The API returned HTTP ${status}.`
}

// The fetch adapter keeps the browser's own fetch as the transport (as before) and works under
// jsdom, where tests stub fetch; axios' default XHR adapter would bypass those stubs.
const http = axios.create({ baseURL: API_BASE, timeout: REQUEST_TIMEOUT_MS, adapter: 'fetch' })

async function getJson<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) {
  try {
    // Parameters left undefined are dropped by axios.
    const response = await http.get<T>(path, { params, signal })
    return response.data
  } catch (error) {
    // Cancelled by React Query (the filters changed); not an error to show.
    if (axios.isCancel(error)) throw error
    if (!axios.isAxiosError(error)) throw error
    if (error.code === AxiosError.ETIMEDOUT || error.code === AxiosError.ECONNABORTED) {
      throw new ApiError('The API did not respond in time. Try again shortly.', null)
    }
    if (error.response) throw new ApiError(describeError(error.response.data, error.response.status), error.response.status)
    throw new ApiError('Cannot reach the API. Check that the backend is running.', null)
  }
}

function windowParams({ start, end, cutoff, cutoffRule }: WindowParams) {
  return {
    start: start && toApiTime(start),
    end: end && toApiTime(end),
    cutoff: cutoff && toApiTime(cutoff),
    cutoff_rule: cutoffRule,
  }
}

export const api = {
  forecast: (params: WindowParams, signal?: AbortSignal) =>
    getJson<ForecastResponse>('/forecast', { ...windowParams(params), page_size: PAGE_SIZE }, signal),

  accuracy: (params: WindowParams, signal?: AbortSignal) =>
    getJson<AccuracyResponse>('/accuracy', windowParams(params), signal),

  forecastHistory: (params: WindowParams, signal?: AbortSignal) =>
    getJson<ForecastHistoryResponse>('/forecast-history', { ...windowParams(params), page_size: PAGE_SIZE }, signal),
}
