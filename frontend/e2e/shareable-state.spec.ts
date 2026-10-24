import { expect, test } from '@playwright/test'

test('a URL with parameters loads the same view', async ({ page }) => {
  await page.goto('/?view=versions&date=2026-01-10&hour=6')

  await expect(page.getByRole('heading', { name: 'Forecast versions' })).toBeVisible()
  await expect(page).toHaveURL(/date=2026-01-10/)
  await expect(page).toHaveURL(/hour=6/)
})

test('invalid parameters fall back to the defaults', async ({ page }) => {
  await page.goto('/?view=nonsense&date=2030-05-05&hour=99')

  await expect(page.getByRole('heading', { name: 'Wind forecast overview' })).toBeVisible()
  await expect(page).toHaveURL(/view=overview/)
  await expect(page).toHaveURL(/date=2026-01-01/)
  await expect(page).toHaveURL(/hour=12/)
})
