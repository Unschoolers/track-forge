import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createShareableQaTrack, enterTrackForge } from '../enter-game.mjs'

test('downloads the shared track when file sharing is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => false })
  })
  await page.goto('/?qa')
  await enterTrackForge(page)
  await createShareableQaTrack(page)
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Share QA Shared Circuit', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.trackforge\.json$/)
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(exported.format).toBe('trackforge-track')
  expect(exported.formatVersion).toBe(1)
  expect(exported.track.points.length).toBeGreaterThan(8)
  expect(exported.track.terrain).toBeDefined()
  await expect(page.getByRole('dialog', { name: 'Choose a track to edit' })).toBeVisible()
  await page.locator('.track-card').filter({ hasText: 'QA Shared Circuit' })
    .getByRole('button', { name: 'EDIT', exact: true }).click()
  // Editor menu is the top-right button.
  await page.locator('[data-action="editor-menu"]').click()
  const editorDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'EXPORT TRACK', exact: true }).click()
  const current = JSON.parse(await readFile(await (await editorDownload).path(), 'utf8'))
  expect(current.track).toEqual(exported.track)

  const scenery = [{ kind: 'desert-cactus', x: 82, y: -162 }]
  const themed = { ...exported, track: { ...exported.track, name: 'Dune Loop', environmentId: 'desert', scenery } }
  await page.getByRole('button', { name: 'CHOOSE ANOTHER TRACK', exact: true }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Dune-Loop.trackforge.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(themed)),
  })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Editor menu' }).click()
  await expect(page.getByRole('button', { name: 'Desert', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const themedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'EXPORT TRACK', exact: true }).click()
  const roundTrip = JSON.parse(await readFile(await (await themedDownload).path(), 'utf8'))
  expect(roundTrip.track.id).not.toBe(themed.track.id)
  expect(roundTrip.track).toMatchObject({ name: 'Dune Loop', environmentId: 'desert', scenery })
})
