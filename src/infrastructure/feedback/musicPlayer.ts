type MusicTrack = 'menu' | 'race'

export class BrowserMusicPlayer {
  private audio: HTMLAudioElement | undefined
  private source: MediaElementAudioSourceNode | undefined
  private gain: GainNode | undefined
  private pendingPlay: Promise<void> | undefined
  private track: MusicTrack | null = null
  private volume = 0
  private foreground = true
  private unlocked = false

  constructor(
    private readonly tracks: Record<MusicTrack, string>,
    private readonly getAudioContext: () => AudioContext | undefined,
  ) {}

  setTrack(track: MusicTrack | null): void {
    if (track === this.track) return
    this.track = track
    if (this.audio) {
      this.pause()
      if (track) {
        this.audio.src = this.tracks[track]
      } else {
        this.audio.removeAttribute('src')
        this.audio.load()
      }
    }
    this.updatePlayback()
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.audio) this.applyVolume(this.audio)
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
    this.setTrack(null)
    this.unlocked = false
    this.source?.disconnect()
    this.gain?.disconnect()
    this.audio = undefined
    this.source = undefined
    this.gain = undefined
  }

  private pause(): void {
    this.audio?.pause()
    this.pendingPlay = undefined
  }

  private createAudio(track: MusicTrack): HTMLAudioElement {
    const audio = new Audio()
    audio.preload = 'none'
    audio.loop = true
    const context = this.getAudioContext()
    if (context) {
      // Use a gain node for WebViews that ignore the media element's volume.
      this.gain = context.createGain()
      this.source = context.createMediaElementSource(audio)
      this.source.connect(this.gain).connect(context.destination)
    }
    this.applyVolume(audio)
    audio.src = this.tracks[track]
    this.audio = audio
    return audio
  }

  private applyVolume(audio: HTMLAudioElement): void {
    if (this.gain) {
      this.gain.gain.value = this.volume
    } else {
      audio.volume = this.volume
    }
  }

  private updatePlayback(): void {
    if (!this.track || !this.unlocked || !this.foreground || this.volume === 0) {
      this.pause()
      return
    }

    const audio = this.audio ?? this.createAudio(this.track)
    if (!audio.paused || this.pendingPlay) return
    const request = audio.play()
    this.pendingPlay = request
    const finished = () => {
      if (this.pendingPlay === request) this.pendingPlay = undefined
    }
    void request.then(finished, finished)
  }
}
