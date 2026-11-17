import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 844, height: 390 } })

test('starts a mobile race in the production bundle', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'RACE', exact: true }).tap()
  await page.getByRole('button', { name: 'Race Starter Circuit', exact: true }).tap()
  await page.getByRole('dialog', { name: 'Race setup' })
    .getByRole('button', { name: 'START RACE', exact: true }).tap()

  const race = page.locator('[data-screen="race"]')
  await expect(race).toBeVisible()
  await expect(race.locator('[data-race-countdown]')).toHaveText(/^[123]$/)
  const clock = race.locator('[data-race-time]')
  await expect.poll(async () => Number((await clock.textContent() ?? '').replace(/[:.]/g, '')))
    .toBeGreaterThan(0)
  expect(errors).toEqual([])
})
