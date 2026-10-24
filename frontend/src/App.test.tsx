import { render, screen } from '@testing-library/react'

import App from './App'

test('opens the overview for the first delivery date by default', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  render(<App />)

  expect(screen.getByRole('heading', { name: 'Wind forecast overview' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Accuracy' }).length).toBeGreaterThan(0)
  expect(window.location.search).toBe('?view=overview&date=2026-01-01&hour=12&from=2026-01-01&to=2026-01-31')
  vi.unstubAllGlobals()
})
