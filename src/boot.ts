const title = document.querySelector<HTMLElement>('#title-screen')
const app = document.querySelector<HTMLElement>('#app')
const loadingStatus = document.querySelector<HTMLElement>('#title-status')
const start = document.querySelector<HTMLButtonElement>('#title-start')
const progress = document.querySelector<HTMLProgressElement>('#title-progress')
if (!title || !app || !loadingStatus || !start || !progress) {
  throw new Error('Track Forge requires its title screen and app mount point')
}

let enterGame: (() => void) | undefined

start.addEventListener('click', () => {
  if (!enterGame) {
    window.location.reload()
    return
  }

  title.inert = true
  title.classList.add('title-screen--leaving')
  app.inert = false
  app.querySelector<HTMLElement>('[data-action="race"]')?.focus({ preventScroll: true })

  const transitions = title.getAnimations().map((animation) => animation.finished)
  void Promise.allSettled(transitions).then(() => title.remove())
  enterGame()
}, { once: true })

const showRetry = () => {
  title.dataset.state = 'error'
  loadingStatus.textContent = 'Track Forge couldn’t load.'
  progress.hidden = true
  start.textContent = 'Try again'
  start.hidden = false
  start.focus({ preventScroll: true })
}

// The startup art stays available even if the game bundle cannot load.
let timeout = window.setTimeout(showRetry, 30_000)
const report = (percent: number, phase: string) => {
  if (title.dataset.state !== 'loading') return
  const value = Math.max(Number(progress.value), Math.min(100, Math.floor(percent)))
  progress.value = value
  loadingStatus.textContent = `${phase} · ${value}%`
  window.clearTimeout(timeout)
  timeout = window.setTimeout(showRetry, 30_000)
}
report(0, 'Loading Track Forge')
try {
  const [{ loadEnvironmentBitmapArt }, { loadSceneryBitmapArt }, { loadVehicleBitmapArt }] = await Promise.all([
    import('./presentation/environments/meadowBitmapArt'),
    import('./presentation/environments/sceneryBitmapArt'),
    import('./presentation/vehicleBitmapArt'),
  ])
  const { finishStartupArtwork } = await import('./startupArtworkGate')
  let loadedArtwork = 0
  const artworkReady = Promise.all([loadEnvironmentBitmapArt(), loadSceneryBitmapArt(), loadVehicleBitmapArt()].map(async task => {
    await task
    report(++loadedArtwork * 10, 'Loading artwork')
  }))
  void artworkReady.then(
    () => finishStartupArtwork({ ok: true }),
    error => finishStartupArtwork({ ok: false, error }),
  )
  const [game] = await Promise.all([import('./main'), artworkReady])
  report(40, 'Starting renderer')
  await game.gameReady
  await game.prepareStartupRace(fraction => report(50 + fraction * 50, 'Preparing circuit textures'))
  if (title.dataset.state !== 'loading') throw new Error('Startup exceeded its progress deadline')
  enterGame = game.enterGame
  title.dataset.state = 'ready'
  loadingStatus.hidden = true
  progress.hidden = true
  start.textContent = 'Tap to start'
  start.hidden = false
  start.focus({ preventScroll: true, focusVisible: false })
} catch (error) {
  console.error('Track Forge startup failed', error)
  showRetry()
} finally {
  window.clearTimeout(timeout)
}

export {}
