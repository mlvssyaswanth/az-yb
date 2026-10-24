// The delivery period the backend loads (ANALYSIS_START/ANALYSIS_END in the backend settings).
// The API has no endpoint that reports it, so it is configured here; see README.
export const DELIVERY_PERIOD = {
  firstDate: '2026-01-01',
  lastDate: '2026-01-31',
  label: 'January 2026',
} as const
