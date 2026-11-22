import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'
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

async function useViewAction(page, label, method = 'click') {
  const control = page.getByRole('button', { name: label, exact: true })
  if (!await control.isVisible()) await page.locator('summary.editor-view-summary').click()
  if (method === 'tap') await control.tap()
  else await control.click()
}

function readCamera(page) {
  return page.evaluate(() => window.__trackForgeQa?.snapshot().camera ?? null)
}

function readRoadOutline(page, track) {
  return page.evaluate(async track => {
    const { buildTrackGeometry } = await import('/src/domain/track/trackGeometry.ts')
    return buildTrackGeometry(track).ribbon.flatMap(({ center, edgeLeft, edgeRight }) =>
      [center, edgeLeft, edgeRight].map(({ x, y }) => ({ x, y })))
  }, track)
}

async function expectClearRoad(page, outline) {
  expect(outline.length).toBeGreaterThan(0)
  const obstruction = await page.evaluate(outline => {
    const { x, y, zoom } = window.__trackForgeQa.snapshot().camera
    const canvas = document.querySelector('#game-container canvas').getBoundingClientRect()
    const controls = Array.from(document.querySelectorAll([
      '.topbar button', '.tool-rail button', '.history-actions button', '.editor-actions button',
      '.status-pill', '.diagnostic-panel', '.editor-context-dock',
    ].join(', ')), element => ({
      name: element.getAttribute('aria-label') ?? element.className,
      bounds: element.getBoundingClientRect(),
    }))
    for (const point of outline) {
      const screenX = canvas.left + canvas.width / 2 + (point.x - x) * zoom
      const screenY = canvas.top + canvas.height / 2 + (point.y - y) * zoom
      if (screenX < canvas.left || screenX > canvas.right || screenY < canvas.top || screenY > canvas.bottom) {
        return 'canvas edge'
      }
      const coveredBy = controls.find(({ bounds }) =>
        screenX > bounds.left && screenX < bounds.right && screenY > bounds.top && screenY < bounds.bottom)
      if (coveredBy) return coveredBy.name
    }
    return null
  }, outline)
  expect(obstruction, 'The rendered road fits clear of the editor controls').toBeNull()
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
    await enterTrackForge(page)
    await openRallyEditor(page)
  })

  test('fits the actual course in landscape without zooming out below the budget floor', async ({ page, context }) => {
    await useViewAction(page, 'Fit track')
    const fit = await readCamera(page)
    const canvas = page.locator('#game-container canvas')
    const { x, y, width, height } = await canvas.boundingBox()
    const dock = await page.locator('.editor-context-dock').boundingBox()
    const road = await readRoadOutline(page, rallyTrack)
    for (const point of rallyTrack.points) {
      expect(Math.abs(point.x - fit.x) * fit.zoom).toBeLessThan(width / 2)
      const screenY = y + height / 2 + (point.y - fit.y) * fit.zoom
      expect(screenY).toBeGreaterThan(y)
      expect(screenY).toBeLessThan(dock.y)
    }
    await expectClearRoad(page, road)
    // The saved Rally course is longer than the manual map-editing span.
    // Fit may frame it more widely, but normal zoom-out must not encourage extending it.
    expect(fit.zoom).toBeLessThan(844 / 15_000)
    await useViewAction(page, 'Zoom out')
    const first = await readCamera(page)
    expect(first).toEqual(fit)
    await useViewAction(page, 'Zoom out')
    const second = await readCamera(page)
    expect(second).toEqual(fit)
    await expectClearRoad(page, road)
    expect((await roadPixels(page, await canvas.screenshot({ scale: 'css' }))).count).toBeGreaterThan(0)

    const midX = x + width / 2
    const midY = y + height / 2
    const cdp = await context.newCDPSession(page)
    try {
      await touch(cdp, 'touchStart', [contact(1, midX - 80, midY), contact(2, midX + 80, midY)])
      await touch(cdp, 'touchMove', [contact(1, midX - 50, midY), contact(2, midX + 50, midY)])
      expect((await readCamera(page)).zoom).toBe(second.zoom)
    } finally {
      await releaseTouches(cdp)
      await cdp.detach()
    }
  })

  test('keeps a pinch active over the editor controls and holds the zoom on release', async ({ page, context }) => {
    // With the View drawer collapsed, both initial touch points land on the
    // canvas. The second finger then crosses the visible View control.
    const bounds = await page.locator('summary.editor-view-summary').boundingBox()
    const x = Math.round(bounds.x + bounds.width / 2)
    const y = Math.round(bounds.y + bounds.height / 2)
    const first = contact(1, x - 190, y)
    const second = contact(2, x, y + 88)
    const overFit = contact(2, x, y)
    const closer = contact(1, x - 95, y)
    const fitted = await readCamera(page)
    // Pinch still works normally when zoomed in enough for manual editing.
    let initial = fitted
    for (let step = 0; step < 40 && initial.zoom < 0.2; step += 1) {
      await useViewAction(page, 'Zoom in')
      initial = await readCamera(page)
    }
    expect(initial.zoom).toBeGreaterThanOrEqual(0.2)
    const readEditor = () => page.evaluate(() => window.__trackForgeQa.snapshot().editor)
    const editor = await readEditor()
    const cdp = await context.newCDPSession(page)
    let chosen
    try {
      await touch(cdp, 'touchStart', [first])
      await touch(cdp, 'touchStart', [second])
      await touch(cdp, 'touchMove', [contact(2, x, y + 68)])
      await expect.poll(async () => (await readCamera(page)).zoom).toBeLessThan(initial.zoom)
      await touch(cdp, 'touchMove', [overFit])
      await touch(cdp, 'touchMove', [closer])
      await expect.poll(async () => (await readCamera(page)).zoom)
        .toBeCloseTo(initial.zoom * 95 / Math.hypot(190, 88), 6)
      chosen = await readCamera(page)

      await touch(cdp, 'touchEnd', [overFit])
      await touch(cdp, 'touchMove', [contact(1, closer.x - 20, closer.y)])
    } finally {
      await releaseTouches(cdp)
      await cdp.detach()
    }

    expect(await readCamera(page)).toEqual(chosen)
    expect(await readEditor()).toEqual(editor)
    await useViewAction(page, 'Fit track', 'tap')
    expect(await readCamera(page)).toEqual(fitted)
    expect(await readEditor()).toEqual(editor)
  })

  test('restores the chosen zoom and center when the same course is reopened', async ({ page }) => {
    await useViewAction(page, 'Zoom in')
    const chosen = await readCamera(page)
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect.poll(() => readCamera(page)).toBeNull()
    await openRallyEditor(page)
    expect(await readCamera(page)).toEqual(chosen)
  })

  test('uses Fit track after panning when the already-fitted course exceeds the manual zoom range', async ({ page, context }) => {
    const canvas = await page.locator('#game-container canvas').boundingBox()
    const dock = await page.locator('.editor-context-dock').boundingBox()
    const fit = await readCamera(page)
    const x = canvas.x + canvas.width / 2
    const y = canvas.y + canvas.height * 0.34
    const horizontalPan = canvas.width * 0.38
    const road = await readRoadOutline(page, rallyTrack)
    const bottomOfRoad = camera => canvas.y + canvas.height / 2 +
      (Math.max(...rallyTrack.points.map(point => point.y)) - camera.y) * camera.zoom
    const cdp = await context.newCDPSession(page)
    try {
      await touch(cdp, 'touchStart', [contact(1, x - 65, y), contact(2, x + 65, y)])
      const nextY = y + canvas.height * 0.39
      await touch(cdp, 'touchMove', [
        contact(1, x - 65 - horizontalPan, nextY),
        contact(2, x + 65 - horizontalPan, nextY),
      ])
    } finally {
      await releaseTouches(cdp)
      await cdp.detach()
    }
    expect(bottomOfRoad(await readCamera(page))).toBeGreaterThan(dock.y)

    await useViewAction(page, 'Zoom out', 'tap')
    const overview = await readCamera(page)
    expect(overview.zoom).toBe(fit.zoom)
    expect(bottomOfRoad(overview)).toBeGreaterThan(dock.y)

    await useViewAction(page, 'Fit track', 'tap')
    expect(await readCamera(page)).toEqual(fit)
    await expectClearRoad(page, road)
  })
})

