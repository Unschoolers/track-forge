import { Capacitor, registerPlugin } from '@capacitor/core'
import { GitHubUpdateProvider, type UpdateInfo } from '@/application/updates/updateProvider'
import type { AppSnapshot } from '@/application/appState'
import { audioVolumes, type AudioVolumeSetting } from '@/application/audioVolume'
import { DIFFICULTY_IDS } from '@/domain/model'
import { DIFFICULTY_SPECS } from '@/domain/config'
import { createToggleRow } from '@/ui/components/toggleRow'
import { createVolumeRow } from '@/ui/components/volumeRow'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { DEFAULT_PLAYER_IDENTITY } from '@/application/multiplayer/playerIdentity'
import { createTopperSelector } from '@/ui/components/playerTopperPicker'

type DownloadState = { downloadId: number; version: string; downloaded: number; total: number; state: 'pending' | 'downloading' | 'paused' | 'complete' | 'failed' }
const updates = registerPlugin<{ download(options: { url: string; version: string }): Promise<{ downloadId: number }>; progress(options: { downloadId: number }): Promise<DownloadState>; current(): Promise<DownloadState | { state: 'none' }>; cancel(): Promise<void>; install(): Promise<{ state: 'permission-required' | 'installer-opened' }> }>('TrackForgeUpdates')

type OptionsTab = 'race' | 'audio' | 'controls' | 'display' | 'updates'
let selectedOptionsTab: OptionsTab = 'race'

interface OptionsNavigation {
  readonly initialTab?: 'updates' | undefined
  readonly availableUpdate?: UpdateInfo | null
}

