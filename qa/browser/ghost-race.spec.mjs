import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { readSavedTracks } from './saved-tracks.mjs'
import { enterTrackForge } from '../enter-game.mjs'
import { seedOwnedTrack, OWNED_TRACK_NAME } from './owned-track.mjs'

async function setupRace(page) {
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: `Race ${OWNED_TRACK_NAME}`, exact: true }).click()
}

test('Ghost Race stays visible and greyed out without a matching saved replay', async ({ page }) => {
  await seedOwnedTrack(page)
  await page.goto('/?qa')
  await enterTrackForge(page)
  await setupRace(page)
  const ghost = page.getByRole('button', { name: 'Ghost Race', exact: true })
  await expect(ghost).toBeVisible()
  await expect(ghost).toBeDisabled()
  await expect(ghost).toHaveCSS('opacity', '0.45')
  await expect(page.getByText('Finish a race on this layout to save a ghost.')).toBeVisible()
})

test('saved replay unlocks solo Ghost Race and Normal Race keeps AI without the ghost', async ({ page }) => {
  await seedOwnedTrack(page)
  await page.goto('/?qa')
  await enterTrackForge(page)
  const savedTrack = (await readSavedTracks(page))[0]
  await page.evaluate(track => {
    const key = [track.id, track.updatedAt, track.start?.ratio ?? 0,
      track.start?.reversed ? 'reverse' : 'forward', 'blue', 2].join('|')
    const point = track.points[0]
    localStorage.setItem('trackforge-ghost-runs-v2', JSON.stringify({ [key]: {
      car: 'blue', time: 60,
      frames: [0, 60].map(t => ({ t, x: point.x + t, y: point.y,
        angle: 0, z: 0, structureRunId: null })),
    } }))
    localStorage.setItem('trackforge-audio-enabled', '0')
  }, savedTrack)
  await page.reload()
  await enterTrackForge(page)
  await setupRace(page)
  const ghost = page.getByRole('button', { name: 'Ghost Race', exact: true })
  await expect(ghost).toBeEnabled()
  await page.getByRole('button', { name: 'Night', exact: true }).click()
  await expect(ghost).toBeEnabled()
  await ghost.click()
  await expect(page.getByRole('button', { name: 'Start Ghost Race', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start Ghost Race', exact: true }).click()
  await expect(page.getByText('GHOST TARGET', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.setup.lighting)).toBe('night')
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.vehicleCount)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.ghostVisible)).toBe(true)
  await page.locator('[data-action="pause"]').click()
  await page.getByRole('button', { name: 'QUIT TO HOME', exact: true }).click()
  await setupRace(page)
  // Recompute availability when selecting a different car, without hiding the button.
  await page.locator('[data-car="red"]').click()
  await expect(ghost).toBeVisible()
  await expect(ghost).toBeDisabled()
  await expect(page.getByText('Saved ghost: Blue · 2 laps.')).toBeVisible()
  await page.locator('[data-car="blue"]').click()
  await expect(ghost).toBeEnabled()
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'Options' }).click()
  await page.locator('[data-action="laps-1"]').click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  await expect(ghost).toBeDisabled()
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'Options' }).click()
  await page.locator('[data-action="laps-2"]').click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  await expect(ghost).toBeEnabled()
  await page.getByRole('button', { name: 'Normal Race', exact: true }).click()
  await page.getByRole('button', { name: 'Start Race', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.vehicleCount)).toBe(4)
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.ghostVisible)).toBe(false)
})

test('shares a saved creator ghost and opens the imported challenge with its lap count', async ({ page }) => {
  await seedOwnedTrack(page)
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false }))
  await page.goto('/?qa')
  await enterTrackForge(page)
  const savedTrack = (await readSavedTracks(page))[0]
  await page.evaluate(track => {
    const key = [track.id, track.updatedAt, 0, 'forward', 'blue', 1].join('|')
    const { x, y } = track.points[0]
    localStorage.setItem('trackforge-ghost-runs-v2', JSON.stringify({ [key]: {
      car: 'blue', time: 31.5,
      frames: [0, 31.5].map(t => ({ t, x: x + t, y, angle: 0, z: 0, structureRunId: null })),
    } }))
  }, savedTrack)
  await page.reload()
  await enterTrackForge(page)
  await setupRace(page)
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'Options' }).click()
  await page.locator('[data-action="laps-1"]').click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'Back', exact: true }).click()
  const garage = page.getByRole('dialog', { name: 'Choose a track' })
  await expect(garage).toBeVisible()
  await garage.locator('.track-card-overflow summary').click()
  const download = page.waitForEvent('download')
  await garage.getByRole('button', { name: `Share ${OWNED_TRACK_NAME}`, exact: true }).click()
  const challengeContent = await readFile(await (await download).path(), 'utf8')
  const challenge = JSON.parse(challengeContent)
  expect(challenge.formatVersion).toBe(2)
  expect(challenge.signature).toMatchObject({ algorithm: 'ECDSA-P256-SHA256' })
  expect(challenge.track.creatorChallenge).toMatchObject({ car: 'blue', time: 31.5, laps: 1 })
  await garage.locator('input[type="file"]').setInputFiles({
    name: `${OWNED_TRACK_NAME}.trackforge.json`, mimeType: 'application/json',
    buffer: Buffer.from(challengeContent),
  })
  await expect(page.getByRole('dialog', { name: 'Race setup' })).toBeVisible()
  await expect(page.getByText(/Creator challenge:.*Blue.*1 lap/)).toBeVisible()
  await page.reload()
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await garage.getByRole('button', { name: `Race ${OWNED_TRACK_NAME} (2)`, exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  await setup.getByRole('button', { name: 'Options' }).click()
  await page.locator('[data-action="laps-2"]').click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  await setup.locator('[data-car="red"]').click()
  await expect(setup.getByText(/Creator (challenge|target):.*Blue.*1 lap/)).toBeVisible()
  await setup.getByRole('button', { name: 'Ghost Race', exact: true }).click()
  await setup.getByRole('button', { name: 'Start Ghost Race', exact: true }).click()
  await expect(page.getByText('GHOST TARGET', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.setup))
    .toMatchObject({ mode: 'ghost', car: 'red', laps: 1 })
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.ghostVisible)).toBe(true)
})
