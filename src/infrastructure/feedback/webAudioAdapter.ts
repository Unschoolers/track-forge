import type {
  FeedbackEvent,
  FeedbackPort,
} from '@/application/ports/feedback'
import type { SurfaceId } from '@/domain/model'
import type { CarId } from '@/domain/model'
import { calculateGearboxTone } from '@/domain/audio/gearbox'
import { calculateEngineVoice } from '@/domain/audio/engineVoice'

export interface ToneSink {
  unlock(): void
  play(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void
  setEngine(
    car: CarId,
    speedRatio: number,
    throttle: number,
    cornering: number,
  ): void
  setSurface(surface: SurfaceId | 'grass', speedRatio: number): void
  setSlip(strength: number, speedRatio?: number, surface?: SurfaceId | 'grass'): void
  setRival?(proximity: number, pan: number, speedRatio: number): void
  silenceContinuous(): void
  destroy(): void
}

export class BrowserToneSink implements ToneSink {
  private context: AudioContext | undefined
  private engine: OscillatorNode | undefined
  private enginePulse: OscillatorNode | undefined
  private enginePulseGain: GainNode | undefined
  private engineNoise: AudioBufferSourceNode | undefined
  private engineNoiseGain: GainNode | undefined
  private engineNoiseFilter: BiquadFilterNode | undefined
  private engineFilter: BiquadFilterNode | undefined
  private engineGain: GainNode | undefined
  private road: AudioBufferSourceNode | undefined
  private roadFilter: BiquadFilterNode | undefined
  private roadGain: GainNode | undefined
  private engineGear: number | undefined
  private slip: AudioBufferSourceNode | undefined
  private slipFilter: BiquadFilterNode | undefined
  private slipGain: GainNode | undefined
  private rival: OscillatorNode | undefined
  private rivalGain: GainNode | undefined
  private rivalPan: StereoPannerNode | undefined

  unlock(): void {
    if (this.context) {
      void this.context.resume()
      return
    }
    const context = new AudioContext()
    this.context = context

    const noiseBuffer = context.createBuffer(
      1,
      context.sampleRate * 2,
      context.sampleRate,
    )
    const noise = noiseBuffer.getChannelData(0)
    // Deterministic noise avoids a different timbre on every unlock while
    // retaining the rough mechanical texture of an early-game engine synth.
    let noiseSeed = 0x4d_52_41_43
    for (let index = 0; index < noise.length; index += 1) {
      noiseSeed = (Math.imul(noiseSeed, 1_664_525) + 1_013_904_223) >>> 0
      noise[index] = (noiseSeed / 0x1_00_00_00_00) * 2 - 1
    }

    this.engine = context.createOscillator()
    this.enginePulse = context.createOscillator()
    const engineCoreGain = context.createGain()
    this.enginePulseGain = context.createGain()
    this.engineNoise = context.createBufferSource()
    this.engineNoiseFilter = context.createBiquadFilter()
    this.engineNoiseGain = context.createGain()
    const engineDrive = context.createWaveShaper()
    this.engineFilter = context.createBiquadFilter()
    this.engineGain = context.createGain()

    this.engine.type = 'sawtooth'
    this.enginePulse.type = 'square'
    engineCoreGain.gain.value = 0.62
    this.enginePulseGain.gain.value = 0
    this.engineNoise.buffer = noiseBuffer
    this.engineNoise.loop = true
    this.engineNoiseFilter.type = 'bandpass'
    this.engineNoiseFilter.Q.value = 0.72
    this.engineNoiseGain.gain.value = 0
    const saturationCurve = new Float32Array(257)
    const saturationAmount = 1.85
    const saturationLimit = Math.tanh(saturationAmount)
    for (let index = 0; index < saturationCurve.length; index += 1) {
      const input = (index / (saturationCurve.length - 1)) * 2 - 1
      saturationCurve[index] =
        Math.tanh(input * saturationAmount) / saturationLimit
    }
    engineDrive.curve = saturationCurve
    engineDrive.oversample = '2x'
    this.engineFilter.type = 'lowpass'
    this.engineFilter.Q.value = 0.65
    this.engineGain.gain.value = 0

    this.engine.connect(engineCoreGain).connect(engineDrive)
    this.enginePulse.connect(this.enginePulseGain).connect(engineDrive)
    this.engineNoise
      .connect(this.engineNoiseFilter)
      .connect(this.engineNoiseGain)
      .connect(engineDrive)
    engineDrive
      .connect(this.engineFilter)
      .connect(this.engineGain)
      .connect(context.destination)
    this.engine.start()
    this.enginePulse.start()
    this.engineNoise.start()

    this.road = context.createBufferSource()
    this.road.buffer = noiseBuffer
    this.road.loop = true
    this.roadFilter = context.createBiquadFilter()
    this.roadFilter.type = 'bandpass'
    this.roadFilter.Q.value = 0.8
    this.roadGain = context.createGain()
    this.roadGain.gain.value = 0
    this.road
      .connect(this.roadFilter)
      .connect(this.roadGain)
      .connect(context.destination)
    this.road.start()

    this.slip = context.createBufferSource()
    this.slip.buffer = noiseBuffer
    this.slip.loop = true
    this.slipFilter = context.createBiquadFilter()
    this.slipFilter.type = 'bandpass'
    this.slipFilter.Q.value = 1.4
    this.slipGain = context.createGain()
    this.slipGain.gain.value = 0
    this.slip.connect(this.slipFilter).connect(this.slipGain).connect(context.destination)
    this.slip.start()

    this.rival = context.createOscillator()
    this.rival.type = 'sawtooth'
    this.rivalGain = context.createGain()
    this.rivalGain.gain.value = 0
    if (typeof context.createStereoPanner === 'function') {
      this.rivalPan = context.createStereoPanner()
      this.rival.connect(this.rivalGain).connect(this.rivalPan).connect(context.destination)
    } else {
      this.rival.connect(this.rivalGain).connect(context.destination)
    }
    this.rival.start()
  }

