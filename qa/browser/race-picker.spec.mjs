import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'
import { OWNED_TRACK_NAME, seedOwnedTrack } from './owned-track.mjs'

async function openPicker(page) {
  await page.goto('/?qa')
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'Race', exact: true }).click()
  return page.getByRole('dialog', { name: 'Choose a track' })
}

test('home uses the bundled LiquidGlass.dev optical component and keeps native actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?qa')
  await enterTrackForge(page)
  const actions = page.locator('.home-screen button.tf-menu-action')
  const race = page.getByRole('button', { name: 'Race', exact: true })
  await expect(race).toHaveAttribute('data-liquid-glass', '')
  await expect(race.locator('lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
  expect(await actions.count()).toBeGreaterThanOrEqual(4)
  await expect(page.locator('.home-screen button.tf-menu-action > lg-panel')).toHaveCount(await actions.count())
  await expect(race.locator('lg-panel')).toHaveAttribute('aria-hidden', 'true')
  await expect(race.locator('lg-panel')).toHaveCSS('pointer-events', 'none')
  await testInfo.attach('liquidglass-home-portrait', { body: await page.screenshot(), contentType: 'image/png' })
  await race.click()
  await expect(page.getByRole('dialog', { name: 'Choose a track' })).toBeVisible()
  await expect(page.locator('.home-screen lg-panel')).toHaveCount(0)
})

