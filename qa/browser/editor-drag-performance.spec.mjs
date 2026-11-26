import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'
import { contact, releaseTouches, touch } from './touch.mjs'

const externalTrack = process.env.TRACKFORGE_EDITOR_PERF_TRACK
const enabled = Boolean(externalTrack || process.env.TRACKFORGE_PERFORMANCE_QA === '1')

test('profiles live road dragging on a large track', async ({ page, context }, testInfo) => {
  test.skip(!enabled, 'Opt-in performance capture; set TRACKFORGE_EDITOR_PERF_TRACK or TRACKFORGE_PERFORMANCE_QA=1')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 844, height: 390 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  if (!externalTrack) {
    await page.addInitScript(() => {
      const points = Array.from({ length: 33 }, (_, index) => {
        const angle = (index % 32) * Math.PI / 16
        return { x: 3600 * Math.cos(angle), y: 3000 * Math.sin(angle), surface: 'street' }
      })
      const cells = Array.from({ length: 18268 }, (_, index) => ({
        column: index % 180 - 90, row: Math.floor(index / 180) - 50,
        kind: index < 15701 ? 'hill' : 'water',
      }))
      localStorage.setItem('trackforge-library-v2', JSON.stringify([{
        id: 'editor-perf', name: 'NJ-scale benchmark', version: 8,
        points, trees: [], terrain: { cellSize: 32, cells },
        environmentId: 'kids-room', createdAt: 1, updatedAt: 1,
      }]))
      localStorage.setItem('trackforge-library-v1-migrated', '1')
    })
  }
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.evaluate(async () => {
    const { EditorScene } = await import('/src/phaser/scenes/EditorScene.ts')
    const { TrackGeometryService } = await import('/src/domain/track/trackGeometryService.ts')
    const { DomUiHost } = await import('/src/ui/uiHost.ts')
    const samples = { terrain: [], world: [], geometry: [], chrome: [], frame: [] }
    const wrap = (prototype, method, key) => {
      const original = prototype[method]
      if (typeof original !== 'function') throw new Error('Missing profiler method: ' + method)
      prototype[method] = function (...args) {
        const start = performance.now()
        try { return original.apply(this, args) }
        finally { samples[key].push(performance.now() - start) }
      }
    }
    wrap(EditorScene.prototype, 'renderTerrainPresentation', 'terrain')
    wrap(EditorScene.prototype, 'renderWorldPresentation', 'world')
    wrap(TrackGeometryService.prototype, 'get', 'geometry')
    wrap(DomUiHost.prototype, 'render', 'chrome')
    let previous
    const frame = now => {
      if (previous !== undefined) samples.frame.push(now - previous)
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    const summarize = values => {
      const ordered = [...values].sort((a, b) => a - b)
      const at = q => ordered.length ? ordered[Math.ceil(ordered.length * q) - 1] : null
      return { count: ordered.length, p50: at(.5), p95: at(.95), p99: at(.99), max: ordered.at(-1) ?? null,
        totalMs: ordered.reduce((sum, value) => sum + value, 0) }
    }
    window.editorDragPerf = {
      reset: () => { for (const values of Object.values(samples)) values.length = 0; previous = undefined },
      report: () => Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])),
    }
  })
  await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
  if (externalTrack) {
    await page.locator('input[type="file"]').setInputFiles(resolve(externalTrack))
  } else {
    await page.getByRole('button', { name: 'Edit NJ-scale benchmark', exact: true }).click()
  }
  await expect(page.locator('[data-screen="editor"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().camera?.zoom ?? 0)).toBeGreaterThan(0)
  await page.locator('summary.editor-toolbox-summary').click()
  await page.getByRole('button', { name: 'Move points', exact: true }).click()
  const target = await page.evaluate(() => {
    const { camera, editor } = window.__trackForgeQa.snapshot()
    const canvas = document.querySelector('#game-container canvas')
    const r = canvas.getBoundingClientRect()
    for (const [index, point] of editor.controlPoints.entries()) {
      const x = r.left + r.width / 2 + (point.x - camera.x) * camera.zoom
      const y = r.top + r.height / 2 + (point.y - camera.y) * camera.zoom
      for (const [dx, dy] of [[48, 0], [-48, 0], [0, 48], [0, -48]]) {
        if ([0, .25, .5, .75, 1].every(t => document.elementFromPoint(x + dx * t, y + dy * t) === canvas)) {
          return { index, x, y, dx, dy }
        }
      }
    }
    return null
  })
  expect(target, 'An exposed road point must have room for a drag').not.toBeNull()
  const reset = () => page.evaluate(() => window.editorDragPerf.reset())
  const report = () => page.evaluate(() => window.editorDragPerf.report())
  const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const before = await page.evaluate(() => window.__trackForgeQa.snapshot().editor)
  await reset()
  await page.waitForTimeout(1000)
  const idle = await report()
  const pointer = await context.newCDPSession(page)
  try {
    await touch(pointer, 'touchStart', [contact(1, target.x, target.y)])
    await nextFrame()
    await reset()
    for (let step = 1; step <= 24; step++) {
      const t = step / 24
      await touch(pointer, 'touchMove', [contact(1, target.x + target.dx * t, target.y + target.dy * t)])
      await nextFrame()
    }
    const dragging = await report()
    await reset()
    await releaseTouches(pointer)
    await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().editor.history)).toBe(before.history + 1)
    await nextFrame()
    const commit = await report()
    const after = await page.evaluate(() => window.__trackForgeQa.snapshot().editor)
    expect(after.controlPoints[target.index]).not.toEqual(before.controlPoints[target.index])
    expect(dragging.frame.count).toBeGreaterThan(0)
    expect(errors).toEqual([])
    await testInfo.attach('editor-drag-performance.json', {
      body: JSON.stringify({ track: externalTrack ? 'provided track' : 'NJ-scale synthetic', target, idle, dragging, commit }, null, 2),
      contentType: 'application/json',
    })
    console.log(JSON.stringify({ idle, dragging, commit }))
  } finally {
    await releaseTouches(pointer)
    await pointer.detach()
  }
})
