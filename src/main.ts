import { Capacitor } from '@capacitor/core'
import { GitHubUpdateProvider } from '@/application/updates/updateProvider'
import { isPortableWindows } from '@/infrastructure/updates/windowsPortableUpdate'
import { NearbyRace } from '@/application/multiplayer/nearbyRace'
import { serializeSharedTrack } from '@/infrastructure/export/trackExport'
import { createAndroidNearby } from '@/infrastructure/multiplayer/androidNearby'
import { createLanNearby } from '@/infrastructure/multiplayer/lanNearby'
import { selectNearbyConnection } from '@/infrastructure/multiplayer/selectNearbyConnection'
import { validateTrack } from '@/domain/track/trackValidation'
import { BrowserCupRepository } from '@/infrastructure/storage/cupRepository'
import { handleBackground } from '@/application/backgroundLifecycle'
import { handleAndroidBack } from '@/application/androidBackNavigation'
import { audioVolumes, musicGain, type AudioVolumeSetting } from '@/application/audioVolume'
import { createApplication } from '@/app/createApplication'
import { AppController } from '@/application/appController'
import { SYSTEM_STARTER_TRACK_ID } from '@/domain/track/trackCreator'
import { isUntouchedLegacyStarter } from '@/migrations/legacyStarterIdentity'
// TEMPORARY one-time release migration: delete this import and startup call together.
import { migrateTrackCreatorCredits } from '@/migrations/migration_track_creator_v1'
import { BrowserStorage } from '@/infrastructure/storage/browserStorage'
import { BrowserPreferencesRepository } from '@/infrastructure/storage/preferencesRepository'
import { BrowserLastRaceRepository } from '@/infrastructure/storage/lastRaceRepository'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
import { BrowserGhostRepository } from '@/infrastructure/storage/ghostRepository'
import { IndexedDbTrackRepository } from '@/infrastructure/storage/indexedDbTrackRepository'
import { PhaserSceneHost } from '@/phaser/sceneHost'
import { DomUiHost } from '@/ui/uiHost'
import { RaceFrameDiagnostics } from '@/infrastructure/qa/raceFrameDiagnostics'
import { installRacePerformance } from '@/infrastructure/qa/racePerformance'
import '@/styles/layout.css'
import '@/styles/home-menu.css'
import '@/styles/menu-dialogs.css'
import '@/styles/race-menus.css'
import '@/styles/editor-menus.css'
import '@/styles/cup-glass.css'
import '@/styles/nearby-glass.css'
import '@/styles/race-overlay-glass.css'
import '@/styles/editor-dialog-glass.css'
import { RaceSession } from '@/application/race/raceSession'
import { cupTrackIds } from '@/application/race/circuitCup'
import { OFFICIAL_COURSES } from '@/domain/track/officialCircuits'
import { mathRandom } from '@/infrastructure/random/mathRandom'
import { startupArtworkReady } from './startupArtworkGate'
import { inputForPedals, RaceInputController } from '@/phaser/input/raceInput'
import { FeedbackRouter } from '@/application/feedback/feedbackRouter'
import {
  BrowserToneSink,
  WebAudioAdapter,
} from '@/infrastructure/feedback/webAudioAdapter'
import { HapticsAdapter } from '@/infrastructure/feedback/hapticsAdapter'
import { BrowserMusicPlayer } from '@/infrastructure/feedback/musicPlayer'
import { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { normalizeTrackEnvironmentId, type TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import cityMusic from '@/assets/music/cityscape-race.mp3?url&no-inline'
import desertMusic from '@/assets/music/desert-race.mp3?url&no-inline'
import menuMusic from '@/assets/music/main-menu.mp3?url&no-inline'
import grassMusic from '@/assets/music/grass-race.mp3?url&no-inline'
import kidsRoomMusic from '@/assets/music/kids-room-race.mp3?url&no-inline'

const appRoot = document.querySelector<HTMLElement>('#app')
if (!appRoot) throw new Error('TrackForge requires an #app mount point')

const gameContainer = document.createElement('div')
gameContainer.id = 'game-container'
const uiRoot = document.createElement('div')
uiRoot.id = 'ui-root'
appRoot.replaceChildren(gameContainer, uiRoot)

const storage = new BrowserStorage()
const trackStore = await IndexedDbTrackRepository.open()
// Retire untouched system copies only. Never erase changed art or track data.
for (const track of trackStore.list()) {
  if (isUntouchedLegacyStarter(track) &&
      (track.origin === 'seeded' || track.id === SYSTEM_STARTER_TRACK_ID ||
       (!track.origin && !track.creator && track.id.startsWith('starter-')))) {
    if (!await trackStore.remove(track.id)) console.error('Could not remove the retired starter circuit.')
  }
}

const scoreStore = new BrowserScoreRepository(storage)
const geometry = new TrackGeometryService()
const nearbyConnection = selectNearbyConnection(createAndroidNearby(), createLanNearby())
const nearbyTransport = nearbyConnection.transport
const nearby = nearbyTransport && new NearbyRace(nearbyTransport,
  (track) => validateTrack(track, geometry.get(track).path.totalLength).ready, undefined, serializeSharedTrack)
const initialPreferences = new BrowserPreferencesRepository(storage)
// TEMPORARY one-time migration: safe to remove with its isolated module.
if (!(await migrateTrackCreatorCredits(storage, trackStore, initialPreferences)).ok) {
  console.error('Track creator migration could not be persisted. It will be retried on the next launch.')
}
const toneSink = new BrowserToneSink()
const music = new BrowserMusicPlayer<'menu' | TrackEnvironmentId>({
  menu: menuMusic,
  grass: grassMusic,
  cityscape: cityMusic,
  desert: desertMusic,
  'kids-room': kidsRoomMusic,
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
  raceSession,
  geometry,
})
const frameDiagnostics = new RaceFrameDiagnostics()
const supportsLongTasks = typeof PerformanceObserver !== 'undefined' &&
  PerformanceObserver.supportedEntryTypes?.includes('longtask')
const longTaskObserver = supportsLongTasks ? new PerformanceObserver(list => {
  for (const entry of list.getEntries()) frameDiagnostics.recordLongTask(entry.startTime, entry.duration)
}) : undefined
longTaskObserver?.observe({ entryTypes: ['longtask'] })
const uiHost = new DomUiHost(uiRoot, controller, {
  nearby,
  ...(nearbyConnection.modes ? { nearbyConnections: nearbyConnection.modes } : {}),
  raceSession,
  raceControls,
  feedback,
  frameDiagnostics: () => ({
    timings: frameDiagnostics.report(raceSession.snapshot().runId),
    device: {
      userAgent: navigator.userAgent,
      pixelRatio: window.devicePixelRatio,
      buildRun: import.meta.env.VITE_TRACKFORGE_BUILD_RUN ?? null,
      buildAttempt: import.meta.env.VITE_TRACKFORGE_BUILD_ATTEMPT ?? null,
      longTaskSupported: Boolean(supportsLongTasks),
      viewport: [window.innerWidth, window.innerHeight],
    },
  }),
  geometry,
  prepareRace: (track, trackGeometry, lighting) => sceneHost.prepareRace(track, trackGeometry, lighting),
  previewAudioVolume: setAudioVolume,
  ...(Capacitor.isNativePlatform() || isPortableWindows() ? { updateProvider: new GitHubUpdateProvider(
    Number(import.meta.env.VITE_TRACKFORGE_BUILD_RUN),
    Number(import.meta.env.VITE_TRACKFORGE_BUILD_ATTEMPT),
    undefined,
    isPortableWindows() ? 'windows' : 'android',
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
  frameDiagnostics,
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
  const cupTrackId = cupFinal && snapshot.cup ? cupTrackIds(snapshot.cup)[snapshot.cup.index] : undefined
  const track = cupTrackId
    ? snapshot.tracks.find(track => track.id === cupTrackId) ??
      OFFICIAL_COURSES.find(({ track }) => track.id === cupTrackId)?.track
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
await startupArtworkReady
application.start()

// Android sends system Back through this cancelable event. When game navigation
// handles it, preventDefault suppresses the native exit confirmation.
const onAndroidBack = (event: Event): void => {
  if (handleAndroidBack(controller.snapshot(), (command) => controller.dispatch(command))) {
    event.preventDefault()
  }
}
if (Capacitor.isNativePlatform()) {
  window.addEventListener('trackforge:android-back', onAndroidBack)
}
// No online account exists yet: the first local launch establishes a persistent
// player display name, reused when creating or crediting tracks.
if (!controller.snapshot().preferences.displayName) {
  controller.dispatch({ type: 'open-player-name' })
}
export const gameReady = sceneHost.whenReady()
// Render the controls before a scene uses their bounds to fit the camera.
const stopSceneSync = controller.subscribe((snapshot) => {
  sceneHost.start(snapshot.mode)
  syncAudio(snapshot)
})

// The QA bridge exists only on the Vite dev server with ?qa.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('qa')) {
  const qaWindow = window as Window & {
    __trackForgeQa?: {
      snapshot: () => unknown
      advanceRace: (seconds: number) => void
      pauseRace: () => void
      resumeRace: () => void
    }
  }
  qaWindow.__trackForgeQa = {
    pauseRace: () => raceSession.setPaused(true),
    resumeRace: () => raceSession.setPaused(false),
    advanceRace: (seconds) => {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 20) throw new Error('Invalid QA race interval')
      const { setup } = raceSession.snapshot()
      if (!setup || setup.mode === 'nearby') throw new Error('Start a local race before advancing QA time')
      const input = inputForPedals({ steering: 0, throttle: 0, braking: false }, controller.snapshot().preferences.pedalMode)
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
          // QA-only draft content: inspect edits without implicitly saving them.
          controlPoints: app.editor.points,
          scenery: app.editor.scenery,
          recoveryCheckpoints: app.editor.recoveryCheckpoints,
          environmentId: app.editor.environmentId,
        },
        camera: sceneHost.editorCameraSnapshot(),
        controls: { ...raceControls.snapshot() },
        race: race
          ? {
              setup: raceSession.snapshot().setup,
              phase: race.phase,
              lighting: raceSession.snapshot().setup?.lighting,
              elapsed: race.elapsed,
              paused: race.paused,
              vehicleCount: race.vehicles.length,
              ghostVisible: Boolean(raceSession.snapshot().ghost),
              vehicles: race.vehicles.map((vehicle) => ({
                car: vehicle.car, player: vehicle.player, x: vehicle.x, y: vehicle.y,
                z: vehicle.z, structureRunId: vehicle.structureRunId,
              })),
              player: player
                ? {
                    speed: player.speed,
                    slip: player.slip,
                    x: player.x,
                    y: player.y,
                    lap: player.lap,
                    grounded: player.grounded,
                    z: player.z,
                    pathIndex: player.pathIndex,
                    structureRunId: player.structureRunId,
                    angle: player.angle,
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
    window.removeEventListener('trackforge:android-back', onAndroidBack)
    stopSceneSync()
    controller.destroy()
    application.destroy()
    music.destroy()
    feedback.destroy()
    longTaskObserver?.disconnect()
  },
  { once: true },
)
