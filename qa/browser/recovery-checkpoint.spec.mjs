import { expect, test } from '@playwright/test'
import { readSavedTracks } from './saved-tracks.mjs'
import { enterTrackForge } from '../enter-game.mjs'

test('places a checkpoint while arcade ignores physical scenery collisions', async ({ page }) => {
  const id = 'checkpoint-qa'
  await page.addInitScript(trackId => {
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: trackId, name: 'Checkpoint QA', version: 8, routeKind: 'point-to-point',
      lighting: 'day', createdAt: 1, updatedAt: 1, environmentId: 'cityscape',
      points: [{ x: 0, y: 0, surface: 'street' }, { x: 1_200, y: 0, surface: 'street' }],
      terrain: { cellSize: 32, cells: [] }, trees: [],
      scenery: [{ kind: 'city-trash-bin', x: 560, y: -24 }],
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, id)
  const qa = () => page.evaluate(() => window.__trackForgeQa?.snapshot())
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Track editor', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Checkpoint QA', exact: true }).click()
  await page.locator('summary.editor-toolbox-summary').click()
  await page.getByRole('button', { name: 'Place checkpoint' }).click()
  const camera = (await qa()).camera
  const canvas = await page.locator('#game-container canvas').boundingBox()
  expect(canvas).not.toBeNull()
  await page.touchscreen.tap(
    canvas.x + canvas.width / 2 + (400 - camera.x) * camera.zoom,
    canvas.y + canvas.height / 2 - camera.y * camera.zoom,
  )
  // Verify the checkpoint in the draft before persisting it explicitly.
  await expect.poll(async () =>
    page.evaluate(() => window.__trackForgeQa.snapshot().editor.recoveryCheckpoints.length),
  ).toBe(1)
  await page.getByRole('button', { name: 'Save track', exact: true }).click()
  const marks = async () => (await readSavedTracks(page))
    .find(track => track.id === id)?.recoveryCheckpoints
  await expect.poll(marks).toHaveLength(1)
  const [checkpoint] = await marks()
  expect(checkpoint).toBeGreaterThan(0.3)
  expect(checkpoint).toBeLessThan(0.36)

  await page.getByRole('button', { name: 'Race', exact: true }).click()
  await page.getByRole('button', { name: 'Race Checkpoint QA' }).click()
  await page.getByRole('button', { name: 'Time Trial', exact: true }).click()
  await page.getByRole('button', { name: 'Start Time Trial' }).click()
  await expect.poll(async () => (await qa()).race?.player?.y).toBe(-24)
  await page.evaluate(() => window.__trackForgeQa.advanceRace(4.7))
  // Arcade has no scenery collision: the car does not snap onto the centre
  // line when it passes the trash bin. Domain tests cover simulation impacts.
  await expect.poll(async () => {
    const race = (await qa()).race
    return race?.phase === 'running' && race.player.y < -10
  }, { timeout: 15_000 }).toBe(true)
  await page.evaluate(() => window.__trackForgeQa.advanceRace(20))
  const results = page.locator('[data-modal="results"]')
  await expect(results.locator('[data-action="open-race-splits"]')).toBeVisible({ timeout: 15_000 })
  await results.locator('[data-action="open-race-splits"]').click()
  const details = page.locator('[data-modal="race-splits"]')
  await expect(details.getByRole('heading', { name: 'RACE SPLITS' })).toBeVisible()
  await expect(details.locator('.results-splits-detail-row').first()).toBeVisible()
})