  play(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context
    if (!context) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = frequency
    oscillator.type = type
    gain.gain.setValueAtTime(volume, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + duration,
    )
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + duration)
  }

  setEngine(
    car: CarId,
    speedRatio: number,
    throttle: number,
    cornering: number,
  ): void {
    const context = this.context
    if (
      !context ||
      !this.engine ||
      !this.enginePulse ||
      !this.enginePulseGain ||
      !this.engineNoiseGain ||
      !this.engineNoiseFilter ||
      !this.engineFilter ||
      !this.engineGain
    ) return
    const tone = calculateGearboxTone(
      car,
      speedRatio,
      throttle,
      this.engineGear,
      cornering,
    )
    const voice = calculateEngineVoice(tone)
    this.engineGear = tone.gear
    this.engine.frequency.setTargetAtTime(
      voice.coreFrequency,
      context.currentTime,
      tone.shift === 'none' ? 0.035 : 0.018,
    )
    this.enginePulse.frequency.setTargetAtTime(
      voice.pulseFrequency,
      context.currentTime,
      tone.shift === 'none' ? 0.04 : 0.02,
    )
    this.enginePulseGain.gain.setTargetAtTime(
      voice.pulseGain,
      context.currentTime,
      0.055,
    )
    this.engineNoiseGain.gain.setTargetAtTime(
      voice.noiseGain,
      context.currentTime,
      0.07,
    )
    this.engineNoiseFilter.frequency.setTargetAtTime(
      voice.filterFrequency * 0.72,
      context.currentTime,
      0.06,
    )
    this.engineFilter.frequency.setTargetAtTime(
      voice.filterFrequency,
      context.currentTime,
      0.055,
    )
    this.engineGain.gain.setTargetAtTime(
      voice.outputGain,
      context.currentTime,
      0.05,
    )
  }

