import { expect, test } from '@playwright/test'

test('Race Again restores the original night race setup after reload', async ({ page }) => {
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: 'Race Starter Circuit', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  await setup.locator('[data-car="red"]').click()
  await setup.getByRole('button', { name: 'NIGHT', exact: true }).click()
  await setup.getByRole('button', { name: 'START RACE', exact: true }).click()
  const original = await page.evaluate(() => window.__trackForgeQa.snapshot().race.setup)
  expect(original).toMatchObject({ car: 'red', lighting: 'night' })
  await page.locator('[data-action="pause"]').click()
  await page.getByRole('button', { name: 'QUIT TO HOME', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: /RACE AGAIN.*Starter Circuit/i }).click()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.setup)).toEqual(original)
})
