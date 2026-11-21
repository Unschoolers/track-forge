import { expect } from '@playwright/test'

/**
 * Enter a normal player session, including mandatory first-launch identity setup.
 * Do not bypass the startup overlay or seed localStorage: browser QA must exercise
 * the same UI path as a new player.
 */
export async function enterTrackForge(page) {
  await page.getByRole('button', { name: /^tap to start$/i }).click()

  const naming = page.getByRole('dialog', { name: 'Choose your player name' })
  if (await naming.isVisible()) {
    await naming.getByRole('textbox', { name: 'PLAYER NAME' }).fill('QA Driver')
    await naming.getByRole('button', { name: "LET'S RACE", exact: true }).click()
    await expect(naming).toHaveCount(0)
  }

  // A fresh or returning player must have a persisted, valid display name.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('trackforge-player-name-v1')))
    .toMatch(/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,23}$/u)
}
