import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'
import { OWNED_TRACK_NAME, seedOwnedTrack } from './owned-track.mjs'

test('downloads the shared track when file sharing is unavailable', async ({ page }) => {
  await seedOwnedTrack(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => false })
  })
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Track editor', exact: true }).click()
  await page.locator('.track-card-overflow summary').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: `Share ${OWNED_TRACK_NAME}`, exact: true }).click()
  await page.getByRole('button', { name: 'EXPORT', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.trackforge\.json$/)
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(exported.format).toBe('trackforge-track')
  expect(exported.formatVersion).toBe(2)
  expect(exported.signature).toMatchObject({ algorithm: 'ECDSA-P256-SHA256' })
  expect(exported.track.name).toBe(OWNED_TRACK_NAME)
  expect(exported.track.points.length).toBeGreaterThan(8)
  expect(exported.track.terrain).toBeDefined()
  await expect(page.getByRole('dialog', { name: 'Track garage' })).toBeVisible()
  await page.getByRole('button', { name: `Edit ${OWNED_TRACK_NAME}`, exact: true }).click()
  // Editor menu is the top-right button.
  await page.locator('[data-action="editor-menu"]').click()
  const editorDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SHARE', exact: true }).click()
  await page.getByRole('button', { name: 'EXPORT', exact: true }).click()
  const current = JSON.parse(await readFile(await (await editorDownload).path(), 'utf8'))
  expect(current.track).toEqual(exported.track)
  expect(current.signature.publicKey).toBe(exported.signature.publicKey)

  const scenery = [{ kind: 'desert-cactus', x: 82, y: -162 }]
  const themed = {
    format: exported.format,
    formatVersion: 1,
    track: { ...exported.track, name: 'Dune Loop', environmentId: 'desert', scenery },
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Load track', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Dune-Loop.trackforge.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(themed)),
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Editor menu' }).click()
  await expect(page.getByRole('button', { name: 'SAVE AS NEW TRACK', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Environment' })).toHaveCount(0)
  const themedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SHARE', exact: true }).click()
  await page.getByRole('button', { name: 'EXPORT', exact: true }).click()
  const roundTrip = JSON.parse(await readFile(await (await themedDownload).path(), 'utf8'))
  expect(roundTrip.signature.publicKey).toBe(exported.signature.publicKey)
  expect(roundTrip.track.id).not.toBe(themed.track.id)
  expect(roundTrip.track).toMatchObject({ name: 'Dune Loop', environmentId: 'desert', scenery })
})
