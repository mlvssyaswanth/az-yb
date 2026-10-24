import '@testing-library/jest-dom/vitest'

// Plotly needs a real layout engine, which jsdom lacks. Tests check the traces passed to
// Plotly.react instead of the drawn SVG.
vi.mock('plotly.js-dist-min', () => ({
  default: { react: vi.fn(async () => {}), purge: vi.fn(), Plots: { resize: vi.fn() } },
}))

afterEach(() => {
  vi.clearAllMocks()
})

// jsdom has no matchMedia; the sidebar's useIsMobile hook needs it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// Radix Select uses pointer capture and scrollIntoView, which jsdom does not implement.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}
