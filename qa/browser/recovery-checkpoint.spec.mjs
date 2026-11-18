import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'

test('places a recovery checkpoint and returns to it after hitting scenery', async ({ page }) => {
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
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()
  await page.getByRole('button', { name: 'Place checkpoint' }).click()
  const camera = (await qa()).camera
  const canvas = await page.locator('#game-container canvas').boundingBox()
  expect(canvas).not.toBeNull()
  await page.touchscreen.tap(
    canvas.x + canvas.width / 2 + (400 - camera.x) * camera.zoom,
    canvas.y + canvas.height / 2 - camera.y * camera.zoom,
  )
  const marks = () => page.evaluate(trackId =>
    JSON.parse(localStorage.getItem('trackforge-library-v2'))
      .find(track => track.id === trackId)?.recoveryCheckpoints, id)
  await expect.poll(marks).toHaveLength(1)
  const [checkpoint] = await marks()
  expect(checkpoint).toBeGreaterThan(0.3)
  expect(checkpoint).toBeLessThan(0.36)

  await page.getByRole('button', { name: 'Race', exact: true }).click()
  await page.getByRole('button', { name: 'Race Checkpoint QA' }).click()
  await page.getByRole('button', { name: 'TIME TRIAL', exact: true }).click()
  await page.getByRole('button', { name: 'START TIME TRIAL' }).click()
  await expect.poll(async () => (await qa()).race?.player?.y).toBe(-24)
  await expect.poll(async () => {
    const race = (await qa()).race
    return race?.phase === 'running' && Math.abs(race.player.y) < 1
  }, { timeout: 15_000 }).toBe(true)
  await expect(page.getByRole('heading', { name: 'SPLITS', exact: true })).toBeVisible({ timeout: 15_000 })
})
