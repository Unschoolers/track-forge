import { expect } from '@playwright/test'

// Select a lighting state through the native toggle, independent of the
// current label, animation progress, or a track's initial lighting.
export async function selectRaceLighting(page, lighting) {
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  const toggle = setup.getByRole('button', { name: 'Night lighting (Day / Night)', exact: true })
  await expect(toggle).toBeVisible()
  const pressed = String(lighting === 'night')
  if (await toggle.getAttribute('aria-pressed') !== pressed) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', pressed)
  await expect(toggle).toHaveAttribute('data-lighting-mode', lighting)
}
