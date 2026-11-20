import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'

const trackId = 'mobile-open-route'

test('converts a route in the editor and races it in all three modes', async ({ page }) => {
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
      trees: [], terrain: { cellSize: 32, cells: [] },
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, trackId)
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()
  await page.getByRole('button', { name: 'Editor menu' }).click()
  await page.getByRole('button', { name: 'Point to point', exact: true }).click()
  await page.getByRole('button', { name: 'SAVE TRACK', exact: true }).click()
  await expect.poll(() => page.evaluate(id =>
    JSON.parse(localStorage.getItem('trackforge-library-v2'))
      .find(track => track.id === id)?.routeKind, trackId)).toBe('point-to-point')
  await expect(page.locator('[data-tool="start"]')).toHaveCount(0)

  await page.reload()
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  const selectStage = () => page.getByRole('button', { name: 'Race Open Stage', exact: true }).click()
  await selectStage()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  const results = page.locator('[data-modal="results"]')
  const race = () => page.evaluate(() => window.__trackForgeQa?.snapshot().race)
  const expectSplits = async () => {
    await page.evaluate(() => window.__trackForgeQa.advanceRace(16))
    await expect(results.getByRole('heading', { name: 'SPLITS', exact: true })).toBeVisible({ timeout: 18_000 })
    for (const gate of ['CHECKPOINT 1', 'CHECKPOINT 2', 'CHECKPOINT 3', 'FINISH']) {
      await expect(results.getByText(new RegExp(`^${gate} · \\d{2}:\\d{2}\\.\\d{3}$`))).toBeVisible()
    }
  }

  await expect(setup.getByRole('button', { name: 'GHOST RACE', exact: true })).toBeDisabled()
  await setup.getByRole('button', { name: 'TIME TRIAL', exact: true }).click()
  await setup.getByRole('button', { name: 'START TIME TRIAL', exact: true }).click()
  await expect.poll(race).toMatchObject({ setup: { mode: 'time-trial', laps: 1 }, vehicleCount: 1 })
  await expect(page.locator('[data-race-lap]')).toHaveText(/%$/)
  await expectSplits()
  await expect(results.getByText('BEST GHOST SAVED')).toBeVisible()

  await results.getByRole('button', { name: 'RACE GHOST', exact: true }).click()
  await expect.poll(race).toMatchObject({ setup: { mode: 'ghost', laps: 1 }, vehicleCount: 1, ghostVisible: true })
  await expectSplits()

  await results.getByRole('button', { name: 'CHANGE TRACK', exact: true }).click()
  await selectStage()
  await setup.getByRole('button', { name: 'RACE AI', exact: true }).click()
  await setup.getByRole('button', { name: 'START RACE', exact: true }).click()
  await expect.poll(race).toMatchObject({ setup: { mode: 'normal', laps: 1 }, vehicleCount: 4 })
  await expectSplits()
  await results.getByRole('button', { name: 'RETRY', exact: true }).click()
  await expect.poll(race).toMatchObject({ setup: { mode: 'normal', laps: 1 }, phase: 'countdown' })
})
