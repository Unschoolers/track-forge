import { expect, test } from '@playwright/test'
import { enterTrackForge } from '../enter-game.mjs'
import { OWNED_TRACK_NAME, seedOwnedTrack } from './owned-track.mjs'

const menuTrack = /\/main-menu(?:-[^/]+)?\.mp3$/
const raceTrack = /\/cityscape-race(?:-[^/]+)?\.mp3$/

async function observeMusic(page) {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      window.trackForgeMusicPlays ??= []
      window.trackForgeMusicPlays.push(this)
      return play.call(this)
    }
  })

  return () => page.evaluate(() => {
    const plays = window.trackForgeMusicPlays ?? []
    const audio = plays.at(-1)
    return audio && {
      src: new URL(audio.src).pathname,
      time: audio.currentTime,
      paused: audio.paused,
      plays: plays.length,
      playing: [...new Set(plays)].filter((deck) => !deck.paused).map((deck) => new URL(deck.src).pathname),
    }
  })
}

test('plays the bundled soundtrack and resumes after the app returns to the foreground', async ({ page }) => {
  const music = await observeMusic(page)
  await page.goto('/')
  const start = page.getByRole('button', { name: /^tap to start$/i })
  await expect(start).toBeVisible()
  expect(await music()).toBeUndefined()
  await enterTrackForge(page)
  await expect.poll(music).toMatchObject({ src: expect.stringMatching(menuTrack), paused: false })
  await page.getByRole('button', { name: 'OPTIONS' }).tap()
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(0)

  const options = page.getByRole('dialog', { name: 'Options' })
  await options.getByRole('tab', { name: 'AUDIO' }).tap()
  const soundtrack = options.getByRole('slider', { name: 'Music', exact: true })
  const effects = options.getByRole('slider', { name: 'Sound Effects', exact: true })
  await soundtrack.press('Home')
  await expect.poll(music).toMatchObject({ paused: true })
  await expect(effects).toHaveValue('100')
  await effects.press('Home')
  await soundtrack.press('End')
  await expect.poll(music).toMatchObject({ paused: false })

  await page.reload()
  await enterTrackForge(page)
  await page.getByRole('button', { name: 'OPTIONS' }).tap()
  await options.getByRole('tab', { name: 'AUDIO' }).tap()
  await expect(soundtrack).toHaveValue('100')
  await expect(effects).toHaveValue('0')
  await options.getByRole('button', { name: 'DONE' }).tap()
  await page.getByRole('button', { name: 'RACE', exact: true }).tap()
  await page.getByRole('button', { name: 'Race City Sprint' }).tap()
  await page.getByRole('button', { name: 'START RACE', exact: true }).tap()
  await expect.poll(music).toMatchObject({ src: expect.stringMatching(raceTrack), paused: false })
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(0)

  await page.evaluate(() => window.dispatchEvent(new Event('trackforge:pause')))
  await expect.poll(music).toMatchObject({ paused: true })
  const pausedAt = (await music()).time
  await page.evaluate(() => window.dispatchEvent(new Event('trackforge:resume')))
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(pausedAt)
})

for (const [environmentId, soundtrack] of [
  ['cityscape', /\/cityscape-race(?:-[^/]+)?\.mp3$/],
  ['desert', /\/desert-race(?:-[^/]+)?\.mp3$/],
  ['kids-room', /\/kids-room-race(?:-[^/]+)?\.mp3$/],
]) {
  test(`plays the ${environmentId} soundtrack during a race and its pause menu`, async ({ page }) => {
    const music = await observeMusic(page)
    await seedOwnedTrack(page, environmentId)
    await page.goto('/')
    await enterTrackForge(page)

    await page.getByRole('button', { name: 'RACE', exact: true }).tap()
    await page.getByRole('button', { name: `Race ${OWNED_TRACK_NAME}`, exact: true }).tap()
    await expect.poll(music).toMatchObject({ src: expect.stringMatching(menuTrack), paused: false })
    await page.getByRole('button', { name: 'START RACE', exact: true }).tap()
    const playing = { src: expect.stringMatching(soundtrack), paused: false }
    await expect.poll(music).toMatchObject(playing)
    const { plays } = await music()

    await page.locator('[data-action="pause"]').tap()
    const pause = page.getByRole('dialog', { name: 'Race paused' })
    await expect(pause).toBeVisible()
    const pausedMusic = await music()
    await expect.poll(async () => (await music())?.time).toBeGreaterThan(pausedMusic.time)
    await expect.poll(music).toMatchObject({ ...playing, plays })
    await pause.getByRole('button', { name: 'QUIT TO HOME', exact: true }).tap()
    await expect.poll(async () => (await music())?.playing).toEqual([expect.stringMatching(menuTrack)])
  })
}

test('uses the final Cup circuit soundtrack when restoring standings', async ({ page }) => {
  const music = await observeMusic(page)
  await page.goto('/')
  await enterTrackForge(page)
  await page.evaluate(() => {
    localStorage.setItem('trackforge-cup-v1', JSON.stringify({
      version: 2, bestPlacement: null, checkpoint: {
        car: 'blue', difficulty: 'normal', index: 0, trackIds: ['official-city-sprint'],
        rounds: [[{ id: 'player', label: 'You', points: 10 }]],
      },
    }))
  })
  await page.reload()
  await enterTrackForge(page)

  await page.getByRole('button', { name: 'CUP', exact: true }).tap()
  await page.getByRole('dialog', { name: 'CUP' }).getByRole('button', { name: 'RESUME CUP', exact: true }).tap()
  await expect(page.getByRole('dialog', { name: 'CUP STANDINGS' })).toBeVisible()
  await expect.poll(music).toMatchObject({ src: expect.stringMatching(raceTrack), paused: false })
})
