export async function enterTrackForge(page) {
  await page.getByRole('button', { name: /^tap to start$/i }).click()
  await page.locator('#title-screen').waitFor({ state: 'hidden' })

  // Gameplay scenarios need an initialized player, while a page reload may
  // already have a saved name. Use the real onboarding flow in fresh contexts.
  const playerName = page.getByRole('dialog', { name: 'Choose your player name' })
  if (await playerName.isVisible()) {
    await playerName.getByRole('textbox', { name: 'PLAYER NAME' }).fill('Mobile QA')
    await playerName.getByRole('button', { name: "LET'S RACE" }).click()
    await playerName.waitFor({ state: 'hidden' })
  }
}
