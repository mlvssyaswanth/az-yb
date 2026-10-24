import { expect, test } from '@playwright/test'

test('accuracy shows the period KPIs and both tables', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Accuracy' }).click()

  await expect(page).toHaveURL(/view=accuracy/)
  await expect(page.getByRole('heading', { name: 'Forecast accuracy' })).toBeVisible()
  await expect(page.getByLabel('Key figures')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Lead time' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Delivery date' })).toBeVisible()
})

test('narrowing the period updates the heading and the daily table', async ({ page }) => {
  await page.goto('/?view=accuracy&from=2026-01-10&to=2026-01-10')

  await expect(page.getByText(/^Sat 10 Jan\./)).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Sat 10 Jan' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All of January 2026' })).toBeVisible()
})

test('the period ends are set with date fields and one button restores the month', async ({ page }) => {
  await page.goto('/?view=accuracy')

  await page.getByLabel('Period from (UK)', { exact: true }).fill('2026-01-05')
  await page.getByLabel('Period to (UK)', { exact: true }).fill('2026-01-09')
  await expect(page).toHaveURL(/from=2026-01-05&to=2026-01-09/)

  await page.getByRole('button', { name: 'All of January 2026' }).click()
  await expect(page).toHaveURL(/from=2026-01-01&to=2026-01-31/)
})

test('accuracy uses the day-ahead basis and sends the rule to the API', async ({ page }) => {
  const request = page.waitForRequest((r) => r.url().includes('/api/accuracy'))
  await page.goto('/?view=accuracy')

  expect((await request).url()).toContain('cutoff_rule=day-ahead')
  await expect(page.getByText(/Forecasts published by 12:00 UK time the day before each delivery date/)).toBeVisible()
})
