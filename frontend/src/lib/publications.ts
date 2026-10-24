export interface Publication {
  publish_time: string | null
  lead_hours: number | null
}

export interface PublicationSummary {
  count: number // distinct publication times
  first: string
  last: string
  minLeadHours: number
  maxLeadHours: number
}

/**
 * Which forecast publications the displayed values come from. With the "latest" cutoff each
 * hour can use a different publication, so this reports the range. Null when no hour had a
 * forecast published by the cutoff.
 */
export function summarisePublications(rows: Publication[]): PublicationSummary | null {
  const used = rows.filter((row): row is { publish_time: string; lead_hours: number } => row.publish_time != null && row.lead_hours != null)
  if (used.length === 0) return null
  // ISO 8601 UTC strings sort chronologically.
  const times = [...new Set(used.map((row) => row.publish_time))].sort()
  const leads = used.map((row) => row.lead_hours)
  return {
    count: times.length,
    first: times[0],
    last: times[times.length - 1],
    minLeadHours: Math.min(...leads),
    maxLeadHours: Math.max(...leads),
  }
}