export function createOptionsModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly preferences: (preferences: AppSnapshot['preferences']) => void
    readonly previewVolume: (setting: AudioVolumeSetting, volume: number) => void
    readonly setVolume: (setting: AudioVolumeSetting, volume: number) => void
  },
  navigation: OptionsNavigation = {},
): HTMLElement {
  const frame = createModalFrame(
    'Options',
    state.overlay.type === 'options' && state.overlay.returnTo === 'race'
      ? 'Comfort and feedback settings.'
      : 'Race, comfort, and feedback settings.',
    actions.close,
    'options-modal',
  )
  const tabSections = new Map<OptionsTab, HTMLElement>()
  const capture = (tab: OptionsTab, from: number) => {
    const section = element('section', 'options-tab-panel')
    section.dataset.optionsTab = tab
    section.append(...Array.from(frame.body.children).slice(from))
    tabSections.set(tab, section)
  }
  const raceStart = frame.body.children.length
  if (state.overlay.type !== 'options' || state.overlay.returnTo !== 'race') {
    const raceSettings = element('section', 'options-race-settings')
    const difficulty = element('section', 'setup-section')
    difficulty.append(element('h3', 'setup-label', 'AI DIFFICULTY'))
    const difficultyRow = element('div', 'choice-row')
    for (const id of DIFFICULTY_IDS) {
      const choice = button(
        DIFFICULTY_SPECS[id].name.toUpperCase(),
        `difficulty-${id}`,
        () =>
          actions.preferences({
            ...state.preferences,
            difficulty: id,
          }),
        `setup-choice${id === state.preferences.difficulty ? ' active' : ''}`,
      )
      choice.dataset.difficulty = id
      choice.setAttribute(
        'aria-pressed',
        String(id === state.preferences.difficulty),
      )
      difficultyRow.append(choice)
    }
    difficulty.append(
      difficultyRow,
      element(
        'p',
        'modal-subtitle',
        DIFFICULTY_SPECS[state.preferences.difficulty].description,
      ),
    )
    const handling = element('section', 'setup-section')
    handling.append(element('h3', 'setup-label', 'DRIVING STYLE'))
    const handlingRow = element('div', 'choice-row')
    for (const mode of ['arcade', 'simulation'] as const) {
      const selected = (state.preferences.handling ?? 'arcade') === mode
      const choice = button(
        mode.toUpperCase(),
        `handling-${mode}`,
        () => actions.preferences({ ...state.preferences, handling: mode }),
        `setup-choice${selected ? ' active' : ''}`,
      )
      choice.setAttribute('aria-pressed', String(selected))
      handlingRow.append(choice)
    }
    handling.append(
      handlingRow,
      element('p', 'modal-subtitle', 'Arcade accelerates automatically. Simulation: hold GAS or W / ↑ to accelerate. Focused pedals: hold Space or Enter.'),
    )
    const raceLength = element('section', 'setup-section')
    raceLength.append(element('h3', 'setup-label', 'RACE LENGTH'))
    const raceLengthRow = element('div', 'choice-row')
    const openRoute = state.overlay.type === 'options' && state.overlay.returnTo === 'race-setup' && state.currentTrack?.routeKind === 'point-to-point'
    for (const [laps, label] of [[1, 'SPRINT · 1 LAP'], [2, 'CLASSIC · 2'], [3, 'ENDURANCE · 3']] as const) {
      const selected = (state.preferences.raceLaps ?? 2) === laps
      const choice = button(
        label,
        `laps-${laps}`,
        () => actions.preferences({ ...state.preferences, raceLaps: laps }),
        `setup-choice${selected ? ' active' : ''}`,
      )
      choice.dataset.raceLaps = String(laps)
      choice.setAttribute('aria-pressed', String(selected))
      raceLengthRow.append(choice)
    }
    raceLength.append(...(openRoute ? [element('p', 'modal-subtitle', 'Single run · no laps')] : [raceLengthRow]))
    const topper = createTopperSelector(
      state.preferences.playerIdentity ?? DEFAULT_PLAYER_IDENTITY,
      true,
      undefined,
      (playerIdentity) => actions.preferences({ ...state.preferences, playerIdentity }),
      'options',
    )
    raceSettings.append(difficulty, raceLength, handling, topper)
    frame.body.append(raceSettings)
    capture('race', raceStart)
  }
  const audioStart = frame.body.children.length
  const volumes = audioVolumes(state.preferences)
  for (const [setting, label] of [['musicVolume', 'Music'], ['soundEffectsVolume', 'Sound Effects']] as const) {
    frame.body.append(createVolumeRow(
      label,
      setting,
      volumes[setting],
      (volume) => actions.previewVolume(setting, volume),
      (volume) => actions.setVolume(setting, volume),
    ))
  }
  capture('audio', audioStart)
  const displayStart = frame.body.children.length
  frame.body.append(
    createToggleRow(
      'Haptics',
      'Surface, curb, and collision vibration.',
      state.preferences.hapticsEnabled,
      'toggle-haptics',
      () =>
        actions.preferences({
          ...state.preferences,
          hapticsEnabled: !state.preferences.hapticsEnabled,
        }),
    ),
    createToggleRow(
      'Dynamic zoom',
      'Zoom in for curves and out on long straights.',
      state.preferences.dynamicZoomEnabled,
      'toggle-zoom',
      () =>
        actions.preferences({
          ...state.preferences,
          dynamicZoomEnabled:
            !state.preferences.dynamicZoomEnabled,
        }),
    ),
  )
  capture('display', displayStart)
  const controlsStart = frame.body.children.length
  const controlChoices = <K extends 'steeringLayout' | 'steeringHand' | 'controlSize'>(
    title: string, key: K, values: readonly NonNullable<AppSnapshot['preferences'][K]>[], fallback: NonNullable<AppSnapshot['preferences'][K]>,
  ): void => {
    const section = element('section', 'setup-section')
    section.append(element('h3', 'setup-label', title))
    const row = element('div', 'choice-row')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', title)
    for (const value of values) {
      const selected = (state.preferences[key] ?? fallback) === value
      const choice = button(value.toUpperCase(), `${key}-${value}`, () => actions.preferences({ ...state.preferences, [key]: value }), `setup-choice${selected ? ' active' : ''}`)
      choice.setAttribute('aria-pressed', String(selected))
      row.append(choice)
    }
    section.append(row)
    frame.body.append(section)
  }
  controlChoices('Steering layout', 'steeringLayout', ['drag', 'buttons'], 'drag')
  controlChoices('Steering hand', 'steeringHand', ['left', 'right'], 'left')
  controlChoices('Control size', 'controlSize', ['standard', 'large'], 'standard')
  const steering = element('section', 'setup-section')
  steering.append(element('h3', 'setup-label', 'Steering sensitivity'))
  const choices = element('div', 'choice-row')
  choices.setAttribute('role', 'group')
  choices.setAttribute('aria-label', 'Steering sensitivity')
  for (const [label, value] of [['Low', 0.75], ['Normal', 1], ['High', 1.5]] as const) {
    const selected = (state.preferences.steeringSensitivity ?? 1) === value
    const choice = button(
      label,
      `steering-sensitivity-${label.toLowerCase()}`,
      () => actions.preferences({ ...state.preferences, steeringSensitivity: value }),
      `setup-choice${selected ? ' active' : ''}`,
    )
    choice.setAttribute('aria-pressed', String(selected))
    choices.append(choice)
  }
  steering.append(choices)
  if ((state.preferences.steeringLayout ?? 'drag') === 'drag') frame.body.append(steering)
  capture('controls', controlsStart)
  const updatesStart = frame.body.children.length
  if (Capacitor.isNativePlatform()) {
    const currentRun = Number(import.meta.env.VITE_TRACKFORGE_BUILD_RUN)
    const currentAttempt = Number(import.meta.env.VITE_TRACKFORGE_BUILD_ATTEMPT)
    const hasBuildId = Number.isSafeInteger(currentRun) && currentRun > 0 &&
      Number.isSafeInteger(currentAttempt) && currentAttempt > 0
    const installed = element(
      'p',
      'modal-subtitle options-installed-build',
      hasBuildId ? `Installed build: ${currentRun}.${currentAttempt}` : 'Installed build: unavailable',
    )
    const status = element('p', 'modal-subtitle', 'Check GitHub Releases for a newer Android build.')
    let activeDownload: DownloadState | null = null
    const panel = element('section', 'setup-section options-download-panel')
    const progress = document.createElement('progress')
    progress.setAttribute('aria-label', 'APK download progress')
    progress.style.width = '100%'
    progress.max = 100
    const progressText = element('p', 'modal-subtitle', '')
    const install = button('INSTALL UPDATE', 'install-update', () => {
      install.disabled = true
      status.textContent = 'Preparing verified Android update…'
      void updates.install().then((result) => {
        status.textContent = result.state === 'permission-required'
          ? 'Allow installs from Track Forge in Android Settings, then return and tap INSTALL UPDATE again.'
          : 'Android installer requested. Confirm installation in the Android prompt.'
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not open installer.'
      }).finally(() => { install.disabled = false })
    }, 'button button-primary')
    const cancel = button('REMOVE DOWNLOAD', 'cancel-update', () => {
      cancel.disabled = true
      void updates.cancel().then(() => {
        stop()
        activeDownload = null
        panel.replaceChildren()
        status.textContent = 'Download removed.'
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not remove download.'
      }).finally(() => { cancel.disabled = false })
    }, 'button')
    let timer: number | undefined
    let polling = false
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
    }
    const render = (state: DownloadState) => {
      if (!panel.isConnected) { stop(); return }
      activeDownload = state
      const { downloaded, total } = state
      if (total > 0) {
        const percent = Math.min(100, Math.round(downloaded * 100 / total))
        progress.value = percent
        progressText.textContent = `${percent}% · ${(downloaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`
      } else {
        progress.removeAttribute('value')
        progressText.textContent = `${(downloaded / 1048576).toFixed(1)} MB downloaded`
      }
      status.textContent = `Update ${state.version}: ${state.state}`
      panel.replaceChildren(progress, progressText, ...(state.state === 'complete' ? [install] : []), cancel)
      if (state.state === 'complete') {
        stop()
        progress.value = 100
        progressText.textContent = 'Download complete. Ready to install.'
      } else if (state.state === 'failed') {
        stop()
        progressText.textContent = 'Download failed. Remove it to retry.'
      }
    }
    const refresh = async () => {
      if (polling || !panel.isConnected) return
      polling = true
      try {
        const state = await updates.current()
        if (state.state !== 'none') render(state as DownloadState)
        else { activeDownload = null; stop(); panel.replaceChildren() }
      } catch (error) {
        stop()
        status.textContent = error instanceof Error ? error.message : 'Could not read download status.'
      } finally { polling = false }
    }
    const monitor = () => {
      stop()
      void refresh()
      timer = window.setInterval(() => { void refresh() }, 1000)
    }
    const showAvailableUpdate = (update: UpdateInfo) => {
      if (activeDownload) {
        status.textContent = `New release: ${update.version}. Remove the existing download before downloading another.`
        return
      }
      status.textContent = `New version available: ${update.version}`
      const download = button('DOWNLOAD APK', 'download-update', () => {
        download.disabled = true
        status.textContent = 'Starting Android download…'
        void updates.download({ url: update.apkUrl, version: update.version }).then(() => {
          monitor()
        }).catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : 'Could not start download.'
          download.disabled = false
        })
      }, 'button')
      panel.replaceChildren(download)
    }
    const check = button('CHECK FOR UPDATES', 'check-updates', () => {
      check.disabled = true
      status.textContent = 'Checking for updates…'
      const provider = new GitHubUpdateProvider(
        currentRun,
        currentAttempt,
      )
      void provider.check().then((update) => {
        if (!update) {
          status.textContent = 'You are running the latest GitHub release.'
          if (!activeDownload) panel.replaceChildren()
          return
        }
        showAvailableUpdate(update)
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not check for updates.'
      }).finally(() => { check.disabled = false })
    }, 'button')
    frame.body.append(installed, check, status, panel)
    void updates.current().then((state) => {
      if (state.state !== 'none') {
        render(state as DownloadState)
        if (state.state !== 'complete' && state.state !== 'failed') monitor()
      } else if (navigation.availableUpdate) {
        showAvailableUpdate(navigation.availableUpdate)
      }
    }).catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : 'Could not restore download.'
    })
  }
  if (Capacitor.isNativePlatform()) capture('updates', updatesStart)
  const tabs = element('nav', 'choice-row options-tab-list')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Options categories')
  const available = Array.from(tabSections.keys())
  if (!available.includes(selectedOptionsTab)) selectedOptionsTab = available[0] ?? 'audio'
  const buttons = new Map<OptionsTab, HTMLButtonElement>()
  const tabScroll = new Map<OptionsTab, number>()
  const selectTab = (tab: OptionsTab) => {
    if (tabSections.has(selectedOptionsTab)) tabScroll.set(selectedOptionsTab, frame.body.scrollTop)
    selectedOptionsTab = tab
    for (const [key, panel] of tabSections) {
      const active = key === tab
      panel.hidden = !active
      panel.style.display = active ? '' : 'none'
      buttons.get(key)?.setAttribute('aria-selected', String(active))
      buttons.get(key)?.classList.toggle('active', active)
      buttons.get(key)?.setAttribute('tabindex', active ? '0' : '-1')
    }
    frame.body.scrollTop = tabScroll.get(tab) ?? 0
  }
  for (const tab of available) {
    const choice = button(tab.toUpperCase(), `options-tab-${tab}`, () => selectTab(tab), 'setup-choice')
    if (tab === 'display') choice.setAttribute('aria-label', 'Display and feedback')
    choice.setAttribute('role', 'tab')
    choice.setAttribute('aria-controls', `options-panel-${tab}`)
    choice.id = `options-tab-${tab}`
    const panel = tabSections.get(tab)!
    panel.id = `options-panel-${tab}`
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', choice.id)
    buttons.set(tab, choice)
    tabs.append(choice)
  }
  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = available.indexOf(selectedOptionsTab)
    const next = available[(index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) % available.length]
    if (!next) return
    selectTab(next)
    buttons.get(next)?.focus()
    event.preventDefault()
  })
  frame.body.before(tabs)
  for (const panel of tabSections.values()) frame.body.append(panel)
  selectTab(navigation.initialTab && available.includes(navigation.initialTab) ? navigation.initialTab : selectedOptionsTab)
  frame.footer.append(
    button('DONE', 'options-done', actions.close, 'button button-primary'),
  )
  return frame.overlay
}
