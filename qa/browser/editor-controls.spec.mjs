import { expect, test } from '@playwright/test'

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
  for (const [width, height] of [[320, 568], [390, 720], [844, 390]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/?qa')
    await page.getByRole('button', { name: 'TRACK EDITOR', exact: true }).click()
    await page.getByRole('button', { name: 'EDIT', exact: true }).first().click()

    const editor = page.locator('[data-screen="editor"]')
    await expect(editor).toBeVisible()
    const save = editor.getByRole('button', { name: 'Save track' })
    await expect(save.locator('svg.editor-icon')).toBeVisible()
    await expect(editor.locator('.editor-context-dock')).toHaveAttribute('data-layout', 'one-row')
    await assertClearEditorControls(page, 'road')

    // The toolbar must remain clickable, not just visually present.
    const grid = editor.getByRole('button', { name: 'Toggle grid' })
    await grid.click()
    await expect(editor.getByRole('button', { name: 'Toggle grid' })).toHaveClass(/active/)
    await save.click()

    await editor.getByRole('button', { name: 'Paint terrain' }).click()
    await expect(editor.locator('.editor-context-dock')).toHaveAttribute('data-layout', 'two-row')
    await assertClearEditorControls(page, 'terrain')
  }
})
