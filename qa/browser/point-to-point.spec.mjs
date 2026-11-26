import { expect, test } from '@playwright/test'
import { readSavedTracks } from './saved-tracks.mjs'
import { enterTrackForge } from '../enter-game.mjs'

const trackId = 'mobile-open-route'

test('persists an open route and displays its ordered finish splits', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript((id) => {
    if (localStorage.getItem('trackforge-library-v2')) return
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id, name: 'Open Stage', version: 8, lighting: 'day', createdAt: 1, updatedAt: 1,
      points: [
        { x: 0, y: 0, surface: 'street' },
        { x: 600, y: 0, surface: 'street' },
        { x: 1_200, y: 0, surface: 'street' },
      ],
      recoveryCheckpoints: [0.25, 0.5, 0.75],
      trees: [], terrain: { cellSize: 32, cells: [] },
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, trackId)
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Track editor', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Open Stage', exact: true }).click()
  await page.getByRole('button', { name: 'Editor menu' }).click()
  await page.getByRole('combobox', { name: 'Route type' }).selectOption('point-to-point')
  await page.getByRole('button', { name: 'SAVE TRACK', exact: true }).click()
  await expect.poll(async () => (await readSavedTracks(page))
    .find(track => track.id === trackId)?.routeKind).toBe('point-to-point')
  await expect(page.locator('[data-tool="start"]')).toHaveCount(0)

  await page.reload()
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Race', exact: true }).click()
  const selectStage = () => page.getByRole('button', { name: 'Race Open Stage', exact: true }).click()
  await selectStage()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  const results = page.locator('[data-modal="results"]')
  const race = () => page.evaluate(() => window.__trackForgeQa?.snapshot().race)
  const expectSplits = async () => {
    await page.evaluate(() => window.__trackForgeQa.advanceRace(16))
    const openSplits = results.locator('[data-action="open-race-splits"]')
    await expect(openSplits).toBeVisible({ timeout: 18_000 })
    await openSplits.click()
    const details = page.locator('[data-modal="race-splits"]')
    await expect(details.getByRole('heading', { name: 'RACE SPLITS' })).toBeVisible()
    const rows = details.locator('.results-splits-detail-row')
    await expect(rows).toHaveCount(4)
    for (const [index, gate] of ['CHECKPOINT 1', 'CHECKPOINT 2', 'CHECKPOINT 3', 'FINISH'].entries()) {
      await expect(rows.nth(index).locator('strong')).toHaveText(gate)
      await expect(rows.nth(index).locator('span').last()).toHaveText(/^\d{2}:\d{2}\.\d{3}$/)
    }
    await details.locator('[data-action="close-race-splits"]').click()
  }

  await expect(setup.getByRole('button', { name: 'Ghost Race', exact: true })).toBeDisabled()
  await setup.getByRole('button', { name: 'Time Trial', exact: true }).click()
  await setup.getByRole('button', { name: 'Start Time Trial', exact: true }).click()
  await expect.poll(race).toMatchObject({ setup: { mode: 'time-trial', laps: 1 }, vehicleCount: 1 })
  await expect(page.locator('[data-race-lap]')).toHaveText(/%$/)
  await expectSplits()
  await expect(results.getByText('BEST GHOST SAVED')).toBeVisible()

  // Session-level tests cover ghost/normal mode completion; this browser smoke
  // protects the editor -> saved route -> race HUD/results boundary only.
  await expect(results.getByRole('button', { name: 'RACE GHOST', exact: true })).toBeEnabled()
})
