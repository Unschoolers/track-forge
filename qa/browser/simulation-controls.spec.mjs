import { expect, test } from '@playwright/test'
import { contact, releaseTouches, touch } from './touch.mjs'

function telemetry(page) {
  return page.evaluate(() => window.__trackForgeQa.snapshot())
}

test('Simulation starts stationary and keeps steering, gas and brake independent on touch', async ({ page, context }) => {
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: 'SELECT', exact: true }).first().click()
  await page.getByRole('button', { name: 'SIMULATION', exact: true }).click()
  await page.getByRole('button', { name: 'START RACE' }).click()

  const gas = page.getByRole('button', { name: 'Accelerate', exact: true })
  const brake = page.getByRole('button', { name: 'Brake', exact: true })
  await expect(gas).toBeVisible()
  await expect.poll(async () => (await telemetry(page)).race?.phase, {
    timeout: 12_000,
  }).toBe('running')
  await expect.poll(async () => (await telemetry(page)).race.elapsed).toBeGreaterThan(0.3)
  const initial = await telemetry(page)
  expect(initial.race.handling).toBe('simulation')
  expect(initial.race.player.speed).toBeLessThan(1)
  expect(initial.controls).toMatchObject({ steering: 0, throttle: 0, braking: false })

  const canvas = await page.locator('#game-container canvas').boundingBox()
  const gasBox = await gas.boundingBox()
  const brakeBox = await brake.boundingBox()
  expect(canvas).not.toBeNull()
  expect(gasBox).not.toBeNull()
  expect(brakeBox).not.toBeNull()
  const midX = canvas.x + canvas.width / 2
  const accelerator = contact(2, gasBox.x + gasBox.width / 2, gasBox.y + gasBox.height / 2)
  const pedal = contact(3, brakeBox.x + brakeBox.width / 2, brakeBox.y + brakeBox.height / 2)
  expect(accelerator.x).toBeGreaterThan(midX)
  expect(pedal.x).toBeGreaterThan(midX)
  const y = canvas.y + canvas.height * 0.52
  const start = contact(1, canvas.x + canvas.width * 0.22, y)
  const steered = contact(1, start.x + 35, y)

  const cdp = await context.newCDPSession(page)
  const controls = () => telemetry(page).then((value) => value.controls)
  const speed = () => telemetry(page).then((value) => value.race.player.speed)
  try {
    await touch(cdp, 'touchStart', [accelerator])
    await expect.poll(speed).toBeGreaterThan(20)
    await touch(cdp, 'touchStart', [start])
    await touch(cdp, 'touchMove', [steered])
    await expect.poll(async () => (await controls()).steering).toBeGreaterThan(0.5)
    expect((await controls()).throttle).toBe(1)

    const brakingSpeed = await speed()
    await touch(cdp, 'touchStart', [pedal])
    await expect.poll(controls).toMatchObject({ throttle: 1, braking: true })
    expect((await controls()).steering).toBeGreaterThan(0.5)
    await expect.poll(speed).toBeLessThan(brakingSpeed - 3)

    await touch(cdp, 'touchEnd', [accelerator])
    await expect.poll(controls).toMatchObject({ throttle: 0, braking: true })
    expect((await controls()).steering).toBeGreaterThan(0.5)
    await touch(cdp, 'touchEnd', [pedal])
    await expect.poll(controls).toMatchObject({ throttle: 0, braking: false })
    expect((await controls()).steering).toBeGreaterThan(0.5)
    await releaseTouches(cdp)
    await expect.poll(controls).toEqual({ steering: 0, throttle: 0, braking: false })

    await page.keyboard.down('ArrowUp')
    await expect.poll(controls).toMatchObject({ throttle: 1, braking: false })
    await page.keyboard.down('ArrowLeft')
    await expect.poll(controls).toMatchObject({ steering: -1, throttle: 1 })
    await page.keyboard.up('ArrowUp')
    await expect.poll(controls).toMatchObject({ steering: -1, throttle: 0 })
    await page.keyboard.up('ArrowLeft')
    await expect.poll(controls).toMatchObject({ steering: 0, throttle: 0 })
  } finally {
    await releaseTouches(cdp).catch(() => {})
    await cdp.detach()
  }
})
