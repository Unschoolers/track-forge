interface MusicDeck {
  readonly audio: HTMLAudioElement
  readonly source: MediaElementAudioSourceNode | undefined
  readonly gain: GainNode | undefined
  pendingPlay: Promise<void> | undefined
  level: number
  target: number
}

const CROSSFADE_MS = 1500
const MIX_FADE_MS = 300

export class BrowserMusicPlayer<MusicTrack extends string> {
  private readonly decks = new Map<MusicTrack, MusicDeck>()
  private frame: number | undefined
  private track: MusicTrack | null = null
  private level = 1
  private volume = 0
  private foreground = true
  private unlocked = false

  constructor(
    private readonly tracks: Record<MusicTrack, string>,
    private readonly getAudioContext: () => AudioContext | undefined,
  ) {}

  setTrack(track: MusicTrack | null, level = 1): void {
    if (track === this.track && level === this.level) return
    this.track = track
    this.level = level
    this.updatePlayback()
  }

  setVolume(volume: number): void {
    if (volume === this.volume) return
    this.volume = volume
    for (const deck of this.decks.values()) this.applyVolume(deck)
    this.updatePlayback()
  }

  setForeground(foreground: boolean): void {
    this.foreground = foreground
    this.updatePlayback()
  }

  unlock(): void {
    this.unlocked = true
    this.updatePlayback()
  }

  destroy(): void {
    this.unlocked = false
    this.stopPlayback()
    for (const deck of this.decks.values()) {
      deck.source?.disconnect()
      deck.gain?.disconnect()
      deck.audio.removeAttribute('src')
      deck.audio.load()
    }
    this.decks.clear()
  }

  private createDeck(track: MusicTrack): MusicDeck {
    const audio = new Audio()
    audio.loop = true
    audio.preload = 'none'

    // WebViews can ignore media element volume. When available, use Web Audio gain.
    const context = this.getAudioContext()
    const gain = context?.createGain()
    const source = context?.createMediaElementSource(audio)
    if (context && gain && source) source.connect(gain).connect(context.destination)

    const deck: MusicDeck = { audio, source, gain, level: 0, target: 0, pendingPlay: undefined }
    this.applyVolume(deck)
    audio.src = this.tracks[track]
    this.decks.set(track, deck)
    return deck
  }

  private applyVolume(deck: MusicDeck): void {
    const volume = this.volume * deck.level
    if (deck.gain) deck.gain.gain.value = volume
    else deck.audio.volume = volume
  }

  private cancelFade(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
  }

  private stopPlayback(): void {
    this.cancelFade()
    for (const deck of this.decks.values()) {
      deck.audio.pause()
      deck.pendingPlay = undefined
      deck.level = deck.target = 0
      this.applyVolume(deck)
    }
  }

  private updatePlayback(): void {
    if (!this.unlocked || !this.foreground || this.volume === 0) {
      this.stopPlayback()
      return
    }

    const track = this.track
    if (!track) {
      this.fadeTo(undefined)
      return
    }

    const deck = this.decks.get(track) ?? this.createDeck(track)
    if (deck.pendingPlay) return
    if (!deck.audio.paused) {
      this.fadeTo(deck)
      return
    }

    // Keep the outgoing song audible while the browser buffers the new one.
    const request = deck.audio.play()
    deck.pendingPlay = request
    void request.then(() => {
      if (deck.pendingPlay !== request) return
      deck.pendingPlay = undefined
      if (this.track === track) this.fadeTo(deck)
      else if (deck.level === 0) deck.audio.pause()
    }, () => {
      if (deck.pendingPlay === request) deck.pendingPlay = undefined
    })
  }

  private fadeTo(incoming: MusicDeck | undefined): void {
    const mix = [...this.decks].map(([track, deck]) => ({
      track,
      deck,
      from: deck.level,
      to: deck === incoming ? this.level : 0,
    }))
    if (mix.every(({ deck, to }) => deck.target === to)) return
    this.cancelFade()

    const audible = mix.some(({ from }) => from > 0)
    const changingTrack = mix.some(({ deck, from }) => deck !== incoming && from > 0)
    const duration = changingTrack ? CROSSFADE_MS : MIX_FADE_MS
    for (const { deck, to } of mix) deck.target = to

    const start = performance.now()
    const render = (): void => {
      const progress = audible ? Math.min((performance.now() - start) / duration, 1) : 1
      for (const { track, deck, from, to } of mix) {
        deck.level = progress === 1 ? to : from + (to - from) * progress
        this.applyVolume(deck)
        if (progress === 1 && to === 0 && track !== this.track) deck.audio.pause()
      }
      this.frame = progress < 1 ? requestAnimationFrame(render) : undefined
    }
    render()
  }
}
