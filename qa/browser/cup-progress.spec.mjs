import { expect, test } from '@playwright/test'

test('resumes an unfinished Arcade Cup round after closing the game', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'ARCADE CUP', exact: true }).click()
  await expect(page.locator('[data-race-lap]')).toHaveText('1/1')
  await page.reload()
  await expect(page.getByText('Next Cup round: Meadow Loop')).toBeVisible()
  await page.getByRole('button', { name: 'RESUME CUP', exact: true }).click()
  await expect(page.locator('[data-race-countdown]')).toBeVisible()
  const state = await page.evaluate(() => window.__trackForgeQa.snapshot().race)
  expect(state.setup).toMatchObject({ handling: 'arcade', mode: 'normal', laps: 1 })
})

test('restores and completes a scored Cup after a reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('trackforge-cup-v1')) return
    localStorage.setItem('trackforge-cup-v1', JSON.stringify({
      version: 1, bestPlacement: null, checkpoint: {
        car: 'blue', difficulty: 'normal', index: 3,
        rounds: Array.from({ length: 4 }, () => [
          { id: 'player', label: 'You', points: 10 },
          { id: 'ai-1', label: 'Red', points: 6 },
        ]),
      },
    }))
  })
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'RESUME CUP', exact: true }).click()
  const final = page.getByRole('dialog', { name: 'CUP STANDINGS' })
  await expect(final.getByText('1. You · 40 points')).toBeVisible()
  await final.getByRole('button', { name: 'FINISH CUP' }).click()
  await expect(page.getByText('Best Cup placement: 1')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'RESUME CUP', exact: true })).toHaveCount(0)
  await expect(page.getByText('Best Cup placement: 1')).toBeVisible()
})
