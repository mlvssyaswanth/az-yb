import { render, screen } from '@testing-library/react'

import { ErrorMarginNote } from '@/components/ErrorMarginNote'

const NAME = 'What this means for a day-ahead buy'

test('forecasts above actual mean wind may come in lower than forecast', () => {
  render(<ErrorMarginNote mae={2018} bias={1806} />)
  const note = screen.getByRole('note', { name: NAME })
  expect(note).toHaveTextContent('±2,018 MW')
  expect(note).toHaveTextContent('1,806 MW above')
  expect(note).toHaveTextContent('wind may come in lower than forecast')
})

test('forecasts below actual mean wind may come in higher than forecast', () => {
  render(<ErrorMarginNote mae={900} bias={-300} />)
  const note = screen.getByRole('note', { name: NAME })
  expect(note).toHaveTextContent('300 MW below')
  expect(note).toHaveTextContent('wind may come in higher than forecast')
})

test('no net bias is stated without a direction', () => {
  render(<ErrorMarginNote mae={500} bias={0} />)
  expect(screen.getByRole('note', { name: NAME })).toHaveTextContent('no net bias')
})

test('renders nothing when no hour could be compared', () => {
  const { container } = render(<ErrorMarginNote mae={null} bias={null} />)
  expect(container).toBeEmptyDOMElement()
})
