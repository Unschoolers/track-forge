import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { contact, releaseTouches, touch } from './touch.mjs'

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

const rallyFixture = JSON.parse(readFileSync(new URL('./fixtures/rally.json', import.meta.url), 'utf8'))
const rallyTrack = {
  id: 'rally-regression', name: 'Rally', version: 8,
  routeKind: rallyFixture.routeKind, points: rallyFixture.points, trees: [],
  terrain: {
    cellSize: rallyFixture.terrain.cellSize,
    // Each run stores the original cells on one row as [row, firstColumn, count, kind].
    cells: rallyFixture.terrain.runs.flatMap(([row, firstColumn, count, kind]) =>
      Array.from({ length: count }, (_, offset) => ({ column: firstColumn + offset, row, kind }))),
  },
  start: { ratio: 0, reversed: false },
  lighting: 'day', createdAt: 1, updatedAt: 1,
}

function readCamera(page) {
  return page.evaluate(() => window.__trackForgeQa?.snapshot().camera ?? null)
}

async function openRallyEditor(page) {
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.getByRole('button', { name: 'EDIT', exact: true }).click()
  await expect.poll(() => readCamera(page)).not.toBeNull()
}

test.describe('Rally editor zoom', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await page.addInitScript(track => {
      localStorage.setItem('trackforge-library-v2', JSON.stringify([track]))
      localStorage.setItem('trackforge-library-v1-migrated', '1')
    }, rallyTrack)
    await page.goto('/?qa')
    await openRallyEditor(page)
  })

  test('fits the actual course in landscape and can zoom out from that view', async ({ page, context }) => {
    await page.getByRole('button', { name: 'Fit track', exact: true }).click()
    const fit = await readCamera(page)
    const canvas = page.locator('#game-container canvas')
    const { x, y, width, height } = await canvas.boundingBox()
    const dock = await page.locator('.editor-context-dock').boundingBox()
    for (const point of rallyTrack.points) {
      expect(Math.abs(point.x - fit.x) * fit.zoom).toBeLessThan(width / 2)
      const screenY = y + height / 2 + (point.y - fit.y) * fit.zoom
      expect(screenY).toBeGreaterThan(y)
      expect(screenY).toBeLessThan(dock.y)
    }
    const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true })
    await zoomOut.click()
    const first = await readCamera(page)
    expect(first.zoom).toBeLessThan(fit.zoom)
    await zoomOut.click()
    const second = await readCamera(page)
    expect(second.zoom).toBeLessThan(first.zoom)
    expect(second).toMatchObject({ x: fit.x, y: fit.y })
    expect(await roadPixelCount(page, await canvas.screenshot({ scale: 'css' }))).toBeGreaterThan(40)

    const midX = x + width / 2
    const midY = y + height / 2
    const cdp = await context.newCDPSession(page)
    try {
      await touch(cdp, 'touchStart', [contact(1, midX - 80, midY), contact(2, midX + 80, midY)])
      await touch(cdp, 'touchMove', [contact(1, midX - 50, midY), contact(2, midX + 50, midY)])
      await expect.poll(async () => (await readCamera(page)).zoom).toBeLessThan(second.zoom)
    } finally {
      await releaseTouches(cdp)
      await cdp.detach()
    }
  })

  test('restores the chosen zoom and center when the same course is reopened', async ({ page }) => {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    const chosen = await readCamera(page)
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect.poll(() => readCamera(page)).toBeNull()
    await openRallyEditor(page)
    expect(await readCamera(page)).toEqual(chosen)
  })
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

test('opens an oversized beach export and repairs its closed loop without changing the terrain', async ({ page, context }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const loop = Array.from({ length: 21 }, (_, index) => ({
    x: 1300 * Math.cos((index % 20) * Math.PI / 10),
    y: 1300 * Math.sin((index % 20) * Math.PI / 10),
    surface: 'street',
  }))
  const tail = Array.from({ length: 52 }, (_, index) => ({ x: (index + 1) * 10_000, y: 4000, surface: 'street' }))
  const cells = Array.from({ length: 3901 }, (_, index) => ({
    column: (index % 50) - 25,
    row: Math.floor(index / 50) + 15,
    kind: 'hill',
  }))
  const track = {
    name: 'Oversized beach', routeKind: 'circuit', environmentId: 'desert',
    points: [...loop, ...tail], trees: [], terrain: { cellSize: 32, cells },
    start: { ratio: 0, reversed: false },
    scenery: [{ kind: 'desert-cactus', x: 100, y: 100 }],
  }

  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/?qa')
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'oversized-beach.trackforge.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'trackforge-track', formatVersion: 1, track })),
  })
  const repair = page.getByRole('button', { name: 'Remove extra road', exact: true })
  await expect(repair).toBeVisible()
  await expect.poll(() => readCamera(page)).not.toBeNull()
  const before = await readCamera(page)
  expect(before.zoom).toBeGreaterThan(0.05)
  const canvas = page.locator('#game-container canvas')
  expect(await roadPixelCount(page, await canvas.screenshot({ scale: 'css' }))).toBeGreaterThan(60)

  const readEditor = () => page.evaluate(() => window.__trackForgeQa.snapshot().editor)
  const cdp = await context.newCDPSession(page)
  try {
    await touch(cdp, 'touchStart', [contact(1, 350, 210)])
    expect(await readEditor()).toMatchObject({ points: 73, history: 0 })
    await touch(cdp, 'touchStart', [contact(2, 490, 210)])
    await touch(cdp, 'touchMove', [contact(1, 320, 220), contact(2, 520, 220)])
    await expect.poll(async () => (await readCamera(page)).zoom).toBeGreaterThan(before.zoom)
  } finally {
    await releaseTouches(cdp)
    await cdp.detach()
  }

  await repair.click()
  await expect.poll(readEditor).toMatchObject({ points: 21, history: 1 })
  await expect(page.getByRole('status')).toHaveText('Track ready')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(repair).toBeVisible()
  expect(await readEditor()).toMatchObject({ points: 73 })
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await page.getByRole('button', { name: 'Save track', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('trackforge-library-v2')).find(item => item.name === 'Oversized beach'))
  expect(saved.points.map(({ x, y, surface }) => ({ x, y, surface }))).toEqual(loop)
  expect(saved.terrain.cells).toEqual(cells)
  expect(saved.scenery).toEqual(track.scenery)
  expect(pageErrors).toEqual([])
})
