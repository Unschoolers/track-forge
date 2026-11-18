export async function enterTrackForge(page) {
  await page.getByRole('button', { name: /^tap to start$/i }).click()
}
