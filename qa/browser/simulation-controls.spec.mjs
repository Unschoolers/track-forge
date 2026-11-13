import { expect, test } from '@playwright/test'
import { contact, releaseTouches, touch } from './touch.mjs'

function telemetry(page) {
  return page.evaluate(() => window.__trackForgeQa.snapshot())
}

test('Simulation starts stationary and keeps steering, gas and brake independent on touch', async ({ page, context }) => {
  await page.addInitScript(() => {
    const points = [[0, 0], [800, 0], [1400, 0], [1800, 0], [1800, 600],
      [800, 600], [-600, 600], [-600, 0], [0, 0]].map(([x, y]) => ({
      x, y, curve: 'corner', surface: 'street',
    }))
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'simulation-controls', name: 'Simulation test circuit', version: 8,
      points, trees: [], terrain: { cellSize: 32, cells: [] },
      lighting: 'day', createdAt: 1, updatedAt: 1,
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
    localStorage.setItem('trackforge-ghost-runs-v1', JSON.stringify({
      'simulation-controls|1|0|forward|blue|2|simulation': {
        car: 'blue', time: 60,
        frames: [0, 60].map(t => ({ t, x: t, y: 0, angle: 0, z: 0, structureRunId: null })),
      },
    }))
  })
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: 'Race Simulation test circuit', exact: true }).click()
  await page.getByRole('dialog', { name: 'Race setup' }).getByRole('button', { name: 'OPTIONS' }).click()
  await page.getByRole('button', { name: 'SIMULATION', exact: true }).click()
  await page.getByRole('button', { name: 'DONE', exact: true }).click()
  // The replay provides a solo run so contact from the grid cannot give a
  // stationary car speed while this scenario checks independent pedals.
  await page.getByRole('button', { name: 'GHOST RACE', exact: true }).click()
  await page.getByRole('button', { name: 'START GHOST RACE' }).click()

  const gas = page.getByRole('button', { name: 'Accelerate', exact: true })
  const brake = page.getByRole('button', { name: 'Brake', exact: true })
  await expect(gas).toBeVisible()
  await expect(page.getByRole('button', { name: 'Steer left' })).toBeHidden()
  await expect.poll(async () => (await telemetry(page)).race?.phase, {
    timeout: 12_000,
  }).toBe('running')
  const initial = await telemetry(page)
  expect(initial.race.handling).toBe('simulation')
  expect(initial.race.vehicleCount).toBe(1)
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

    await page.locator('[data-action="pause"]').click()
    await page.getByRole('button', { name: 'OPTIONS' }).click()
    await page.getByRole('button', { name: 'BUTTONS', exact: true }).click()
    await page.getByRole('button', { name: 'RIGHT', exact: true }).click()
    await page.getByRole('button', { name: 'LARGE', exact: true }).click()
    await page.getByRole('button', { name: 'DONE', exact: true }).click()
    await page.getByRole('button', { name: 'RESUME', exact: true }).click()
    await page.setViewportSize({ width: 320, height: 568 })
    const left = await page.getByRole('button', { name: 'Steer left' }).boundingBox()
    const right = await page.getByRole('button', { name: 'Steer right' }).boundingBox()
    const gasNext = await gas.boundingBox()
    const brakeNext = await brake.boundingBox()
    expect(left.x).toBeGreaterThan(gasNext.x)
    expect(left.x + left.width).toBeLessThan(right.x)
    for (const box of [left, right, gasNext, brakeNext]) {
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(320)
    }
    const leftTouch = contact(11, left.x + left.width / 2, left.y + left.height / 2)
    const rightTouch = contact(12, right.x + right.width / 2, right.y + right.height / 2)
    const gasTouch = contact(13, gasNext.x + gasNext.width / 2, gasNext.y + gasNext.height / 2)
    const brakeTouch = contact(14, brakeNext.x + brakeNext.width / 2, brakeNext.y + brakeNext.height / 2)
    await touch(cdp, 'touchStart', [leftTouch])
    await touch(cdp, 'touchStart', [gasTouch])
    await touch(cdp, 'touchStart', [brakeTouch])
    await touch(cdp, 'touchStart', [rightTouch])
    await expect.poll(controls).toEqual({ steering: 1, throttle: 1, braking: true })
    await touch(cdp, 'touchEnd', [rightTouch])
    await expect.poll(controls).toEqual({ steering: -1, throttle: 1, braking: true })
    const dragStart = contact(15, canvas.width * 0.5, 280)
    await touch(cdp, 'touchStart', [dragStart])
    await touch(cdp, 'touchMove', [contact(15, dragStart.x + 50, dragStart.y)])
    await expect.poll(controls).toMatchObject({ steering: -1 })
    await touch(cdp, 'touchCancel', [])
    await expect.poll(controls).toEqual({ steering: 0, throttle: 0, braking: false })
    await touch(cdp, 'touchStart', [leftTouch])
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect.poll(controls).toEqual({ steering: 0, throttle: 0, braking: false })
    await releaseTouches(cdp)
    await touch(cdp, 'touchStart', [rightTouch])
    await page.setViewportSize({ width: 568, height: 320 })
    await expect.poll(controls).toEqual({ steering: 0, throttle: 0, braking: false })
    await releaseTouches(cdp)

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
