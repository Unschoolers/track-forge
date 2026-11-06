import { expect, test } from '@playwright/test'

// Reproduce the real failure: drive up a ramp, jump, and land on its long deck.
// The old drawing-layer test placed cars directly at the correct height and
// could not catch a live car falling through the ramp and becoming invisible.
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
  test(`player body stays visible after driving onto a ramp (reverse=${reversed})`, async ({ page }, testInfo) => {
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
        points, trees: [], terrain: { cellSize: 32, cells: [] },
        start: { ratio: reverse ? 2250 / 7000 : 350 / 7000, reversed: reverse },
        lighting: 'day', createdAt: 1, updatedAt: 1,
      }]))
      localStorage.setItem('trackforge-library-v1-migrated', '1')
      localStorage.setItem('trackforge-last-car', 'blue')
      localStorage.setItem('trackforge-handling-mode', 'arcade')
    }, reversed)
    await page.goto('/?qa')
    await page.getByRole('button', { name: 'RACE', exact: true }).click()
    await page.getByRole('button', { name: 'SELECT', exact: true }).first().click()
    await page.getByRole('button', { name: 'START RACE' }).click()
    await expect(page.locator('[data-screen="race"]')).toBeVisible()
    for (const [stage, threshold] of [
      ['approach', reversed ? 1650 : -50],
      ['deck-entry', reversed ? 1350 : 250],
      ['deck-travel', reversed ? 950 : 650],
    ]) {
      await expect.poll(async () => {
        const race = await page.evaluate(() => window.__trackForgeQa.snapshot().race)
        return race?.phase === 'running' &&
          (reversed ? race.player.x < threshold : race.player.x > threshold)
      }, { timeout: 20_000 }).toBe(true)
      const image = await page.locator('#game-container canvas').screenshot({ scale: 'css' })
      await testInfo.attach(`${stage}.png`, { body: image, contentType: 'image/png' })
      expect(await blueBodyPixels(page, image), `${stage}: the blue car body must be rendered`)
        .toBeGreaterThan(100)
    }
    expect(errors).toEqual([])
  })
}
