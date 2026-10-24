import { expect, test } from '@playwright/test'

test('overview shows an error state when the API is unavailable', async ({ page }) => {
  await page.route('**/api/forecast*', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'database_unavailable', message: 'Database unavailable' } } }),
  )
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByLabel('Key figures')).toHaveCount(0)
})

test('accuracy shows an error state when the API is unreachable', async ({ page }) => {
  await page.route('**/api/accuracy*', (route) => route.abort())
  await page.goto('/?view=accuracy')

  await expect(page.getByText(/Cannot reach the API/)).toBeVisible()
})
