import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'

test('Race Again restores the original night race setup after reload', async ({ page }) => {
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: 'Race Harbor Grid', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  await setup.locator('[data-car="red"]').click()
  await setup.getByRole('button', { name: 'Night', exact: true }).click()
  await setup.getByRole('button', { name: 'Start Race', exact: true }).click()
  const original = await page.evaluate(() => window.__trackForgeQa.snapshot().race.setup)
  expect(original).toMatchObject({ car: 'red', lighting: 'night' })
  await page.locator('[data-action="pause"]').click()
  await page.getByRole('button', { name: 'QUIT TO HOME', exact: true }).click()
  await page.reload()
  await enterTrackForge(page)
  await page.getByRole('button', { name: /RACE AGAIN.*Harbor Grid/i }).click()
  await expect.poll(async () =>
    page.evaluate(() => window.__trackForgeQa.snapshot().race?.setup),
  ).toMatchObject({
    car: original.car, lighting: original.lighting,
    difficulty: original.difficulty,
    laps: original.laps, mode: original.mode,
  })
  // Race Again is a new race (not Retry), so its grid can be reshuffled.
  const grid = await page.evaluate(() => window.__trackForgeQa.snapshot().race?.setup?.gridPositions)
  expect([...grid].sort()).toEqual([0, 1, 2, 3])
})
