import { expect, test } from '@playwright/test'

const menuTrack = /\/clubb-menu(?:-[^/]+)?\.mp3$/
const raceTrack = /\/clubb-race(?:-[^/]+)?\.mp3$/

test('plays the bundled soundtrack and resumes after the app returns to the foreground', async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      window.trackForgeMusic = this
      return play.call(this)
    }
  })

  const music = () => page.evaluate(() => {
    const audio = window.trackForgeMusic
    return audio && { src: new URL(audio.src).pathname, time: audio.currentTime, paused: audio.paused }
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'OPTIONS' }).tap()
  await expect.poll(music).toMatchObject({ src: expect.stringMatching(menuTrack), paused: false })
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(0)

  const options = page.getByRole('dialog', { name: 'Options' })
  const soundtrack = options.getByRole('slider', { name: 'Music', exact: true })
  const effects = options.getByRole('slider', { name: 'Sound Effects', exact: true })
  await soundtrack.press('Home')
  await expect.poll(music).toMatchObject({ paused: true })
  await expect(effects).toHaveValue('100')
  await effects.press('Home')
  await soundtrack.press('End')
  await expect.poll(music).toMatchObject({ paused: false })

  await page.reload()
  await page.getByRole('button', { name: 'OPTIONS' }).tap()
  await expect(soundtrack).toHaveValue('100')
  await expect(effects).toHaveValue('0')
  await options.getByRole('button', { name: 'DONE' }).tap()
  await page.getByRole('button', { name: 'RACE', exact: true }).tap()
  await page.getByRole('button', { name: 'Race Starter Circuit' }).tap()
  await page.getByRole('button', { name: 'START RACE', exact: true }).tap()
  await expect.poll(music).toMatchObject({ src: expect.stringMatching(raceTrack), paused: false })
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(0)

  await page.evaluate(() => window.dispatchEvent(new Event('trackforge:pause')))
  await expect.poll(music).toMatchObject({ paused: true })
  const pausedAt = (await music()).time
  await page.evaluate(() => window.dispatchEvent(new Event('trackforge:resume')))
  await expect.poll(async () => (await music())?.time).toBeGreaterThan(pausedAt)
})
