import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'

test('resumes an unfinished Arcade Cup round after closing the game', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Cup', exact: true }).click()
  await page.getByRole('button', { name: 'START NEW CUP', exact: true }).click()
  await expect(page.locator('[data-race-lap]')).toHaveText('1/1')
  await page.reload()
  await enterTrackForge(page)
  await expect(page.getByText('Next Cup round: Harbor Grid')).toBeVisible()
  await page.getByRole('button', { name: 'Cup', exact: true }).click()
  await page.getByRole('button', { name: 'RESUME CUP', exact: true }).click()
  await expect(page.locator('[data-race-countdown]')).toBeVisible()
  const state = await page.evaluate(() => window.__trackForgeQa.snapshot().race)
  expect(state.setup).toMatchObject({ mode: 'normal', laps: 1 })
})

test('loads the curated Cup and introduces the first round on the grid', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Cup', exact: true }).click()
  const curated = page.getByRole('button', { name: 'LOAD CURATED CUP', exact: true })
  await expect(curated).toHaveAttribute('data-liquid-glass', '')
  await expect(curated).toHaveCSS('border-top-left-radius', '18px')
  await expect(curated.locator('lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
  // A native highlight may use an ancestor or a dynamically inserted optical
  // descendant. The entire hit-test chain must inherit the transparent color.
  const highlightColors = await curated.evaluate(button => {
    const nodes = [button, ...button.querySelectorAll('*')]
    for (let parent = button.parentElement; parent; parent = parent.parentElement) nodes.push(parent)
    return [...new Set(nodes.map(node => getComputedStyle(node).getPropertyValue('-webkit-tap-highlight-color')))]
  })
  expect(highlightColors).toEqual(['rgba(0, 0, 0, 0)'])
  await curated.click()
  const lineup = page.getByRole('list', { name: 'Cup track order' })
  await expect(lineup.getByRole('listitem')).toHaveCount(3)
  await expect(lineup.getByRole('listitem').last()).toContainText('Quarry Sprint')
  await page.getByRole('button', { name: 'START NEW CUP', exact: true }).click()
  await expect(page.locator('.cup-round-intro')).toContainText('Playroom Clover')
  await expect(page.locator('.cup-round-intro')).toContainText('ROUND 1/3')
  await expect(page.locator('.cup-round-intro')).toBeVisible()
  await expect(page.locator('.cup-round-intro')).toBeHidden({ timeout: 12_000 })
})

test('restores and completes a scored Cup after a reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('trackforge-cup-v1')) return
    localStorage.setItem('trackforge-cup-v1', JSON.stringify({
      version: 2, bestPlacement: null, checkpoint: {
        car: 'blue', difficulty: 'normal', index: 3,
        trackIds: ['official-harbor-grid', 'official-canyon-run', 'official-playroom-clover', 'official-greenway'],
        rounds: Array.from({ length: 4 }, () => [
          { id: 'player', label: 'You', points: 10 },
          { id: 'ai-1', label: 'Red', points: 6 },
        ]),
      },
    }))
  })
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Cup', exact: true }).click()
  await page.getByRole('button', { name: 'RESUME CUP', exact: true }).click()
  const final = page.getByRole('dialog', { name: 'CUP STANDINGS' })
  await expect(final.getByText('1. Mobile QA · 40 points')).toBeVisible()
  await final.getByRole('button', { name: 'FINISH CUP' }).click()
  await expect(page.getByText('Best Cup placement: 1')).toBeVisible()
  await page.reload()
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Cup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'RESUME CUP', exact: true })).toHaveCount(0)
  await expect(page.getByText('Best Cup placement: 1')).toBeVisible()
})
