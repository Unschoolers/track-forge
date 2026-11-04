import { handleBackground } from '@/application/backgroundLifecycle'
import { createApplication } from '@/app/createApplication'
import { AppController, type Scheduler } from '@/application/appController'
import { asTrackId } from '@/domain/model'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { BrowserStorage } from '@/infrastructure/storage/browserStorage'
import { BrowserPreferencesRepository } from '@/infrastructure/storage/preferencesRepository'
import { BrowserScoreRepository } from '@/infrastructure/storage/scoreRepository'
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
import { TrackGeometryService } from '@/domain/track/trackGeometryService'

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
const feedback = new FeedbackRouter({
  audio: new WebAudioAdapter(() => new BrowserToneSink(), true),
  haptics: new HapticsAdapter(
    navigator.vibrate?.bind(navigator),
    true,
  ),
})
const preferences = initialPreferences.load()
feedback.setChannels({
  audio: preferences.audioEnabled,
  haptics: preferences.hapticsEnabled,
})
const raceSession = new RaceSession({
  scoreStore,
  random: mathRandom,
  feedback,
  geometry,
})
const raceControls = new RaceInputController()
const controller = new AppController({
  trackStore,
  scoreStore,
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
})
const sceneHost = new PhaserSceneHost(
  gameContainer,
  controller,
  raceSession,
  raceControls,
  geometry,
)
const application = createApplication({ sceneHost, uiHost })
const stopSceneSync = controller.subscribe((snapshot) =>
  {
    sceneHost.start(snapshot.mode)
    feedback.setChannels({
      audio: snapshot.preferences.audioEnabled,
      haptics: snapshot.preferences.hapticsEnabled,
    })
  },
)

application.start()

const unlockFeedback = (): void => feedback.unlock()
document.addEventListener('pointerdown', unlockFeedback, { once: true })
document.addEventListener('keydown', unlockFeedback, { once: true })

document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleBackground(controller)
})

window.addEventListener('pagehide', () => controller.flushPendingEditorSave())
window.addEventListener('trackforge:pause', () => handleBackground(controller))

window.addEventListener(
  'beforeunload',
  () => {
    stopSceneSync()
    controller.destroy()
    application.destroy()
    feedback.destroy()
  },
  { once: true },
)
