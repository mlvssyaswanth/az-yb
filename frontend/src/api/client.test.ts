import axios from 'axios'

import { api, ApiError } from '@/api/client'
import { requestUrl } from '@/test/requests'

const window = {
  start: new Date('2026-01-10T00:00:00Z'),
  end: new Date('2026-01-11T00:00:00Z'),
  cutoff: new Date('2026-01-09T12:00:00Z'),
}

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  test('sends the window as UTC query parameters', async () => {
    const fetchMock = respondWith(200, { items: [] })
    await api.forecast(window)

    const url = requestUrl(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/forecast')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start: '2026-01-10T00:00:00Z',
      end: '2026-01-11T00:00:00Z',
      cutoff: '2026-01-09T12:00:00Z',
      page_size: '200',
    })
  })

  test('sends a cutoff rule instead of a fixed cutoff', async () => {
    const fetchMock = respondWith(200, {})
    await api.accuracy({ start: window.start, end: window.end, cutoffRule: 'day-ahead' })
    const url = requestUrl(fetchMock.mock.calls[0][0])
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start: '2026-01-10T00:00:00Z',
      end: '2026-01-11T00:00:00Z',
      cutoff_rule: 'day-ahead',
    })
  })

  test('omits parameters that are not set', async () => {
    const fetchMock = respondWith(200, {})
    await api.accuracy({})
    const url = requestUrl(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/api/accuracy')
    expect(url.search).toBe('')
  })

  test('uses a string detail as the message', async () => {
    respondWith(503, { detail: 'Database unavailable. Try again shortly.' })
    const error = await caught(api.forecast(window))
    expect(error.status).toBe(503)
    expect(error.message).toBe('Database unavailable. Try again shortly.')
  })

  test('joins validation errors with the field each one refers to', async () => {
    respondWith(422, {
      detail: [
        { loc: ['query', 'start'], msg: 'Value error, must be on the hour' },
        { loc: ['query', 'end'], msg: 'Value error, must be after start' },
      ],
    })
    const error = await caught(api.forecast(window))
    expect(error.status).toBe(422)
    expect(error.message).toBe('start: Value error, must be on the hour; end: Value error, must be after start')
  })

  test('explains a proxy error without a JSON body as the API being down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })))
    const error = await caught(api.forecast(window))
    expect(error.status).toBe(502)
    expect(error.message).toBe('The API is not responding (HTTP 502). Check that the backend is running.')
  })

  test('reports an unreachable API without a status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await caught(api.forecast(window))
    expect(error.status).toBeNull()
    expect(error.message).toMatch(/Cannot reach the API/)
  })

  test('gives up on a request the API never answers', async () => {
    vi.useFakeTimers()
    // A fetch that only ends when the client aborts it.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (request: Request) =>
          new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))),
      ),
    )
    const pending = caught(api.forecast(window))
    await vi.advanceTimersByTimeAsync(20_000)
    const error = await pending
    expect(error.status).toBeNull()
    expect(error.message).toBe('The API did not respond in time. Try again shortly.')
    vi.useRealTimers()
  })

  test('lets cancelled requests propagate unchanged', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (request: Request) =>
          new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))),
      ),
    )
    const pending = api.forecast(window, controller.signal).catch((reason: unknown) => reason)
    controller.abort()
    expect(axios.isCancel(await pending)).toBe(true)
  })
})
