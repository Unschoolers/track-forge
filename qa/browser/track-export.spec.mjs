import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('exports a complete track from the library and editor menu', async ({ page }) => {
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'EXPORT', exact: true }).first().click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.trackforge\.json$/)
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(exported.format).toBe('trackforge-track')
  expect(exported.formatVersion).toBe(1)
  expect(exported.track.points.length).toBeGreaterThan(8)
  expect(exported.track.terrain).toBeDefined()
  await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()
  // Editor menu is the top-right button.
  await page.locator('[data-action="editor-menu"]').click()
  const editorDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'EXPORT TRACK', exact: true }).click()
  const current = JSON.parse(await readFile(await (await editorDownload).path(), 'utf8'))
  expect(current.track).toEqual(exported.track)
})