  setSurface(surface: SurfaceId | 'grass', speedRatio: number): void {
    const context = this.context
    if (!context || !this.roadFilter || !this.roadGain) return
    const frequencies = { street: 820, dirt: 260, grass: 170, ice: 1_450 }
    const volumes = { street: 0.005, dirt: 0.012, grass: 0.014, ice: 0.004 }
    this.roadFilter.frequency.setTargetAtTime(
      frequencies[surface],
      context.currentTime,
      0.06,
    )
    this.roadGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, speedRatio)) * volumes[surface],
      context.currentTime,
      0.08,
    )
  }

  setSlip(strength: number, speedRatio = 1, surface: SurfaceId | 'grass' = 'street'): void {
    const context = this.context
    if (!context || !this.slipGain || !this.slipFilter) return
    const amount = Math.max(0, Math.min(1, strength))
    const speed = Math.max(0, Math.min(1, speedRatio))
    const frequency = { street: 1800, dirt: 850, grass: 600, ice: 2400 }[surface]
    this.slipFilter.frequency.setTargetAtTime(frequency + speed * 500, context.currentTime, 0.08)
    if (amount * speed > 0) this.slipGain.gain.cancelScheduledValues(context.currentTime)
    this.slipGain.gain.setTargetAtTime(amount * speed * 0.035, context.currentTime, amount ? 0.06 : 0.09)
    if (amount * speed === 0) this.slipGain.gain.setValueAtTime(0, context.currentTime + 0.9)
  }

  setRival(proximity: number, pan: number, speedRatio: number): void {
    const context = this.context
    if (!context || !this.rival || !this.rivalGain) return
    const near = Math.max(0, Math.min(1, proximity))
    this.rival.frequency.setTargetAtTime(55 + Math.max(0, Math.min(1, speedRatio)) * 100, context.currentTime, 0.1)
    this.rivalGain.gain.setTargetAtTime(near * near * 0.018, context.currentTime, 0.1)
    this.rivalPan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), context.currentTime, 0.1)
  }

  silenceContinuous(): void {
    const context = this.context
    if (!context) return
    this.fadeOut(this.engineGain, context.currentTime)
    this.fadeOut(this.roadGain, context.currentTime)
    this.fadeOut(this.slipGain, context.currentTime)
    this.fadeOut(this.rivalGain, context.currentTime)
    this.fadeOut(this.enginePulseGain, context.currentTime)
    this.fadeOut(this.engineNoiseGain, context.currentTime)
    this.engineGear = undefined
  }

  destroy(): void {
    this.engine?.stop()
    this.enginePulse?.stop()
    this.engineNoise?.stop()
    this.road?.stop()
    this.slip?.stop()
    this.rival?.stop()
    void this.context?.close()
    this.context = undefined
    this.engine = undefined
    this.enginePulse = undefined
    this.enginePulseGain = undefined
    this.engineNoise = undefined
    this.engineNoiseGain = undefined
    this.engineNoiseFilter = undefined
    this.engineFilter = undefined
    this.engineGain = undefined
    this.engineGear = undefined
    this.road = undefined
    this.roadFilter = undefined
    this.roadGain = undefined
    this.slip = undefined
    this.slipFilter = undefined
    this.slipGain = undefined
    this.rival = undefined
    this.rivalGain = undefined
    this.rivalPan = undefined
  }

  private fadeOut(gain: GainNode | undefined, now: number): void {
    if (!gain) return
    gain.gain.cancelScheduledValues(now)
    gain.gain.setTargetAtTime(0, now, 0.025)
  }
}

export class WebAudioAdapter implements FeedbackPort {
  private sink: ToneSink | undefined
  private unlocked = false

  constructor(
    private readonly createSink: () => ToneSink,
    private enabled: boolean,
  ) {}

  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.sink = this.createSink()
    this.sink.unlock()
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) this.silenceContinuous()
    this.enabled = enabled
  }

  handle(event: FeedbackEvent): void {
    if (!this.enabled || !this.unlocked || !this.sink) return
    if (event.type === 'engine') {
      this.sink.setEngine(
        event.car,
        event.speedRatio,
        event.throttle,
        event.cornering,
      )
    } else if (event.type === 'surface') {
      this.sink.setSurface(event.surface, event.speedRatio)
    } else if (event.type === 'tire-slip') {
      this.sink.setSlip(event.strength, event.speedRatio, event.surface)
    } else if (event.type === 'rival') {
      this.sink.setRival?.(event.proximity, event.pan, event.speedRatio)
    } else if (event.type === 'landing') {
      this.sink.play(75, 0.1, Math.min(0.08, event.strength * 0.05), 'triangle')
    } else if (event.type === 'collision') {
      this.sink.play(
        90,
        0.12,
        Math.min(0.12, 0.035 + event.strength / 1600),
        'sawtooth',
      )
    } else if (event.type === 'finish') {
      this.sink.play(
        event.newRecord ? 1040 : event.place === 1 ? 880 : 440,
        0.3,
        0.06,
        'triangle',
      )
    } else if (event.type === 'ui') {
      this.sink.play(
        event.emphasis === 'danger'
          ? 210
          : event.emphasis === 'confirm'
            ? 620
            : 420,
        0.06,
        0.025,
        'sine',
      )
    } else if (event.type === 'curb') {
      this.sink.play(120, 0.025, 0.015, 'square')
    }
  }

  silenceContinuous(): void {
    this.sink?.silenceContinuous()
  }

  destroy(): void {
    this.sink?.destroy()
    this.sink = undefined
    this.unlocked = false
  }
}
