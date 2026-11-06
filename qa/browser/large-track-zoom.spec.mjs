import { expect, test } from '@playwright/test'

const trackPoints = Array.from({ length: 36 }, (_, index) => {
  const theta = (index % 35) * Math.PI * 2 / 35
  return {
    x: -175 + 950 * Math.cos(theta),
    y: -1350 + 1687 * Math.sin(theta),
    id: `large-${index}`,
    surface: 'street',
    curve: 'smooth',
    tension: 0.5,
    structure: index >= 10 && index <= 18 ? 'overpass' : 'surface',
  }
})

async function roadPixelCount(page, screenshot) {
  return page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      // Daylight street asphalt, distinct from green terrain/background.
      if (Math.abs(data[i] - 72) < 16 &&
          Math.abs(data[i + 1] - 78) < 16 &&
          Math.abs(data[i + 2] - 86) < 16) count++
    }
    return count
  }, screenshot.toString('base64'))
}

test('Papou-sized terrain and road remain visible at fit and after zooming out', async ({ page }, testInfo) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(points => {
    // Synthetic stress data: 36 road controls, 2,700 authored cells, ~3,400
    // world-units tall. No private user track data is checked into the repo.
    const terrain = Array.from({ length: 2700 }, (_, index) => ({
      column: (index % 45) - 34,
      row: Math.floor(index / 45) - 85,
      kind: index % 7 === 0 ? 'water' : 'hill',
    }))
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'large-stress', name: 'Large geometry stress', version: 8,
      points, trees: [], terrain: { cellSize: 32, cells: terrain },
      start: { ratio: 0, reversed: false },
      lighting: 'day', createdAt: 1, updatedAt: 1,
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, trackPoints)

  const metrics = []
  for (const [width, height] of [[844, 390], [320, 568]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/?qa')
    await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
    await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()
    await expect(page.locator('[data-screen="editor"]')).toBeVisible()
    const canvas = page.locator('#game-container canvas')
    await expect(canvas).toBeVisible()
    const camera = await page.evaluate(() => window.__trackForgeQa.snapshot().camera)
    expect(camera.zoom).toBeLessThan(0.16)
    expect(camera.zoom).toBeGreaterThan(0.03)

    const before = await canvas.screenshot({ scale: 'css' })
    await testInfo.attach(`large-${width}-fit.png`, { body: before, contentType: 'image/png' })
    const initialRoadPixels = await roadPixelCount(page, before)
    expect(initialRoadPixels, 'Road is rendered at fit zoom').toBeGreaterThan(60)

    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    const zoomed = await page.evaluate(() => window.__trackForgeQa.snapshot().camera)
    expect(zoomed.zoom).toBeLessThan(camera.zoom)
    const after = await canvas.screenshot({ scale: 'css' })
    await testInfo.attach(`large-${width}-zoomed-out.png`, { body: after, contentType: 'image/png' })
    const remainingRoadPixels = await roadPixelCount(page, after)
    expect(remainingRoadPixels, 'Road must not disappear when zoomed out').toBeGreaterThan(40)
    metrics.push({ width, height, fitZoom: camera.zoom, zoomed: zoomed.zoom, initialRoadPixels, remainingRoadPixels })
  }
  expect(pageErrors).toEqual([])
  await testInfo.attach('large-track-zoom.json', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  })
})
