import { BrowserCupRepository } from '@/infrastructure/storage/cupRepository'
import { handleBackground } from '@/application/backgroundLifecycle'
import { audioVolumes, type AudioVolumeSetting } from '@/application/audioVolume'
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
import '@/styles/layout.css'
import { RaceSession } from '@/application/race/raceSession'
import { mathRandom } from '@/application/ports/random'
import { RaceInputController } from '@/phaser/input/raceInput'
import { FeedbackRouter } from '@/application/feedback/feedbackRouter'
import {
  BrowserToneSink,
  WebAudioAdapter,
} from '@/infrastructure/feedback/webAudioAdapter'
import { HapticsAdapter } from '@/infrastructure/feedback/hapticsAdapter'
import { BrowserMusicPlayer } from '@/infrastructure/feedback/musicPlayer'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import menuMusic from '@/assets/music/clubb-menu.mp3?url&no-inline'
import raceMusic from '@/assets/music/clubb-race.mp3?url&no-inline'

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
const initialPreferences = new BrowserPreferencesRepository(storage)
const toneSink = new BrowserToneSink()
const music = new BrowserMusicPlayer({ menu: menuMusic, race: raceMusic }, () => toneSink.audioContext)
const feedback = new FeedbackRouter({
  audio: new WebAudioAdapter(() => toneSink, true),
  haptics: new HapticsAdapter(
    navigator.vibrate?.bind(navigator),
    true,
  ),
})
const raceSession = new RaceSession({
  scoreStore,
  ghostStore: new BrowserGhostRepository(storage),
  random: mathRandom,
  feedback,
  geometry,
})
const raceControls = new RaceInputController()
const controller = new AppController({
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
  raceSession,
  raceControls,
  feedback,
  geometry,
  previewAudioVolume: setAudioVolume,
})
const sceneHost = new PhaserSceneHost(
  gameContainer,
  controller,
  raceSession,
  raceControls,
  geometry,
)
const application = createApplication({ sceneHost, uiHost })

function setAudioVolume(setting: AudioVolumeSetting, volume: number): void {
  if (setting === 'musicVolume') music.setVolume(volume / 100)
  else toneSink.setVolume(volume / 100)
}

function syncAudio(snapshot: ReturnType<typeof controller.snapshot>): void {
  const { musicVolume, soundEffectsVolume } = audioVolumes(snapshot.preferences)
  feedback.setChannels({ audio: soundEffectsVolume > 0, haptics: snapshot.preferences.hapticsEnabled })
  toneSink.setVolume(soundEffectsVolume / 100)
  const racing = snapshot.mode === 'race' && snapshot.overlay.type !== 'results' && snapshot.overlay.type !== 'cup-final'
  music.setTrack(snapshot.mode === 'home' ? 'menu' : racing ? 'race' : null)
  music.setVolume(musicVolume / 100)
}

const stopSceneSync = controller.subscribe((snapshot) => {
  sceneHost.start(snapshot.mode)
  syncAudio(snapshot)
})

music.setForeground(!document.hidden)
syncAudio(controller.snapshot())
application.start()

// QA telemetry is read-only and exists only in development builds explicitly
// opened with ?qa. Production APKs never expose this inspection surface.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa')) {
  const qaWindow = window as Window & {
    __trackForgeQa?: { snapshot: () => unknown }
  }
  qaWindow.__trackForgeQa = {
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
document.addEventListener('pointerup', unlockAudio)
document.addEventListener('keydown', unlockAudio)

let nativePaused = false
function syncAudioVisibility(): void {
  const active = !document.hidden && !nativePaused
  if (active) toneSink.resume()
  music.setForeground(active)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleBackground(controller)
  syncAudioVisibility()
})

window.addEventListener('pagehide', () => {
  music.setForeground(false)
  controller.flushPendingEditorSave()
})
window.addEventListener('pageshow', syncAudioVisibility)
window.addEventListener('trackforge:pause', () => {
  nativePaused = true
  syncAudioVisibility()
  handleBackground(controller)
})
window.addEventListener('trackforge:resume', () => {
  nativePaused = false
  syncAudioVisibility()
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
