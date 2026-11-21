import { Capacitor } from '@capacitor/core'
import { GitHubUpdateProvider } from '@/application/updates/updateProvider'
import { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { createAndroidNearby } from '@/infrastructure/multiplayer/androidNearby'
import { validateTrack } from '@/domain/track/trackValidation'
import { BrowserCupRepository } from '@/infrastructure/storage/cupRepository'
import { handleBackground } from '@/application/backgroundLifecycle'
import { audioVolumes, musicGain, type AudioVolumeSetting } from '@/application/audioVolume'
import { createApplication } from '@/app/createApplication'
import { AppController, type Scheduler } from '@/application/appController'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { BrowserStorage } from '@/infrastructure/storage/browserStorage'
import { BrowserPreferencesRepository } from '@/infrastructure/storage/preferencesRepository'
import { BrowserLastRaceRepository } from '@/infrastructure/storage/lastRaceRepository'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import { BrowserTrackRepository } from '@/infrastructure/storage/trackRepository'
import { PhaserSceneHost } from '@/phaser/sceneHost'
import { DomUiHost } from '@/ui/uiHost'
import { installRacePerformance } from '@/infrastructure/qa/racePerformance'
import '@/styles/layout.css'
import '@/styles/home-menu.css'
import '@/styles/menu-dialogs.css'
import '@/styles/race-menus.css'
import '@/styles/editor-menus.css'
import { RaceSession } from '@/application/race/raceSession'
import { CUP_CIRCUITS } from '@/application/race/circuitCup'
import { mathRandom } from '@/infrastructure/random/mathRandom'
import { inputForHandling, RaceInputController } from '@/phaser/input/raceInput'
import { FeedbackRouter } from '@/application/feedback/feedbackRouter'
import {
  BrowserToneSink,
  WebAudioAdapter,
} from '@/infrastructure/feedback/webAudioAdapter'
import { HapticsAdapter } from '@/infrastructure/feedback/hapticsAdapter'
import { BrowserMusicPlayer } from '@/infrastructure/feedback/musicPlayer'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTrackEnvironmentId, type TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import cityMusic from '@/assets/music/City.mp3?url&no-inline'
import desertMusic from '@/assets/music/Desert.mp3?url&no-inline'
import menuMusic from '@/assets/music/clubb-menu.mp3?url&no-inline'
import grassMusic from '@/assets/music/clubb-race.mp3?url&no-inline'

const appRoot = document.querySelector<HTMLElement>('#app')
if (!appRoot) throw new Error('TrackForge requires an #app mount point')

const gameContainer = document.createElement('div')
gameContainer.id = 'game-container'
const uiRoot = document.createElement('div')
uiRoot.id = 'ui-root'
appRoot.replaceChildren(gameContainer, uiRoot)

const storage = new BrowserStorage()
const trackStore = new BrowserTrackRepository(storage)
if (trackStore.list().length === 0) {
  trackStore.save(
    createStarterTrack(
      asTrackId(`starter-${Date.now().toString(36)}`),
      Date.now(),
    ),
  )
}

const scheduler: Scheduler = {
  schedule(delayMs, task) {
    const timer = window.setTimeout(task, delayMs)
    return () => window.clearTimeout(timer)
  },
}

const scoreStore = new BrowserScoreRepository(storage)
const geometry = new TrackGeometryService()
const nearbyTransport = createAndroidNearby()
const nearby = nearbyTransport && new NearbyRace(nearbyTransport,
  (track) => validateTrack(track, geometry.get(track).path.totalLength).ready)
const initialPreferences = new BrowserPreferencesRepository(storage)
const toneSink = new BrowserToneSink()
const music = new BrowserMusicPlayer<'menu' | TrackEnvironmentId>({
  menu: menuMusic,
  grass: grassMusic,
  cityscape: cityMusic,
  desert: desertMusic,
}, () => toneSink.audioContext)
const feedback = new FeedbackRouter({
  audio: new WebAudioAdapter(() => toneSink, true),
  haptics: new HapticsAdapter(
    navigator.vibrate?.bind(navigator),
    true,
  ),
})
const raceSession = new RaceSession({
  nearby,
  scoreStore,
  ghostStore: new BrowserGhostRepository(storage),
  random: mathRandom,
  feedback,
  geometry,
})
const raceControls = new RaceInputController()
const controller = new AppController({
  nearby,
  cupStore: new BrowserCupRepository(storage),
  trackStore,
  scoreStore,
  lastRaceStore: new BrowserLastRaceRepository(storage),
  preferencesStore: initialPreferences,
  scheduler,
  raceSession,
  geometry,
})
const uiHost = new DomUiHost(uiRoot, controller, {
  nearby,
  raceSession,
  raceControls,
  feedback,
  geometry,
  prepareRace: (track, trackGeometry, lighting) => sceneHost.prepareRace(track, trackGeometry, lighting),
  previewAudioVolume: setAudioVolume,
  ...(Capacitor.isNativePlatform() ? { updateProvider: new GitHubUpdateProvider(
    Number(import.meta.env.VITE_TRACKFORGE_BUILD_RUN),
    Number(import.meta.env.VITE_TRACKFORGE_BUILD_ATTEMPT),
  ) } : {}),
})
const racePerformance = (import.meta.env.DEV || import.meta.env.VITE_TRACKFORGE_RACE_PERF === '1') &&
  new URLSearchParams(location.search).has('racePerf')
  ? installRacePerformance()
  : undefined
const sceneHost = new PhaserSceneHost(
  gameContainer,
  controller,
  raceSession,
  raceControls,
  geometry,
  racePerformance,
)
const application = createApplication({ sceneHost, uiHost })

function setAudioVolume(setting: AudioVolumeSetting, volume: number): void {
  if (setting === 'musicVolume') music.setVolume(musicGain(volume))
  else toneSink.setVolume(volume / 100)
}

function syncAudio(snapshot: ReturnType<typeof controller.snapshot>): void {
  const { musicVolume, soundEffectsVolume } = audioVolumes(snapshot.preferences)
  feedback.setChannels({ audio: soundEffectsVolume > 0, haptics: snapshot.preferences.hapticsEnabled })
  toneSink.setVolume(soundEffectsVolume / 100)
  const cupFinal = snapshot.overlay.type === 'cup-final'
  const track = cupFinal && snapshot.cup
    ? CUP_CIRCUITS[snapshot.cup.index]?.track
    : raceSession.snapshot().track
  const soundtrack = snapshot.mode === 'race' || cupFinal
    ? normalizeTrackEnvironmentId(track?.environmentId)
    : snapshot.mode === 'home' ? 'menu' : null
  music.setTrack(soundtrack, snapshot.paused || cupFinal ? 0.65 : 1)
  music.setVolume(musicGain(musicVolume))
}

sceneHost.setRacePreparationForeground(!document.hidden)
music.setForeground(!document.hidden)
syncAudio(controller.snapshot())
application.start()
export const gameReady = sceneHost.whenReady()
// Render the controls before a scene uses their bounds to fit the camera.
const stopSceneSync = controller.subscribe((snapshot) => {
  sceneHost.start(snapshot.mode)
  syncAudio(snapshot)
})

// The QA bridge exists only on the Vite dev server with ?qa.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa')) {
  const qaWindow = window as Window & {
    __trackForgeQa?: { snapshot: () => unknown; advanceRace: (seconds: number) => void }
  }
  qaWindow.__trackForgeQa = {
    advanceRace: (seconds) => {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 20) throw new Error('Invalid QA race interval')
      const { setup } = raceSession.snapshot()
      if (!setup || setup.mode === 'nearby') throw new Error('Start a local race before advancing QA time')
      const input = inputForHandling({ steering: 0, throttle: 0, braking: false }, setup.handling)
      // RaceSession keeps its normal fixed physics tick and caps frame catch-up at 250 ms.
      for (let remaining = seconds; remaining > 0 && !raceSession.snapshot().result; remaining -= 0.25) {
        raceSession.advance(Math.min(0.25, remaining), input)
      }
    },
    snapshot: () => {
      const app = controller.snapshot()
      const race = raceSession.snapshot().state
      const player = race?.vehicles.find((vehicle) => vehicle.player)
      return {
        mode: app.mode,
        editor: {
          points: app.editor.points.length,
          trees: app.editor.trees.length,
          history: app.editor.history.length,
          gestureActive: app.editor.gestureStart !== null,
        },
        camera: sceneHost.editorCameraSnapshot(),
        controls: { ...raceControls.snapshot() },
        race: race
          ? {
              setup: raceSession.snapshot().setup,
              phase: race.phase,
              handling: race.handling,
              lighting: raceSession.snapshot().setup?.lighting,
              elapsed: race.elapsed,
              paused: race.paused,
              vehicleCount: race.vehicles.length,
              ghostVisible: Boolean(raceSession.snapshot().ghost),
              player: player
                ? {
                    speed: player.speed,
                    slip: player.slip,
                    x: player.x,
                    y: player.y,
                    lap: player.lap,
                    damage: player.damage,
                    wrecked: player.wrecked,
                    grounded: player.grounded,
                    surface: player.currentSurface,
                  }
                : null,
            }
          : null,
      }
    },
  }
}