async function roadPixels(page, screenshot, includeEditorHandles = false) {
  return page.evaluate(async ({ base64, includeEditorHandles }) => {
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
    let left = canvas.width
    let right = -1
    let top = canvas.height
    let bottom = -1
    for (let i = 0; i < data.length; i += 4) {
      // A control handle can cover the asphalt at the extreme tip of a
      // zoomed-out route. Include its visible pixels in the road bounds, but
      // count only actual asphalt so handles cannot make a missing road pass.
      const asphalt = Math.abs(data[i] - 72) < 16 &&
        Math.abs(data[i + 1] - 78) < 16 && Math.abs(data[i + 2] - 86) < 16
      const handle = includeEditorHandles &&
        Math.abs(data[i] - 244) < 10 && Math.abs(data[i + 1] - 247) < 10 &&
        Math.abs(data[i + 2] - 251) < 10
      if (!asphalt && !handle) continue
      const x = i / 4 % canvas.width
      const y = Math.floor(i / 4 / canvas.width)
      if (asphalt) count++
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    return { count, left, right, top, bottom }
  }, { base64: screenshot.toString('base64'), includeEditorHandles })
}

for (const [width, height] of [[390, 844], [844, 390]]) {
  test(`standalone zoom controls show a tall road at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.addInitScript(() => {
      const points = [-3_000, 3_000].map(y => ({ x: 0, y, surface: 'street' }))
      localStorage.setItem('trackforge-library-v1', JSON.stringify([{
        id: 'track-tall-overview', name: 'Tall overview', points, trees: [], timeOfDay: 'day',
      }]))
    })
    const html = readFileSync(new URL('../../trackforge.html', import.meta.url), 'utf8')
    const endOfScript = html.lastIndexOf('})();')
    expect(endOfScript).toBeGreaterThan(0)
    // Read camera telemetry from the standalone closure only in this test.
    const probe = '\nwindow.__standaloneEditorCamera = () => ({ zoom: state.camera.zoom, points: state.points.map(worldToScreen) });\n'
    await page.route('**/trackforge.html', route => route.fulfill({
      contentType: 'text/html',
      body: html.slice(0, endOfScript) + probe + html.slice(endOfScript),
    }))
    await page.goto('/trackforge.html')
    await page.locator('#loading').waitFor({ state: 'detached' })
    await page.locator('#homeEditorBtn').click()
    await page.getByRole('button', { name: 'EDIT', exact: true }).click()
    const fit = page.locator('#fitBtn')
    const zoomOut = page.locator('#zoomOutBtn')
    await expect(fit).toBeInViewport({ ratio: 0.75 })
    await expect(zoomOut).toBeInViewport({ ratio: 0.75 })

    const overview = () => page.locator('#game').evaluate(canvas => {
      const { zoom, points } = window.__standaloneEditorCamera()
      const status = document.querySelector('#status')
      return {
        zoom,
        fits: points.length === 2 && points.every(({ x, y }) =>
          x > 0 && x < canvas.clientWidth && y > status.offsetTop + status.offsetHeight && y < canvas.clientHeight),
      }
    })
    await fit.tap()
    const fitted = await overview()
    expect(fitted.fits).toBe(true)
    await zoomOut.tap()
    const zoomed = await overview()
    expect(zoomed.zoom).toBeLessThan(fitted.zoom)
    expect(zoomed.fits).toBe(true)
  })
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
    await enterTrackForge(page)
    // This pixel test isolates the asphalt from its editor handles. At a very
    // small fit zoom the enlarged fixed-size controls can cover the thin road.
    // Keep testing the unmodified road/terrain rendering and strict edge bounds.
    await page.evaluate(async () => {
      const { EditorScene } = await import('/src/phaser/scenes/EditorScene.ts')
      const renderOverlay = EditorScene.prototype.renderOverlayPresentation
      EditorScene.prototype.renderOverlayPresentation = function (...args) {
        renderOverlay.apply(this, args)
        this.overlayGraphics?.setVisible(false)
      }
    })
    await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
    await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()
    await expect(page.locator('[data-screen="editor"]')).toBeVisible()
    const canvas = page.locator('#game-container canvas')
    await expect(canvas).toBeVisible()
    await expect.poll(() => readCamera(page)).not.toBeNull()
    const camera = await readCamera(page)
    expect(camera.zoom).toBeLessThan(0.16)
    const savedTrack = await page.evaluate(() => JSON.parse(localStorage.getItem('trackforge-library-v2'))[0])
    const outline = await readRoadOutline(page, savedTrack)
    const canvasBounds = await canvas.boundingBox()
    const xs = outline.map(point => point.x)
    const ys = outline.map(point => point.y)
    const roadBounds = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
    const expectRenderedBounds = (pixels, view) => {
      for (const side of ['left', 'right']) {
        const expected = canvasBounds.width / 2 + (roadBounds[side] - view.x) * view.zoom
        expect(Math.abs(pixels[side] - expected), `Rendered road ${side} edge`).toBeLessThan(8)
      }
      for (const side of ['top', 'bottom']) {
        const expected = canvasBounds.height / 2 + (roadBounds[side] - view.y) * view.zoom
        expect(Math.abs(pixels[side] - expected), `Rendered asphalt ${side} edge`).toBeLessThan(8)
      }
    }
    const captureRoad = async () => {
      await page.locator('#ui-root').evaluate(element => { element.style.opacity = '0' })
      try {
        return await canvas.screenshot({ scale: 'css' })
      } finally {
        await page.locator('#ui-root').evaluate(element => { element.style.opacity = '' })
      }
    }

    await expectClearRoad(page, outline)
    const before = await captureRoad()
    await testInfo.attach(`large-${width}-fit.png`, { body: before, contentType: 'image/png' })
    const initialRoad = await roadPixels(page, before, true)
    expect(initialRoad.count, 'Road is rendered at fit zoom').toBeGreaterThan(40)
    expectRenderedBounds(initialRoad, camera)

    await useViewAction(page, 'Zoom out')
    await useViewAction(page, 'Zoom out')
    const zoomed = await readCamera(page)
    const floor = Math.max(width, height) / 15_000
    expect(zoomed.zoom).toBeCloseTo(Math.max(camera.zoom / (1.2 ** 2), Math.min(camera.zoom, floor)))
    await expectClearRoad(page, outline)
    const after = await captureRoad()
    await testInfo.attach(`large-${width}-zoomed-out.png`, { body: after, contentType: 'image/png' })
    const remainingRoad = await roadPixels(page, after, true)
    expect(remainingRoad.count, 'Road is rendered after zooming out').toBeGreaterThan(20)
    expectRenderedBounds(remainingRoad, zoomed)
    metrics.push({ width, height, fitZoom: camera.zoom, zoomed: zoomed.zoom, initialRoad, remainingRoad })
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
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'oversized-beach.trackforge.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'trackforge-track', formatVersion: 1, track })),
  })
  const repair = page.getByRole('button', { name: 'Remove extra road', exact: true })
  await expect(repair).toBeVisible()
  await expect.poll(() => readCamera(page)).not.toBeNull()
  const before = await readCamera(page)
  expect(before.zoom).toBeGreaterThan(0.02)
  const canvas = page.locator('#game-container canvas')
  const outline = await readRoadOutline(page, track)
  await expectClearRoad(page, outline)
  expect((await roadPixels(page, await canvas.screenshot({ scale: 'css' }))).count).toBeGreaterThan(0)

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
