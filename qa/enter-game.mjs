import { expect } from '@playwright/test'

/** Enter through the same welcome flow as a first-time player.
 * The optional player-name step persists after its first successful submit.
 * Do not bypass it by seeding storage: the next click must be unblocked.
 */
export async function enterTrackForge(page) {
  await page.getByRole('button', { name: /^tap to start$/i }).click()

  const playerName = page.getByRole('dialog', { name: 'Choose your player name' })
  if (await playerName.isVisible()) {
    await playerName.getByRole('textbox', { name: 'PLAYER NAME' }).fill('TrackForgeQA')
    await playerName.getByRole('button', { name: "LET'S RACE" }).click()
    await expect(playerName).toBeHidden()
  }
}