const unlockAudio = (): void => {
  feedback.unlock()
  toneSink.resume()
  music.unlock()
}

export function enterGame(): void {
  unlockAudio()
  feedback.handle({ type: 'ui', emphasis: 'confirm' })
  document.addEventListener('pointerup', unlockAudio)
  document.addEventListener('keydown', unlockAudio)
}

function background(): void {
  if (raceSession.snapshot().setup?.mode === 'nearby' && !raceSession.snapshot().result) {
    controller.dispatch({ type: 'leave-nearby' })
  } else handleBackground(controller)
}

let nativePaused = false
function syncForeground(): void {
  const active = !document.hidden && !nativePaused
  sceneHost.setRacePreparationForeground(active)
  if (active) toneSink.resume()
  music.setForeground(active)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) background()
  syncForeground()
})

window.addEventListener('pagehide', () => {
  sceneHost.setRacePreparationForeground(false)
  music.setForeground(false)
  controller.flushPendingEditorSave()
})
window.addEventListener('pageshow', syncForeground)
window.addEventListener('trackforge:pause', () => {
  nativePaused = true
  syncForeground()
  background()
})
window.addEventListener('trackforge:resume', () => {
  nativePaused = false
  syncForeground()
})

window.addEventListener(
  'beforeunload',
  () => {
    stopSceneSync()
    controller.destroy()
    application.destroy()
    music.destroy()
    feedback.destroy()
  },
  { once: true },
)
