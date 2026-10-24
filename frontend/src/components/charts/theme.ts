// Chart colours. Plotly and SVG attributes need literal values, so these mirror the tokens in
// index.css. Forecast/actual and the over/under pair were checked together for colour-vision
// deficiency separation and 3:1 contrast on white.
export const CHART_COLORS = {
  forecast: '#009383',
  actual: '#6250d6',
  over: '#b26b00', // --over
  under: '#2f67b1', // --under
  ink: '#14211a', // --foreground
  muted: '#57665c', // --muted-foreground
  grid: '#e4e9e5',
  axis: '#c9d3cc', // --input
} as const

export const CHART_FONT = "'IBM Plex Sans Variable', ui-sans-serif, system-ui, sans-serif"

export const CHART_HEIGHT = 320
