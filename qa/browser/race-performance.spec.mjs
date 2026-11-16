import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const trackDirectory = process.env.TRACKFORGE_RACE_PERF_TRACKS
const scenarios = trackDirectory ? [
  { name: 'City Harbor', filename: 'City-Harbor.trackforge.json', lighting: 'day' },
  { name: 'City Harbor', filename: 'City-Harbor.trackforge.json', lighting: 'night' },
  { name: 'Rally', filename: 'Rally.trackforge.json', lighting: 'day' },
  { name: 'Sandy Beach', filename: 'Sandy-Beach.trackforge.json', lighting: 'day' },
] : [{ name: 'Starter Circuit', lighting: 'day' }]

for (const scenario of scenarios) {
  test(`records a four-car benchmark for ${scenario.name} (${scenario.lighting})`, async ({ page }, testInfo) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 844, height: 390 })
    await page.goto('/?racePerf')
    const report = () => page.evaluate(() => window.__trackForgeRacePerformance.report())
    expect((await report()).status).toBe('idle')

    const openPicker = () => page.getByRole('button', { name: 'RACE', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a track' })
    await openPicker()
    let openRoute = false
    if (scenario.filename) {
      const path = resolve(trackDirectory, scenario.filename)
      const { track } = JSON.parse(await readFile(path, 'utf8'))
      expect(track.name).toBe(scenario.name)
      openRoute = track.routeKind === 'point-to-point'
      await picker.locator('input[type="file"]').setInputFiles(path)
      await expect(page.locator('[data-screen="editor"]')).toBeVisible()
      await page.locator('[data-action="home"]').click()
      await openPicker()
    }

    await picker.getByRole('button', { name: `Race ${scenario.name}`, exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'Race setup' })
    await setup.getByRole('button', { name: scenario.lighting.toUpperCase(), exact: true }).click()
    await setup.getByRole('button', { name: openRoute ? 'RACE AI' : 'NORMAL RACE', exact: true }).click()
    await setup.getByRole('button', { name: 'START RACE', exact: true }).click()

    await expect.poll(async () => (await report()).status, { timeout: 25_000 }).toBe('complete')
    const metrics = await report()
    expect(metrics).toMatchObject({
      race: {
        name: scenario.name,
        vehicleCount: 4,
        setup: { car: 'blue', mode: 'normal', handling: 'arcade', difficulty: 'normal', lighting: scenario.lighting },
      },
    })
    expect(metrics.startToCountdownMs).toBeGreaterThanOrEqual(0)
    expect(metrics.sampleCount).toBeGreaterThan(0)
    for (const sample of [metrics.frameIntervalMs, metrics.raceUpdateMs, metrics.simulationMs, metrics.renderSubmissionMs]) {
      expect(sample.p50).toBeGreaterThanOrEqual(0)
      expect(sample.p95).toBeGreaterThanOrEqual(sample.p50)
      expect(sample.p99).toBeGreaterThanOrEqual(sample.p95)
    }
    expect(errors).toEqual([])
    await testInfo.attach('race-performance.json', {
      body: JSON.stringify(metrics, null, 2),
      contentType: 'application/json',
    })
  })
}
