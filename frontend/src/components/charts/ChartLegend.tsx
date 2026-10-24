export interface LegendItem {
  label: string
  color: string
  mark: 'line' | 'dashed' | 'bar' | 'dot'
}

function Swatch({ color, mark }: Omit<LegendItem, 'label'>) {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden className="shrink-0">
      {mark === 'bar' && <rect x="4" y="0" width="10" height="10" rx="2" fill={color} />}
      {mark === 'dot' && <circle cx="9" cy="5" r="4" fill={color} />}
      {(mark === 'line' || mark === 'dashed') && (
        <line x1="0" x2="18" y1="5" y2="5" stroke={color} strokeWidth="2" strokeDasharray={mark === 'dashed' ? '4 3' : undefined} />
      )}
    </svg>
  )
}

/** One legend style for every chart, Plotly or D3, placed in the panel header above the plot. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="text-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} mark={item.mark} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
