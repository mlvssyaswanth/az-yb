import { summarisePublications } from '@/lib/publications'

describe('summarisePublications', () => {
  test('reports the range of publications used and their lead times', () => {
    expect(
      summarisePublications([
        { publish_time: '2026-01-09T23:30:00Z', lead_hours: 1.5 },
        { publish_time: '2026-01-09T11:30:00Z', lead_hours: 12.5 },
        { publish_time: '2026-01-09T11:30:00Z', lead_hours: 13.5 },
        { publish_time: null, lead_hours: null },
      ]),
    ).toEqual({ count: 2, first: '2026-01-09T11:30:00Z', last: '2026-01-09T23:30:00Z', minLeadHours: 1.5, maxLeadHours: 13.5 })
  })

  test('is null when no hour had a forecast by the cutoff', () => {
    expect(summarisePublications([{ publish_time: null, lead_hours: null }])).toBeNull()
    expect(summarisePublications([])).toBeNull()
  })
})
