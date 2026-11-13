import { expect, test } from '@playwright/test'

async function openPicker(page) {
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  return page.getByRole('dialog', { name: 'Choose a track' })
}

test('previews every track and shares a saved track without selecting it', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true })
    Object.defineProperty(navigator, 'share', { value: async ({ files, text }) => {
      window.sharedTrack = { file: files[0].name, track: JSON.parse(await files[0].text()).track.name, text }
    } })
  })
  const picker = await openPicker(page)
  const saved = picker.getByRole('button', { name: 'Race Starter Circuit', exact: true })
  const official = picker.getByRole('button', { name: 'Race Meadow Loop', exact: true })
  await expect(picker.getByRole('button', { name: 'SELECT', exact: true })).toHaveCount(0)
  await expect(saved.locator('.track-preview path')).toBeVisible()
  await expect(official.locator('.track-preview path')).toBeAttached()
  expect(await picker.locator('.track-card').count()).toBe(await picker.locator('.track-preview').count())
  const share = picker.getByRole('button', { name: 'Share Starter Circuit', exact: true })
  await expect(share).toHaveText('')
  await share.tap()
  await expect.poll(() => page.evaluate(() => window.sharedTrack)).toMatchObject({
    file: 'Starter-Circuit.trackforge.json',
    track: 'Starter Circuit',
  })
  await expect(picker).toBeVisible()
  await saved.locator('.track-preview').tap()
  await expect(page.getByRole('dialog', { name: 'Race setup' })).toContainText('Starter Circuit')
})

test('the race flyover follows the selected track, car, lighting and motion preference', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const picker = await openPicker(page)
  await picker.getByRole('button', { name: 'Race Meadow Loop', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  const preview = setup.locator('canvas.race-flyover')
  const pixel = () => preview.evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data))
  const snapshot = () => preview.evaluate((canvas) => canvas.toDataURL())
  await expect(preview).toHaveAccessibleName('Daytime flyover of Meadow Loop')
  await expect.poll(async () => (await pixel())[3]).toBe(255)
  const day = await pixel()
  const still = await snapshot()
  const play = setup.getByRole('button', { name: 'Play flyover' })
  await expect(play).toBeVisible()
  await play.click()
  await expect.poll(snapshot).not.toBe(still)
  await setup.locator('[data-car="red"]').click()
  await expect(preview).toHaveAttribute('data-car', 'red')
  await expect(setup.getByRole('button', { name: 'Pause flyover' })).toBeVisible()
  await setup.getByRole('button', { name: 'Pause flyover' }).click()
  await expect(play).toBeVisible()
  await testInfo.attach('flyover-day', { body: await setup.screenshot(), contentType: 'image/png' })

  await setup.getByRole('button', { name: 'NIGHT', exact: true }).click()
  await expect(setup.getByRole('button', { name: 'NIGHT', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(preview).toHaveAccessibleName('Nighttime flyover of Meadow Loop')
  await expect.poll(async () => (await pixel())[1]).toBeLessThan(day[1])
  const hitTarget = await setup.getByRole('button', { name: 'NIGHT', exact: true }).boundingBox()
  expect(hitTarget?.height).toBeGreaterThanOrEqual(44)
  await setup.getByRole('button', { name: 'OPTIONS' }).click()
  const options = page.getByRole('dialog', { name: 'Options' })
  await expect(options.getByRole('button', { name: 'HARD', exact: true })).toBeVisible()
  await expect(options.getByRole('button', { name: 'NIGHT', exact: true })).toHaveCount(0)
  await options.getByRole('button', { name: 'DONE', exact: true }).click()
  await expect(preview).toHaveAccessibleName('Nighttime flyover of Meadow Loop')
  await expect(preview).toHaveAttribute('data-car', 'red')
  await expect.poll(async () => (await pixel())[1]).toBeLessThan(day[1])
  await expect(play).toBeVisible()
  await testInfo.attach('flyover-night', { body: await setup.screenshot(), contentType: 'image/png' })

  await setup.getByRole('button', { name: 'START RACE', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.lighting)).toBe('night')
  await page.locator('[data-action="pause"]').click()
  await page.getByRole('dialog', { name: 'Race paused' }).getByRole('button', { name: 'OPTIONS' }).click()
  await expect(options.getByRole('button', { name: 'HARD', exact: true })).toHaveCount(0)
})
