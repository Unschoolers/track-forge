import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'

const trackDirectory = process.env.TRACKFORGE_RACE_PERF_TRACKS
const scenarios = trackDirectory ? [
  { name: 'City Harbor', filename: 'City-Harbor.trackforge.json', lighting: 'day' },
  { name: 'City Harbor', filename: 'City-Harbor.trackforge.json', lighting: 'night' },
  { name: 'Rally', filename: 'Rally.trackforge.json', lighting: 'day' },
  { name: 'Sandy Beach', filename: 'Sandy-Beach.trackforge.json', lighting: 'day' },
] : [{ name: 'City Sprint', lighting: 'day' }]

for (const scenario of scenarios) {
  test(`records a four-car benchmark for ${scenario.name} (${scenario.lighting})`, async ({ page }, testInfo) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 844, height: 390 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/?racePerf')
    await enterTrackForge(page)
    const report = () => page.evaluate(() => window.__trackForgeRacePerformance.report())
    const openPicker = () => page.getByRole('button', { name: 'RACE', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a track' })

    let trackName = scenario.name
    if (scenario.filename) {
      test.setTimeout(90_000)
      await openPicker()
      await picker.locator('input[type="file"]').setInputFiles(resolve(trackDirectory, scenario.filename))
      const editor = page.locator('[data-screen="editor"]')
      await expect(editor).toBeVisible()
      trackName = await editor.locator('[data-action="rename-track"]').textContent()
      expect(trackName).toBeTruthy()
      // Older Sandy Beach exports have a recoverable tail after the closed loop.
      const repair = editor.getByRole('button', { name: 'Remove extra road', exact: true })
      if (await repair.isVisible()) {
        await repair.click()
        await expect(repair).toHaveCount(0)
        await editor.getByRole('button', { name: 'Save track', exact: true }).click()
        await expect(editor.getByRole('status')).toHaveText('Track saved.')
      }
      await page.reload()
      await enterTrackForge(page)
    }

    expect((await report()).status).toBe('idle')
    for (const run of scenario.filename ? ['first', 'warm'] : ['first']) {
      if (run === 'warm') {
        await page.locator('[data-action="pause"]').click()
        await page.getByRole('dialog', { name: 'Race paused' })
          .getByRole('button', { name: 'QUIT TO HOME', exact: true }).click()
      }

      await openPicker()
      await picker.getByRole('button', { name: `Race ${trackName}`, exact: true }).click()
      const setup = page.getByRole('dialog', { name: 'Race setup' })
      await setup.getByRole('button', { name: scenario.lighting.toUpperCase(), exact: true }).click()
      await setup.getByRole('button', { name: /^(NORMAL RACE|RACE AI)$/ }).click()
      if (scenario.filename) {
        await expect(setup.getByRole('button', { name: 'Pause flyover' })).toBeVisible()
        await page.waitForTimeout(5_000)
      }
      await setup.getByRole('button', { name: 'START RACE', exact: true }).click()
      await expect(page.locator('[data-screen="race"]')).toBeVisible()

      await expect.poll(async () => (await report()).status, { timeout: 25_000 }).toBe('complete')
      const metrics = await report()
      expect(metrics).toMatchObject({
        race: {
          name: trackName,
          vehicleCount: 4,
          setup: { car: 'blue', mode: 'normal', difficulty: 'normal', lighting: scenario.lighting },
        },
      })
      expect(metrics.startToCountdownMs).toBeGreaterThanOrEqual(0)
      expect(metrics.sampleCount).toBeGreaterThan(0)
      for (const sample of [metrics.frameIntervalMs, metrics.raceUpdateMs, metrics.simulationMs, metrics.renderSubmissionMs]) {
        expect(sample.p50).toBeGreaterThanOrEqual(0)
        expect(sample.p95).toBeGreaterThanOrEqual(sample.p50)
        expect(sample.p99).toBeGreaterThanOrEqual(sample.p95)
      }
      await testInfo.attach(scenario.filename ? `race-performance-${run}.json` : 'race-performance.json', {
        body: JSON.stringify(metrics, null, 2),
        contentType: 'application/json',
      })
    }
    expect(errors).toEqual([])
  })
}
