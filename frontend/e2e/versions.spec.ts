import { expect, test } from '@playwright/test'

test('forecast versions lists publications and the timeline responds to the arrow keys', async ({ page }) => {
  await page.goto('/?view=versions&date=2026-01-10&hour=12')

  await expect(page.getByRole('heading', { name: 'Forecast versions' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Publications, oldest first' })).toBeVisible()

  const timeline = page.getByRole('img', { name: /Forecast versions for/ })
  await expect(timeline).toBeVisible()
  await timeline.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(timeline).toBeFocused()
})
