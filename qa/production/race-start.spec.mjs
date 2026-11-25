import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 844, height: 390 } })

const gameBundle = /\/assets\/main-[^/]+\.js$/
const startButton = (page) => page.getByRole('button', { name: /^tap to start$/i })

test('shows the title during startup and starts a mobile race in the production bundle', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseBundle
  const heldBundle = new Promise(resolve => { releaseBundle = resolve })
  await page.route(gameBundle, async route => {
    await heldBundle
    await route.continue()
  })
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.getByRole('heading', { name: 'Track Forge', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Loading Track Forge…')
    await expect(startButton(page)).toHaveCount(0)
    await expect(page.locator('#app')).toHaveAttribute('inert', '')
  } finally {
    releaseBundle()
  }
  await expect(startButton(page)).toBeVisible()
  await expect(page.locator('#game-container canvas')).toBeAttached()
  await startButton(page).tap()
  await expect(page.locator('#title-screen')).toHaveCount(0)
  // A new installation must complete player-name onboarding before racing.
  const playerName = page.getByRole('dialog', { name: 'Choose your player name' })
  await expect(playerName).toBeVisible()
  await playerName.getByRole('textbox', { name: 'PLAYER NAME' }).fill('Production QA')
  await playerName.getByRole('button', { name: "LET'S RACE" }).tap()
  await expect(playerName).toHaveCount(0)
  await page.getByRole('button', { name: 'RACE', exact: true }).tap()
  await page.getByRole('button', { name: 'Race City Sprint', exact: true }).tap()
  await page.getByRole('dialog', { name: 'Race setup' })
    .getByRole('button', { name: 'START RACE', exact: true }).tap()

  const race = page.locator('[data-screen="race"]')
  await expect(race).toBeVisible()
  await expect(race.locator('[data-race-countdown]')).toHaveText(/^[123]$/)
  const clock = race.locator('[data-race-time]')
  await expect.poll(async () => Number((await clock.textContent() ?? '').replace(/[:.]/g, '')))
    .toBeGreaterThan(0)
  expect(errors).toEqual([])
})

test('supports keyboard entry and reduced motion in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(startButton(page)).toBeFocused()
  const glitch = await page.locator('.title-screen__forge').evaluate(el =>
    getComputedStyle(el, '::after').animationName)
  expect(glitch).toBe('none')
  await page.keyboard.press('Enter')
  await expect(page.locator('#title-screen')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'RACE', exact: true })).toBeFocused()
})

test('offers a retry when the game bundle fails to load', async ({ page }) => {
  let bundleAvailable = false
  await page.route(gameBundle, route => bundleAvailable ? route.continue() : route.abort())
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('Track Forge couldn’t load.')
  bundleAvailable = true
  await page.getByRole('button', { name: /^try again$/i }).tap()
  await expect(startButton(page)).toBeVisible()
})

test('reports an artwork failure while the game bundle is still loading', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseBundle
  const heldBundle = new Promise(resolve => { releaseBundle = resolve })
  await page.route(gameBundle, async route => {
    await heldBundle
    await route.continue()
  })
  await page.route(/\/assets\/scenery-[^/]+\.webp$/, route => route.abort())
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.getByRole('button', { name: /^try again$/i })).toBeVisible()
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
    await expect.poll(() => errors).toEqual([])
  } finally {
    releaseBundle()
  }
})
