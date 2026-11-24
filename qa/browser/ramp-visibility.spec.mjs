import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'

// Drive through the transition at race speed and check both support and visibility.
async function blueBodyPixels(page, image) {
  return page.evaluate(async (base64) => {
    const bitmap = new Image()
    bitmap.src = `data:image/png;base64,${base64}`
    await bitmap.decode()
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let blue = 0
    for (let index = 0; index < pixels.length; index += 4) {
      // Blue's solid body is #3a8cff; the empty terrain has no blue objects.
      if (Math.abs(pixels[index] - 58) <= 5 &&
          Math.abs(pixels[index + 1] - 140) <= 5 &&
          pixels[index + 2] >= 250) blue++
    }
    return blue
  }, image.toString('base64'))
}

for (const reversed of [false, true]) {
  test(`player stays grounded and visible when driving onto a ramp (reverse=${reversed})`, async ({ page }, testInfo) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript((reverse) => {
      const points = [
        { x: -500, y: 0 }, { x: 0, y: 0, structure: 'overpass' },
        { x: 1600, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 600 },
        { x: 2000, y: 1000 }, { x: 1000, y: 1000 },
        { x: -500, y: 1000 }, { x: -500, y: 0 },
      ].map((point, index) => ({
        ...point, id: `ramp-${index}`, curve: 'corner', surface: 'street',
      }))
      localStorage.setItem('trackforge-library-v2', JSON.stringify([{
        id: 'ramp-pixel-regression', name: 'Ramp visibility regression', version: 8,
        points, recoveryCheckpoints: [0.55], trees: [], terrain: { cellSize: 32, cells: [] },
        start: { ratio: reverse ? 2250 / 7000 : 350 / 7000, reversed: reverse },
        lighting: 'day', createdAt: 1, updatedAt: 1,
      }]))
      localStorage.setItem('trackforge-library-v1-migrated', '1')
      localStorage.setItem('trackforge-last-car', 'blue')
    }, reversed)
    await page.goto('/?qa')
    await enterTrackForge(page)
    await page.getByRole('button', { name: 'RACE', exact: true }).click()
    await page.getByRole('button', { name: 'Race Ramp visibility regression', exact: true }).click()
    await page.evaluate(() => {
      window.__rampAirborneFrames = 0
      const monitor = () => {
        const race = window.__trackForgeQa.snapshot().race
        if (race?.phase === 'running' && race.player?.grounded === false) {
          window.__rampAirborneFrames++
        }
        requestAnimationFrame(monitor)
      }
      requestAnimationFrame(monitor)
    })
    await page.getByRole('button', { name: 'START RACE' }).click()
    await expect(page.locator('[data-screen="race"]')).toBeVisible()
    await page.evaluate(() => window.__trackForgeQa.advanceRace(3.7))
    for (const [stage, threshold] of [
      ['approach', reversed ? 1650 : -50],
      ['deck-entry', reversed ? 1350 : 250],
      ['deck-travel', reversed ? 950 : 650],
    ]) {
      // A screenshot can take over a second under SwiftShader. Freeze physics
      // at the intended ramp stage rather than capturing a moving later frame.
      await expect.poll(() => page.evaluate(({ threshold, reversed }) => {
        const qa = window.__trackForgeQa
        const race = qa.snapshot().race
        if (race?.phase !== 'running' ||
            !(reversed ? race.player.x < threshold : race.player.x > threshold)) return false
        qa.pauseRace()
        return true
      }, { threshold, reversed }), { timeout: 20_000, intervals: [30, 40, 50] }).toBe(true)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const before = await page.evaluate(() => window.__trackForgeQa.snapshot().race)
      const image = await page.locator('#game-container canvas').screenshot({ scale: 'css' })
      await testInfo.attach(`${stage}.png`, { body: image, contentType: 'image/png' })
      const after = await page.evaluate(() => window.__trackForgeQa.snapshot().race)
      expect(after.player.x).toBeCloseTo(before.player.x, 5)
      expect(await blueBodyPixels(page, image), `${stage}: visible blue body at ${JSON.stringify(before.player)}`)
        .toBeGreaterThan(100)
      await page.evaluate(() => window.__trackForgeQa.resumeRace())
    }
    expect(await page.evaluate(() => window.__rampAirborneFrames)).toBe(0)
    expect(errors).toEqual([])
  })
}