test('track cards stay in two columns with reachable controls on narrow and landscape phones', async ({ page }) => {
  // Track decoding caps saved names at 32 characters; use that full supported length.
  const longName = 'A Long Track Title at Max Length'
  expect(longName).toHaveLength(32)
  await seedOwnedTrack(page, 'cityscape', longName)

  const picker = await openPicker(page)
  for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    await expect(picker.locator('.track-library-search')).toBeHidden()
    await expect(picker.locator('.track-card-favorite').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(picker.locator('.track-menu-trigger').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(picker.locator('.track-card').first()).toHaveCSS('background-color', 'rgba(15, 28, 41, 0.3)')
    const back = picker.locator('.modal-footer [data-action="library-back"]')
    await expect(back).toHaveAttribute('data-liquid-glass', '')
    await expect(back).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(back.locator('lg-panel .lg-surface__tint')).toHaveCSS('background-color', 'rgba(15, 28, 41, 0.2)')
    await expect(back.locator('lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
    await expect(picker.locator('.track-library-toolbar > lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
    await expect(picker.locator('.track-card lg-panel')).toHaveCount(0)
    await expect(picker.locator('.modal-footer [data-action="library-back"]')).toHaveCSS('clip-path', 'none')
    const searchToggle = picker.getByRole('button', { name: 'Search circuits' })
    await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
    expect((await picker.locator('.track-library-toolbar').boundingBox()).height).toBeLessThanOrEqual(64)
    expect((await searchToggle.boundingBox()).width).toBeGreaterThanOrEqual(44)
    const cards = picker.locator('.track-card')
    await expect(cards.first()).toBeVisible()
    const bounds = await cards.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      const favorite = node.querySelector('.track-card-favorite')?.getBoundingClientRect()
      const overflow = node.querySelector('.track-menu-trigger')?.getBoundingClientRect()
      const preview = node.querySelector('.track-preview').getBoundingClientRect()
      const name = node.querySelector('.track-card-name').getBoundingClientRect()
      const creator = node.querySelector('.track-card-creator').getBoundingClientRect()
      return {
        card: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        favorite: favorite && { left: favorite.left, right: favorite.right, top: favorite.top, bottom: favorite.bottom, width: favorite.width, height: favorite.height },
        overflow: overflow && { left: overflow.left, right: overflow.right, top: overflow.top, bottom: overflow.bottom, width: overflow.width, height: overflow.height },
        preview: { left: preview.left, right: preview.right, top: preview.top, bottom: preview.bottom, width: preview.width },
        name: { left: name.left, right: name.right, top: name.top, bottom: name.bottom },
        creator: { left: creator.left, right: creator.right, top: creator.top, bottom: creator.bottom },
      }
    }))
    expect(bounds.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(bounds[0].card.top - bounds[1].card.top)).toBeLessThan(2)
    expect(bounds[0].card.right).toBeLessThanOrEqual(bounds[1].card.left)
    for (const item of bounds) {
      expect(item.preview.width).toBeGreaterThan(0)
      for (const text of [item.name, item.creator]) {
        expect(text.left).toBeGreaterThanOrEqual(item.card.left)
        expect(text.right).toBeLessThanOrEqual(item.card.right)
        expect(text.bottom).toBeLessThanOrEqual(item.card.bottom)
      }
      if (viewport.width <= 700) {
        expect(item.preview.top).toBeGreaterThanOrEqual(item.favorite?.bottom ?? item.card.top)
        expect(item.name.top).toBeGreaterThanOrEqual(item.preview.bottom)
        expect(item.creator.top).toBeGreaterThanOrEqual(item.preview.bottom)
      } else {
        expect(item.preview.right).toBeLessThanOrEqual(item.name.left)
      }
      for (const control of [item.favorite, item.overflow].filter(Boolean)) {
        expect(control.width).toBeGreaterThanOrEqual(44)
        expect(control.height).toBeGreaterThanOrEqual(44)
        expect(control.left).toBeGreaterThanOrEqual(item.card.left)
        expect(control.right).toBeLessThanOrEqual(item.card.right)
        expect(control.top).toBeGreaterThanOrEqual(item.card.top)
        expect(control.bottom).toBeLessThanOrEqual(item.card.bottom)
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await expect(picker.getByRole('button', { name: `Race ${longName}` })).toBeVisible()
  await picker.getByRole('button', { name: 'Search circuits' }).click()
  const search = picker.getByRole('searchbox', { name: 'Search tracks' })
  await expect(search).toBeFocused()
  await search.fill(longName)
  await expect(picker.locator('.track-card')).toHaveCount(1)
  await picker.getByRole('button', { name: 'Close search' }).click()
  await expect(search).toBeHidden()
  await expect(picker.getByRole('button', { name: 'Search circuits' })).toBeFocused()
})

test('previews every track and shares a saved track without selecting it', async ({ page }) => {
  await seedOwnedTrack(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true })
    Object.defineProperty(navigator, 'share', { value: async ({ files, text }) => {
      window.sharedTrack = { file: files[0].name, track: JSON.parse(await files[0].text()).track.name, text }
    } })
  })
  const picker = await openPicker(page)
  const saved = picker.getByRole('button', { name: `Race ${OWNED_TRACK_NAME}`, exact: true })
  const official = picker.getByRole('button', { name: 'Race Harbor Grid', exact: true })
  await expect(picker.getByRole('button', { name: 'SELECT', exact: true })).toHaveCount(0)
  await expect(saved.locator('.track-preview .track-preview-route')).toBeVisible()
  await expect(official.locator('.track-preview .track-preview-route')).toBeAttached()
  expect(await picker.locator('.track-card').count()).toBe(await picker.locator('.track-preview').count())
  await expect(picker.getByRole('button', { name: 'Share Harbor Grid', exact: true })).toHaveCount(0)
  await saved.locator('..').locator('summary.track-menu-trigger').click()
  const share = picker.getByRole('button', { name: `Share ${OWNED_TRACK_NAME}`, exact: true })
  await expect(share).toHaveText('SHARE')
  await expect(share.locator('svg path')).toHaveCount(1)
  await share.tap()
  await expect.poll(() => page.evaluate(() => window.sharedTrack)).toMatchObject({
    file: 'QA-Shared-Circuit.trackforge.json',
    track: OWNED_TRACK_NAME,
  })
  await expect(picker).toBeVisible()
  await saved.locator('.track-preview').tap()
  await expect(page.getByRole('dialog', { name: 'Race setup' })).toContainText(OWNED_TRACK_NAME)
})

test('the race flyover follows the selected track, car, lighting and motion preference', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const picker = await openPicker(page)
  await picker.getByRole('button', { name: 'Race Harbor Grid', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  const preview = setup.locator('canvas.race-flyover')
  const pixel = () => preview.evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(2, 2, 1, 1).data))
  const snapshot = () => preview.evaluate((canvas) => canvas.toDataURL())
  await expect(preview).toHaveAccessibleName('Daytime flyover of Harbor Grid')
  await expect.poll(async () => (await pixel())[3]).toBe(255)
  const day = await pixel()
  const still = await snapshot()
  const play = setup.getByRole('button', { name: 'Play flyover' })
  await expect(play).toBeVisible()
  // The preview is a non-shrinking row in the scrollable body, even on short screens.
  const panel = setup.locator('.race-flyover-panel')
  const panelBounds = await panel.boundingBox()
  const previewBounds = await preview.boundingBox()
  const playBounds = await play.boundingBox()
  expect(panelBounds).not.toBeNull()
  expect(previewBounds).not.toBeNull()
  expect(playBounds).not.toBeNull()
  expect(panelBounds.height).toBeGreaterThanOrEqual(previewBounds.height)
  expect(playBounds.y).toBeGreaterThanOrEqual(panelBounds.y)
  expect(playBounds.y + playBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height)
  await play.click()
  await expect.poll(snapshot).not.toBe(still)
  await setup.locator('[data-car="red"]').click()
  await expect(preview).toHaveAttribute('data-car', 'red')
  const speedUp = setup.getByRole('button', { name: 'Double flyover speed' })
  await expect(speedUp).toHaveText('2×')
  await speedUp.click()
  await expect(setup.getByRole('button', { name: 'Pause flyover' })).toBeVisible()
  await setup.getByRole('button', { name: 'Pause flyover' }).click()
  await expect(play).toBeVisible()
  await testInfo.attach('flyover-day', { body: await setup.screenshot(), contentType: 'image/png' })

  await setup.getByRole('button', { name: 'Night', exact: true }).click()
  await expect(setup.getByRole('button', { name: 'Night', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(preview).toHaveAccessibleName('Nighttime flyover of Harbor Grid')
  await expect.poll(async () => (await pixel())[1]).toBeLessThan(day[1])
  const hitTarget = await setup.getByRole('button', { name: 'Night', exact: true }).boundingBox()
  expect(hitTarget?.height).toBeGreaterThanOrEqual(44)
  await setup.getByRole('button', { name: 'Options' }).click()
  const options = page.getByRole('dialog', { name: 'Options' })
  await expect(options.getByRole('button', { name: 'HARD', exact: true })).toBeVisible()
  await expect(options.locator('.options-tab-list > lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
  await expect(options.locator('[data-action="options-done"] > lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
  await expect(options.getByRole('button', { name: 'Night', exact: true })).toHaveCount(0)
  await options.getByRole('button', { name: 'DONE', exact: true }).click()
  await expect(preview).toHaveAccessibleName('Nighttime flyover of Harbor Grid')
  await expect(preview).toHaveAttribute('data-car', 'red')
  await expect.poll(async () => (await pixel())[1]).toBeLessThan(day[1])
  await expect(play).toBeVisible()
  await testInfo.attach('flyover-night', { body: await setup.screenshot(), contentType: 'image/png' })

  await setup.getByRole('button', { name: 'Start Race', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__trackForgeQa.snapshot().race?.lighting)).toBe('night')
  await page.locator('[data-action="pause"]').click()
  await page.getByRole('dialog', { name: 'Race paused' }).getByRole('button', { name: 'OPTIONS' }).click()
  await expect(options.getByRole('button', { name: 'HARD', exact: true })).toHaveCount(0)
})

test('race setup actions stay visible and reachable at narrow portrait and landscape sizes', async ({ page }, testInfo) => {
  for (const viewport of [{ width: 320, height: 640 }, { width: 640, height: 320 }]) {
    await page.setViewportSize(viewport)
    const picker = await openPicker(page)
    await picker.getByRole('button', { name: 'Race Harbor Grid', exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'Race setup' })
    const footer = setup.locator('.modal-footer')
    const actions = [
      footer.getByRole('button', { name: 'Back', exact: true }),
      footer.getByRole('button', { name: 'Options', exact: true }),
      footer.getByRole('button', { name: 'Start Race', exact: true }),
    ]
    for (const action of actions) {
      await expect(action).toBeVisible()
      expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44)
    }
    const layout = await setup.evaluate((dialog) => {
      const body = dialog.querySelector('.modal-body').getBoundingClientRect()
      const footer = dialog.querySelector('.modal-footer').getBoundingClientRect()
      return { bodyBottom: body.bottom, footerTop: footer.top, footerBottom: footer.bottom, height: innerHeight }
    })
    expect(layout.bodyBottom).toBeLessThanOrEqual(layout.footerTop)
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.height)
    const cars = setup.locator('.car-picker .car-choice')
    await expect(cars).toHaveCount(4)
    const carBounds = await cars.evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect()
      return { x, y, width, height }
    }))
    for (const bounds of carBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(44)
      expect(bounds.height).toBeGreaterThanOrEqual(48)
      expect(bounds.y).toBe(carBounds[0].y)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    }
    await expect(setup).toHaveCSS('background-color', 'rgba(17, 25, 35, 0.72)')
    await expect(setup.locator('[data-action="setup-start"] > lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
    await expect(setup.locator('[data-action="lighting-day"] > lg-panel .lg-surface__glass')).toHaveCSS('filter', /url\(/)
    await expect(setup.locator('.race-flyover-panel lg-panel')).toHaveCount(0)
    await testInfo.attach(`race-setup-${viewport.width}x${viewport.height}`, { body: await setup.screenshot(), contentType: 'image/png' })
    await actions[0].focus()
    await expect(actions[0]).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(actions[1]).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(actions[2]).toBeFocused()
    await setup.getByRole('button', { name: 'Back', exact: true }).click()
  }
})

test('short landscape keeps the flyover legible and race actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const picker = await openPicker(page)
  await picker.getByRole('button', { name: 'Race Harbor Grid', exact: true }).click()
  const setup = page.getByRole('dialog', { name: 'Race setup' })
  const preview = setup.locator('canvas.race-flyover')
  const play = setup.getByRole('button', { name: 'Play flyover' })
  const start = setup.getByRole('button', { name: 'Start Race', exact: true })
  const previewBounds = await preview.boundingBox()
  const panelBounds = await setup.locator('.race-flyover-panel').boundingBox()
  const playBounds = await play.boundingBox()
  const startBounds = await start.boundingBox()
  expect(previewBounds).not.toBeNull()
  expect(panelBounds).not.toBeNull()
  expect(playBounds).not.toBeNull()
  expect(startBounds).not.toBeNull()
  expect(previewBounds.height).toBeGreaterThanOrEqual(100)
  expect(playBounds.x).toBeGreaterThanOrEqual(panelBounds.x)
  expect(playBounds.y).toBeGreaterThanOrEqual(panelBounds.y)
  expect(playBounds.x + playBounds.width).toBeLessThanOrEqual(panelBounds.x + panelBounds.width)
  expect(playBounds.y + playBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height)
  for (const bounds of [playBounds, startBounds]) {
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(844)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(390)
    expect(bounds.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await play.click()
  await start.click()
  await expect(page.locator('[data-race-countdown]')).toBeVisible()
})

test('nearby lobby fits all four full car images inside their own cards on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?qa')
  await enterTrackForge(page)
  // Render the real lobby component with a local roster; no radio or native
  // transport is needed to exercise the shared picker CSS in a browser.
  await page.evaluate(async () => {
    const { createNearbyRaceModal } = await import('/src/ui/modals/nearbyRaceModal.ts')
    const snapshot = {
      phase: 'lobby', purpose: 'race', role: 'guest', room: 'Room 7803',
      track: 'City harbor', lighting: 'day', laps: 2, localCar: 'blue',
      localReady: false, unlockPending: false, readyPending: false,
      lobbyPlayers: [
        { slot: 0, car: 'red', name: 'Host', accepted: true },
        { slot: 1, car: 'blue', name: 'Guest', accepted: false },
      ],
    }
    const noop = () => undefined
    const nearby = { snapshot: () => snapshot, localSlot: () => 1, selectLobbyCar: noop, setLobbyReady: noop }
    const lobby = createNearbyRaceModal(nearby, {
      close: noop, chooseTrack: noop, configureCup: noop, scan: noop, scanTracks: noop,
      saveTrack: noop, declineTrack: noop, connectByIp: noop, downloadDiagnostics: async () => true,
    })
    document.querySelector('#ui-root').replaceChildren(lobby)
  })
  const lobby = page.getByRole('dialog', { name: 'Race Lobby' })
  const images = lobby.locator('.car-choice img.car-silhouette')
  await expect(images).toHaveCount(4)
  await expect.poll(() => images.evaluateAll(nodes => nodes.every(image => image.complete && image.naturalWidth > 0))).toBe(true)
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size)
    const cards = await images.evaluateAll(nodes => nodes.map(image => {
      const card = image.closest('.car-choice').getBoundingClientRect()
      const bounds = image.getBoundingClientRect()
      return {
        contained: bounds.left >= card.left && bounds.right <= card.right &&
          bounds.top >= card.top && bounds.bottom <= card.bottom,
        imageHeight: bounds.height,
        cardHeight: card.height,
        objectFit: getComputedStyle(image).objectFit,
      }
    }))
    for (const card of cards) {
      expect(card.contained).toBe(true)
      expect(card.imageHeight).toBeGreaterThan(0)
      expect(card.cardHeight).toBeGreaterThanOrEqual(44)
      expect(card.cardHeight).toBeLessThan(100)
      expect(card.objectFit).toBe('contain')
    }
    await expect(lobby.getByRole('button', { name: 'I’M READY' })).toBeVisible()
  }
})
