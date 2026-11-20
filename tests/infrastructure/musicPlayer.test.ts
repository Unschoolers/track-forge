// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserMusicPlayer } from '@/infrastructure/feedback/musicPlayer'

describe('race music transitions', () => {
  const decks: HTMLAudioElement[] = []
  let music: BrowserMusicPlayer<'menu' | 'race'>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.stubGlobal('Audio', new Proxy(Audio, {
      construct: () => {
        const audio = document.createElement('audio')
        let paused = true
        Object.defineProperty(audio, 'paused', { get: () => paused })
        audio.play = vi.fn(async () => { paused = false })
        audio.pause = vi.fn(() => { paused = true })
        audio.load = vi.fn()
        decks.push(audio)
        return audio
      },
    }))
    music = new BrowserMusicPlayer({ menu: 'menu.mp3', race: 'race.mp3' }, () => undefined)
    music.setVolume(1)
    music.unlock()
  })

  afterEach(() => {
    music.destroy()
    decks.length = 0
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function advance(milliseconds: number): Promise<void> {
    await Promise.resolve()
    vi.advanceTimersByTime(milliseconds)
  }

  function deckFor(track: 'menu' | 'race'): HTMLAudioElement {
    const deck = decks.find((audio) => audio.src.endsWith(`/${track}.mp3`))
    if (!deck) throw new Error(`No audio element for ${track}`)
    return deck
  }

  it('overlaps tracks and pauses the outgoing one after fading', async () => {
    music.setTrack('menu')
    await advance(0)
    const menu = deckFor('menu')
    expect(menu.volume).toBe(1)
    music.setTrack('race')
    await advance(750)
    const race = deckFor('race')
    expect(menu).not.toBe(race)
    expect(menu.paused).toBe(false)
    expect(race.paused).toBe(false)
    expect(menu.volume).toBeCloseTo(0.5, 1)
    expect(race.volume).toBeCloseTo(0.5, 1)
    await advance(800)
    expect(menu.paused).toBe(true)
    expect(race.volume).toBe(1)
  })

  it('keeps the playhead through results and the next race', async () => {
    music.setTrack('race')
    await advance(0)
    const race = deckFor('race')
    race.currentTime = 52
    // Same song with a quieter mix on results, then back to race volume.
    music.setTrack('race', 0.65)
    await advance(400)
    expect(race.volume).toBe(0.65)
    music.setTrack('race')
    await advance(400)
    expect(race.volume).toBe(1)
    expect(race.currentTime).toBe(52)
    expect(race.play).toHaveBeenCalledTimes(1)
    expect(race.pause).not.toHaveBeenCalled()
  })

  it('pauses both tracks in the background and resumes only the selected song', async () => {
    music.setTrack('menu')
    await advance(0)
    music.setTrack('race')
    await advance(300)
    const [menu, race] = decks
    music.setForeground(false)
    expect(menu?.paused).toBe(true)
    expect(race?.paused).toBe(true)
    music.setForeground(true)
    await advance(0)
    expect(menu?.paused).toBe(true)
    expect(race?.paused).toBe(false)
    expect(race?.volume).toBe(1)
  })
})
