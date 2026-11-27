import { expect } from '@playwright/test'

// Exercise the real cycling controls, never directly mutate application state.
async function selectCycle(control, attribute, target, max) {
  await expect(control).toBeVisible()
  for (let index = 0; index < max; index++) {
    if (await control.getAttribute(attribute) === String(target)) return
    await control.click()
  }
  await expect(control).toHaveAttribute(attribute, String(target))
}
export function selectRaceMode(page, mode) {
  return selectCycle(page.locator('[data-action="mode-cycle"]'), 'data-race-mode', mode, 4)
}
export function selectRaceLaps(page, laps) {
  return selectCycle(page.locator('[data-action="laps-cycle"]'), 'data-race-laps', laps, 3)
}
