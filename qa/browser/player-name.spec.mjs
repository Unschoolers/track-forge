import { expect, test } from '@playwright/test'

test('first launch requires and persists a player name across reload', async ({ page }) => {
  await page.goto('/?qa')
  await page.getByRole('button', { name: /^tap to start$/i }).click()

  const naming = page.getByRole('dialog', { name: 'Choose your player name' })
  await expect(naming).toBeVisible()
  await expect(naming.getByRole('button', { name: 'Close' })).toHaveCount(0)
  await naming.getByRole('textbox', { name: 'PLAYER NAME' }).fill('CurveMaker')
  await naming.getByRole('button', { name: "LET'S RACE", exact: true }).click()
  await expect(naming).toHaveCount(0)

  const saved = await page.evaluate(() => ({
    name: localStorage.getItem('trackforge-player-name-v1'),
    id: localStorage.getItem('trackforge-creator-id-v1'),
  }))
  expect(saved.name).toBe('CurveMaker')
  expect(saved.id).toMatch(/^[a-zA-Z0-9_-]{8,64}$/)

  await page.reload()
  await page.getByRole('button', { name: /^tap to start$/i }).click()
  await expect(naming).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'RACE', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('trackforge-creator-id-v1'))).toBe(saved.id)
})
