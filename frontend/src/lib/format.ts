const whole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const signedWhole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, signDisplay: 'exceptZero' })
const oneDecimal = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Placeholder for values the API reports as null (missing), never shown as 0. */
export const MISSING = '—'

export function formatCount(value: number): string {
  return whole.format(value)
}

export function formatMw(value: number | null | undefined): string {
  return value == null ? MISSING : whole.format(value)
}

export function formatSignedMw(value: number | null | undefined): string {
  // Intl uses a hyphen-minus; a true minus sign lines up with the plus in tabular figures.
  return value == null ? MISSING : signedWhole.format(value).replace('-', '−')
}

export function formatGwh(value: number | null | undefined): string {
  return value == null ? MISSING : oneDecimal.format(value)
}

export function formatPercent(value: number | null | undefined): string {
  return value == null ? MISSING : `${oneDecimal.format(value)}%`
}

export function formatHours(value: number | null | undefined): string {
  return value == null ? MISSING : `${oneDecimal.format(value)} h`
}
