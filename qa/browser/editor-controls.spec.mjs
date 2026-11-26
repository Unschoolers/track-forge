import { expect, test } from '@playwright/test'
import { readSavedTracks } from './saved-tracks.mjs'
import { enterTrackForge } from '../enter-game.mjs'
import { EDITOR_FIXTURE_NAME, seedEditorFixture } from './editor-fixture.mjs'
import { contact, releaseTouches, touch } from './touch.mjs'

function intersects(a, b) {
  return a.left < b.right - 1 && a.right > b.left + 1
    && a.top < b.bottom - 1 && a.bottom > b.top + 1
}

async function assertClearEditorControls(page, tool) {
  const geometry = await page.evaluate(() => {
    const bounds = selector => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing editor control: ${selector}`)
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    }
    return {
      dock: bounds('.editor-context-dock'),
      actions: bounds('.editor-actions'),
      leftRail: bounds('.tool-rail'),
      rightRail: bounds('.history-actions'),
      status: bounds('.status-pill'),
      buttons: [...document.querySelectorAll('.editor-actions button')].map(el => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }),
    }
  })
  for (const [name, region] of Object.entries(geometry)) {
    if (name === 'buttons') continue
    expect(intersects(region, geometry.actions), `${tool}: ${name} overlaps editor actions`).toBe(name === 'actions')
  }
  expect(geometry.actions.bottom).toBeLessThanOrEqual(geometry.dock.top + 1)
  expect(intersects(geometry.status, geometry.leftRail), `${tool}: status overlaps tool rail`).toBe(false)
  expect(intersects(geometry.status, geometry.rightRail), `${tool}: status overlaps history rail`).toBe(false)
  expect(geometry.buttons).toHaveLength(4)
  for (const button of geometry.buttons) {
    expect(button.right - button.left).toBeGreaterThanOrEqual(43)
    expect(button.bottom - button.top).toBeGreaterThanOrEqual(43)
  }
  for (let i = 0; i < geometry.buttons.length; i++) {
    for (let j = i + 1; j < geometry.buttons.length; j++) {
      expect(intersects(geometry.buttons[i], geometry.buttons[j])).toBe(false)
    }
  }
}

test('mobile editor controls have vector icons, visible save and no overlapping dock', async ({ page }) => {
  await seedEditorFixture(page)
  for (const [width, height] of [[320, 568], [390, 720], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/?qa')
    await enterTrackForge(page)
    await page.getByRole('button', { name: 'Track editor', exact: true }).click()
    await page.getByRole('button', { name: 'Edit ' + EDITOR_FIXTURE_NAME, exact: true }).click()

    const editor = page.locator('[data-screen="editor"]')
    await expect(editor).toBeVisible()
    const save = editor.getByRole('button', { name: 'Save track' })
    await expect(save.locator('svg.editor-icon')).toBeVisible()
    await expect(editor.locator('.editor-context-dock')).toHaveAttribute('data-layout', 'one-row')
    await assertClearEditorControls(page, 'road')

    // The toolbar must remain clickable, not just visually present.
    await editor.locator('summary.editor-view-summary').click()
    const grid = editor.getByRole('button', { name: 'Toggle grid' })
    await grid.click()
    // A state update recreates the editor screen and collapses the View menu.
    // Select by action so the assertion can inspect the now-hidden active control.
    await expect(editor.locator('[data-action="toggle-grid"]')).toHaveClass(/active/)
    await save.click()

    await editor.locator('summary.editor-toolbox-summary').click()
    await editor.getByRole('button', { name: 'Paint terrain' }).click()
    await expect(editor.locator('.editor-context-dock')).toHaveAttribute('data-layout', 'two-row')
    await assertClearEditorControls(page, 'terrain')

    await editor.getByRole('button', { name: 'Editor menu' }).click()
    await page.getByRole('combobox', { name: 'Environment' }).selectOption('cityscape')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await editor.locator('summary.editor-toolbox-summary').click()
    await editor.getByRole('button', { name: 'Scenery', exact: true }).click()
    await expect(editor.locator('.editor-context-dock')).toHaveAttribute('data-layout', 'two-row')
    await assertClearEditorControls(page, 'cityscape scenery')
  }
})

test('creates and races a themed track on mobile', async ({ page, context }) => {
  const points = Array.from({ length: 17 }, (_, index) => {
    const theta = (index % 16) * Math.PI / 8
    return { x: 260 * Math.cos(theta), y: 345 * Math.sin(theta), surface: 'street' }
  })
  await page.addInitScript((road) => {
    if (localStorage.getItem('trackforge-library-v2')) return
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'environment-qa', name: 'Environment QA', version: 8, points: road, trees: [], recoveryCheckpoints: [0.45],
      terrain: { cellSize: 32, cells: [] }, lighting: 'day', createdAt: 1, updatedAt: 1,
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, points)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  const readTrack = async () => (await readSavedTracks(page)).find(track => track.id === 'environment-qa')
  const readDraft = () => page.evaluate(() => window.__trackForgeQa.snapshot().editor)
  async function enterEditor() {
    await page.goto('/?qa')
    await enterTrackForge(page)
    await page.getByRole('button', { name: 'Track editor', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Environment QA', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__trackForgeQa?.snapshot().camera?.zoom ?? 0)).toBeGreaterThan(0)
  }
  async function setEnvironment(name) {
    await page.getByRole('button', { name: 'Editor menu' }).click()
    const choice = page.getByRole('combobox', { name: 'Environment' })
    await choice.selectOption({ label: name })
    await expect(choice.locator('option:checked')).toHaveText(name)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
  }

  await enterEditor()
  await setEnvironment('Cityscape')
  await page.locator('summary.editor-toolbox-summary').click()
  await page.getByRole('button', { name: 'Scenery', exact: true }).click()
  await page.locator('[data-scenery-kind="city-bus-stop"]').click()
  const viewport = await page.locator('#game-container canvas').boundingBox()
  expect(viewport).not.toBeNull()
  const camera = await page.evaluate(() => window.__trackForgeQa.snapshot().camera)
  const a = contact(1, Math.round(viewport.x + viewport.width * .5), Math.round(viewport.y + viewport.height * .54))
  const b = contact(1, a.x + 46, a.y - 31)
  const pointer = await context.newCDPSession(page)
  try {
    await touch(pointer, 'touchStart', [a])
    await releaseTouches(pointer)
    await expect.poll(async () => (await readDraft()).scenery).toHaveLength(1)
    const [placed] = (await readDraft()).scenery
    expect(placed.kind).toBe('city-bus-stop')
    await touch(pointer, 'touchStart', [a])
    await touch(pointer, 'touchMove', [b])
    await releaseTouches(pointer)
    await expect.poll(async () => (await readDraft()).scenery[0]?.x).not.toBe(placed.x)
    const moved = (await readDraft()).scenery
    expect(moved).toHaveLength(1)
    expect(moved[0].x - placed.x).toBeCloseTo((b.x - a.x) / camera.zoom, 1)
    expect(moved[0].y - placed.y).toBeCloseTo((b.y - a.y) / camera.zoom, 1)

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await readDraft()).scenery).toEqual([placed])
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(async () => (await readDraft()).scenery).toEqual(moved)
    await setEnvironment('Desert')
    await expect(page.locator('[data-scenery-kind="desert-cactus"]')).toBeVisible()
    await expect(page.locator('[data-scenery-kind="city-bus-stop"]')).toHaveCount(0)
    await expect.poll(async () => (await readDraft()).scenery).toEqual(moved)
    await setEnvironment('Cityscape')
    // All in-editor changes must remain drafts until this explicit save.
    expect((await readTrack()).scenery).toEqual([])
    await page.getByRole('button', { name: 'Save track', exact: true }).click()
    await expect.poll(async () => (await readTrack()).scenery).toEqual(moved)

    await enterEditor()
    await expect.poll(async () => (await readTrack()).environmentId).toBe('cityscape')
    await expect.poll(async () => (await readDraft()).scenery).toEqual(moved)
    await page.getByRole('button', { name: 'Race', exact: true }).click()
    const track = page.getByRole('button', { name: 'Race Environment QA', exact: true })
    // Biome identity is now a compact dot; map previews must remain transparent.
    await expect(track.locator('svg.track-preview')).toHaveAttribute('data-environment', 'cityscape')
    await expect(track.locator('svg.track-preview')).not.toHaveAttribute('style', /background-color/)
    await expect(track.locator('..').locator('.track-environment-dot')).toHaveAttribute('data-environment', 'cityscape')
    await track.click()
    await page.getByRole('button', { name: 'Night', exact: true }).click()
    await expect(page.locator('.race-flyover')).toHaveAttribute('data-lighting', 'night')
    await page.getByRole('button', { name: 'Start Race', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Brake', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__trackForgeQa?.snapshot().race?.lighting)).toBe('night')
    expect(errors).toEqual([])
  } finally {
    await pointer.detach()
  }
})
