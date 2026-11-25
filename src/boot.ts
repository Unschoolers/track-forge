const title = document.querySelector<HTMLElement>('#title-screen')
const app = document.querySelector<HTMLElement>('#app')
const loadingStatus = document.querySelector<HTMLElement>('#title-status')
const start = document.querySelector<HTMLButtonElement>('#title-start')
if (!title || !app || !loadingStatus || !start) {
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
  start.textContent = 'Try again'
  start.hidden = false
  start.focus({ preventScroll: true })
}

// The startup art stays available even if the game bundle cannot load.
const timeout = window.setTimeout(showRetry, 30_000)
try {
  const { loadEnvironmentBitmapArt } = await import('./presentation/environments/meadowBitmapArt')
  const { loadSceneryBitmapArt } = await import('./presentation/environments/sceneryBitmapArt')
  await Promise.all([loadEnvironmentBitmapArt(), loadSceneryBitmapArt()])
  const game = await import('./main')
  await game.gameReady
  enterGame = game.enterGame
  title.dataset.state = 'ready'
  loadingStatus.hidden = true
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
