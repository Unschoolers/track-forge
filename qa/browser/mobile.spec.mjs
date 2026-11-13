import { expect, test } from '@playwright/test'
import { contact, releaseTouches, touch } from './touch.mjs'

async function telemetry(page) {
  return page.evaluate(() => {
    const qa = window.__trackForgeQa
    if (!qa) throw new Error('Dev-only QA telemetry unavailable; open ?qa')
    return qa.snapshot()
  })
}

async function launch(page) {
  await page.goto('/?qa')
  await expect(page.locator('[data-screen="home"]')).toBeVisible()
  await expect.poll(async () => (await telemetry(page)).mode).toBe('home')
}

async function enterEditor(page) {
  await page.getByRole('button', { name: 'TRACK EDITOR' }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()
  await expect(page.locator('[data-screen="editor"]')).toBeVisible()
  await expect.poll(async () => (await telemetry(page)).camera).not.toBeNull()
}

async function enterRace(page) {
  await page.getByRole('button', { name: 'RACE', exact: true }).click()
  await page.getByRole('button', { name: 'Race Starter Circuit', exact: true }).click()
  await page.getByRole('button', { name: 'START RACE' }).click()
  await expect(page.locator('[data-screen="race"]')).toBeVisible()
  await expect.poll(async () => (await telemetry(page)).race?.phase, {
    timeout: 12_000,
  }).toBe('running')
}

test('two-finger editing pinch pans and zooms without leaving road edits', async ({ page, context }) => {
  await launch(page)
  await enterEditor(page)
  const canvas = page.locator('#game-container canvas')
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  const { x, y, width, height } = bounds
  const midY = y + height * 0.48
  const first = contact(1, x + width * 0.40, midY)
  const second = contact(2, x + width * 0.60, midY)
  const before = await telemetry(page)
  const cdp = await context.newCDPSession(page)
  try {
    await touch(cdp, 'touchStart', [first, second])
    await touch(cdp, 'touchMove', [
      contact(1, first.x - 40, midY),
      contact(2, second.x + 40, midY),
    ])
    await page.waitForTimeout(120)
    await releaseTouches(cdp)

    const zoomed = await telemetry(page)
    expect(zoomed.camera.zoom).toBeGreaterThan(before.camera.zoom + 0.05)
    expect(zoomed.editor.points).toBe(before.editor.points)
    expect(zoomed.editor.history).toBe(before.editor.history)
    expect(zoomed.editor.gestureActive).toBe(false)

    const panStart = [contact(3, x + width * 0.40, midY), contact(4, x + width * 0.60, midY)]
    await touch(cdp, 'touchStart', panStart)
    await touch(cdp, 'touchMove', panStart.map(p => contact(p.id, p.x + 46, p.y + 18)))
    await page.waitForTimeout(120)
    await releaseTouches(cdp)
    const panned = await telemetry(page)
    expect(Math.abs(panned.camera.x - zoomed.camera.x)).toBeGreaterThan(8)
    expect(panned.editor.points).toBe(before.editor.points)
  } finally {
    await releaseTouches(cdp).catch(() => {})
    await cdp.detach()
  }
})

for (const side of ['left', 'right']) {
  for (const order of ['steer-first', 'brake-first']) {
    test(`steering survives braking, releases and regrabs (${side}, ${order})`, async ({ page, context }) => {
      await launch(page)
      await enterRace(page)
      const canvas = await page.locator('#game-container canvas').boundingBox()
      const brake = await page.getByRole('button', { name: 'Brake', exact: true }).boundingBox()
      expect(canvas).not.toBeNull()
      expect(brake).not.toBeNull()
      const y = canvas.y + canvas.height * 0.52
      const first = contact(1, canvas.x + canvas.width * (side === 'left' ? 0.22 : 0.68), y)
      let steering = contact(1, first.x + 40, y)
      const pedal = contact(2, brake.x + brake.width / 2, brake.y + brake.height / 2)
      const cdp = await context.newCDPSession(page)
      try {
        if (order === 'brake-first') {
          await touch(cdp, 'touchStart', [pedal])
          await expect.poll(async () => (await telemetry(page)).controls.braking).toBe(true)
          await touch(cdp, 'touchStart', [first])
          await touch(cdp, 'touchMove', [steering])
        } else {
          await touch(cdp, 'touchStart', [first])
          await touch(cdp, 'touchMove', [steering])
          await touch(cdp, 'touchStart', [pedal])
        }
        await expect.poll(async () => (await telemetry(page)).controls).toMatchObject({ braking: true })
        await expect.poll(async () => (await telemetry(page)).controls.steering).toBeGreaterThan(0.5)
        steering = contact(1, first.x - 40, y)
        await touch(cdp, 'touchMove', [steering])
        await expect.poll(async () => (await telemetry(page)).controls.steering).toBeLessThan(-0.5)
        expect((await telemetry(page)).controls.braking).toBe(true)

        // Lift and reapply only Brake; steering must remain held.
        await touch(cdp, 'touchEnd', [pedal])
        await expect.poll(async () => (await telemetry(page)).controls.braking).toBe(false)
        expect((await telemetry(page)).controls.steering).toBeLessThan(-0.5)
        await touch(cdp, 'touchStart', [pedal])
        await expect.poll(async () => (await telemetry(page)).controls.braking).toBe(true)

        // Lift steering, then regrab while Brake remains down.
        await touch(cdp, 'touchEnd', [steering])
        await expect.poll(async () => (await telemetry(page)).controls.steering).toBe(0)
        expect((await telemetry(page)).controls.braking).toBe(true)
        const regrab = contact(3, first.x + 10, y)
        await touch(cdp, 'touchStart', [regrab])
        await touch(cdp, 'touchMove', [contact(3, regrab.x + 40, y)])
        await expect.poll(async () => (await telemetry(page)).controls.steering).toBeGreaterThan(0.5)
        expect((await telemetry(page)).controls.braking).toBe(true)
        await releaseTouches(cdp)
        await expect.poll(async () => (await telemetry(page)).controls).toMatchObject({ steering: 0, braking: false })
      } finally {
        await releaseTouches(cdp).catch(() => {})
        await cdp.detach()
      }
    })
  }
}

test('arcade race advances and produces machine-readable driving metrics', async ({ page }, testInfo) => {
  const browserErrors = []
  page.on('pageerror', error => browserErrors.push(error.message))
  await launch(page)
  await enterRace(page)
  await page.waitForTimeout(1_600)
  const state = await telemetry(page)
  expect(state.race.handling).toBe('arcade')
  expect(state.race.elapsed).toBeGreaterThan(0.5)
  expect(state.race.player.speed).toBeGreaterThan(0)
  expect(Number.isFinite(state.race.player.x)).toBe(true)
  expect(Number.isFinite(state.race.player.y)).toBe(true)
  expect(browserErrors).toEqual([])
  const frames = await page.evaluate(async () => {
    const intervals = []
    let previous = await new Promise(resolve => requestAnimationFrame(resolve))
    for (let i = 0; i < 90; i += 1) {
      const now = await new Promise(resolve => requestAnimationFrame(resolve))
      intervals.push(now - previous)
      previous = now
    }
    return intervals
  })
  const sorted = [...frames].sort((a, b) => a - b)
  const metrics = {
    elapsedSeconds: state.race.elapsed,
    currentSpeed: state.race.player.speed,
    currentSurface: state.race.player.surface,
    damage: state.race.player.damage,
    frameIntervalMedianMs: sorted[Math.floor(sorted.length / 2)],
    frameIntervalP95Ms: sorted[Math.floor(sorted.length * 0.95)],
    sampledFrames: frames.length,
  }
  await testInfo.attach('gameplay-metrics.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  })
})
