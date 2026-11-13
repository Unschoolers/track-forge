import { expect, test } from '@playwright/test'

async function setupRace(page) {
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: 'Race Starter Circuit', exact: true }).click()
}

test('Ghost Race stays visible and greyed out without a matching saved replay', async ({ page }) => {
  await page.goto('/?qa')
  await setupRace(page)
  const ghost = page.getByRole('button', { name: 'GHOST RACE', exact: true })
  await expect(ghost).toBeVisible()
  await expect(ghost).toBeDisabled()
  await expect(ghost).toHaveCSS('opacity', '0.45')
  await expect(page.getByText('Finish a race on this layout to save a ghost.')).toBeVisible()
})

test('saved replay unlocks solo Ghost Race and Normal Race keeps AI without the ghost', async ({ page }) => {
  await page.goto('/?qa')
  await page.evaluate(() => {
    const track = JSON.parse(localStorage.getItem('trackforge-library-v2'))[0]
    const key = [track.id, track.updatedAt, track.start?.ratio ?? 0,
      track.start?.reversed ? 'reverse' : 'forward', 'blue', 2, 'arcade'].join('|')
    const point = track.points[0]
    localStorage.setItem('trackforge-ghost-runs-v1', JSON.stringify({ [key]: {
      car: 'blue', time: 60,
      frames: [0, 60].map(t => ({ t, x: point.x + t, y: point.y,
        angle: 0, z: 0, structureRunId: null })),
    } }))
    localStorage.setItem('trackforge-audio-enabled', '0')
  })
  await page.reload()
  await setupRace(page)
  const ghost = page.getByRole('button', { name: 'GHOST RACE', exact: true })
  await expect(ghost).toBeEnabled()
  await page.getByRole('button', { name: 'NIGHT', exact: true }).click()
  await expect(ghost).toBeEnabled()
  await ghost.click()
  await expect(page.getByRole('button', { name: 'START GHOST RACE', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'START GHOST RACE', exact: true }).click()
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
  await expect(page.getByText('Saved ghost: Blue · 2 laps · Arcade.')).toBeVisible()
  await page.locator('[data-car="blue"]').click()
  await expect(ghost).toBeEnabled()
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'OPTIONS' }).click()
  await page.locator('[data-action="laps-1"]').click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  await expect(ghost).toBeDisabled()
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'OPTIONS' }).click()
  await page.locator('[data-action="laps-2"]').click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  await expect(ghost).toBeEnabled()
  await page.getByRole('button', { name: 'NORMAL RACE', exact: true }).click()
  await page.getByRole('button', { name: 'START RACE', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.vehicleCount)).toBe(4)
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.ghostVisible)).toBe(false)
})
