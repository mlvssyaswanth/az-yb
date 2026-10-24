import { expect, test } from '@playwright/test'

test('overview shows the chart, KPIs and hourly table for the default day', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Wind forecast overview' })).toBeVisible()
  await expect(page.getByLabel('Key figures')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hourly detail' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Hour \(UK\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Excel' })).toBeEnabled()
})

test('the overview states the day-ahead basis and offers no cutoff control', async ({ page }) => {
  await page.goto('/?date=2026-01-10')
  await expect(page.getByText(/Forecasts published by .*12:00 UK time\./)).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Forecasts published by' })).toHaveCount(0)
})

test('choosing a day updates the page and the URL', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Next day' }).click()
  await expect(page).toHaveURL(/date=2026-01-02/)
  await expect(page.getByText(/Friday, 2 January 2026/)).toBeVisible()
  await expect(page.getByLabel('Key figures')).toBeVisible()
})
