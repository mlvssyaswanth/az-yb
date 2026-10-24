/** The URL of a stubbed fetch call: the API client hands fetch a Request, tests stub it with plain strings too. */
export function requestUrl(input: unknown): URL {
  const href = typeof input === 'string' ? input : (input as Request).url
  return new URL(href, 'http://localhost')
}
