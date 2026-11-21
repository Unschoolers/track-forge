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

/**
 * Browser QA fixture: fork the built-in circuit into a shareable local track.
 * The built-in seed is intentionally protected from sharing and deletion.
 */
export async function createShareableQaTrack(page) {
  await page.evaluate(() => {
    const key = 'trackforge-library-v2'
    const tracks = JSON.parse(localStorage.getItem(key) ?? '[]')
    const starter = tracks.find(track => track.name === 'Starter Circuit')
    const creatorId = localStorage.getItem('trackforge-creator-id-v1')
    const displayName = localStorage.getItem('trackforge-player-name-v1')
    if (!starter || !creatorId || !displayName) {
      throw new Error('Cannot create shareable QA fixture without a starter circuit and player identity')
    }
    localStorage.setItem(key, JSON.stringify([
      ...tracks.filter(track => track.id !== 'qa-shareable-circuit'),
      {
        ...starter,
        id: 'qa-shareable-circuit',
        name: 'QA Shared Circuit',
        origin: 'local',
        creator: { id: creatorId, name: displayName },
      },
    ]))
  })
  await page.reload()
  await enterTrackForge(page)
}
