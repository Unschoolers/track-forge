import { Capacitor, registerPlugin } from '@capacitor/core'
import { GitHubUpdateProvider, isNewerRelease, type UpdateInfo } from '@/application/updates/updateProvider'
import { isPortableWindows, downloadWindowsUpdate } from '@/infrastructure/updates/windowsPortableUpdate'
import { createReleaseNotesButton, openReleaseNotesView } from '@/ui/modals/updateReleaseNotes'
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
import { normalizeDisplayName } from '@/domain/track/trackCreator'

type DownloadState = { downloadId: number; version: string; downloaded: number; total: number; state: 'pending' | 'downloading' | 'paused' | 'complete' | 'failed' }
const updates = registerPlugin<{ download(options: { url: string; version: string }): Promise<{ downloadId: number }>; progress(options: { downloadId: number }): Promise<DownloadState>; current(): Promise<DownloadState | { state: 'none' }>; cancel(): Promise<void>; install(): Promise<{ state: 'permission-required' | 'installer-opened' }> }>('TrackForgeUpdates')

type OptionsTab = 'profile' | 'race' | 'audio' | 'controls' | 'display' | 'updates'
let selectedOptionsTab: OptionsTab = 'race'

const optionsTabPaths: Record<OptionsTab, string> = {
  profile: 'M20 21a8 8 0 0 0-16 0 M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  race: 'M5 21V4 M5 5c6-3 9 3 15 0v10c-6 3-9-3-15 0',
  audio: 'M11 5 6 9H3v6h3l5 4V5z M15 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12',
  controls: 'M7 8h10a5 5 0 0 1 4.8 3.6l1 4a3 3 0 0 1-4.8 3l-3-2H9l-3 2a3 3 0 0 1-4.8-3l1-4A5 5 0 0 1 7 8z M8 11v5 M5.5 13.5h5 M16 12h.01 M19 14h.01',
  display: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  updates: 'M12 3v12 m-5-5 5 5 5-5 M4 19h16',
}

function optionsTabIcon(tab: OptionsTab): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('options-tab-icon')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', optionsTabPaths[tab])
  svg.append(path)
  return svg
}

interface OptionsNavigation {
  readonly initialTab?: 'updates' | undefined
  readonly availableUpdate?: UpdateInfo | null
}

export function createOptionsModal(
  state: AppSnapshot,
  actions: {
    readonly close: () => void
    readonly playerName: (name: string) => void
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
  const profileStart = frame.body.children.length
  const profile = element('section', 'setup-section')
  profile.append(element('h3', 'setup-label', 'PLAYER NAME'))
  const form = element('form', 'name-form')
  const label = element('label', 'name-label', 'DISPLAY NAME')
  label.htmlFor = 'options-player-name'
  const input = element('input', 'name-input')
  input.id = 'options-player-name'
  input.name = 'player-name'
  input.autocomplete = 'off'
  input.maxLength = 24
  input.value = state.preferences.displayName ?? ''
  const error = element('div', 'name-error', '')
  error.setAttribute('role', 'alert')
  const submitName = () => {
    if (!normalizeDisplayName(input.value)) {
      error.textContent = 'Use 2–24 letters, numbers or simple punctuation.'
      return
    }
    actions.playerName(input.value)
  }
  const save = button('SAVE NAME', 'save-player-name', submitName, 'button button-primary')
  form.addEventListener('submit', (event) => { event.preventDefault(); submitName() })
  form.append(label, input, save, error)
  profile.append(form)
  frame.body.append(profile)
  const topper = createTopperSelector(
    state.preferences.playerIdentity ?? DEFAULT_PLAYER_IDENTITY,
    true,
    undefined,
    (playerIdentity) => actions.preferences({ ...state.preferences, playerIdentity }),
    'options',
  )
  topper.prepend(element('h3', 'setup-label', 'YOUR TOPPER'))
  frame.body.append(topper)
  capture('profile', profileStart)
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
    raceSettings.append(difficulty)
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
      'Surface and curb vibration.',
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
  const quality = element('section', 'setup-section')
  quality.append(element('h3', 'setup-label', 'GRAPHICS QUALITY'))
  const qualityRow = element('div', 'choice-row')
  qualityRow.setAttribute('role', 'group')
  qualityRow.setAttribute('aria-label', 'Graphics quality')
  for (const value of ['low', 'medium', 'high'] as const) {
    const selected = (state.preferences.graphicsQuality ?? 'medium') === value
    const choice = button(value.toUpperCase(), `graphics-quality-${value}`,
      () => actions.preferences({ ...state.preferences, graphicsQuality: value }),
      `setup-choice${selected ? ' active' : ''}`)
    choice.setAttribute('aria-pressed', String(selected))
    qualityRow.append(choice)
  }
  quality.append(qualityRow, element('p', 'modal-subtitle',
    'Low: 1× and opaque menus · Medium: up to 2× · High: native display resolution. Race resolution applies next race.'))
  frame.body.append(quality)
  capture('display', displayStart)
  const controlsStart = frame.body.children.length
  const controlChoices = <K extends 'steeringLayout' | 'steeringHand' | 'controlSize' | 'pedalMode'>(
    title: string, key: K, values: readonly NonNullable<AppSnapshot['preferences'][K]>[], fallback: NonNullable<AppSnapshot['preferences'][K]>,
  ): void => {
    const section = element('section', 'setup-section')
    section.append(element('h3', 'setup-label', title))
    const row = element('div', 'choice-row')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', title)
    for (const value of values) {
      const selected = (state.preferences[key] ?? fallback) === value
      const label = key === 'pedalMode' ? value === 'auto' ? 'AUTO-ACCELERATE' : 'MANUAL PEDALS' : value.toUpperCase()
      const choice = button(label, `${key}-${value}`, () => actions.preferences({ ...state.preferences, [key]: value }), `setup-choice${selected ? ' active' : ''}`)
      choice.setAttribute('aria-pressed', String(selected))
      row.append(choice)
    }
    section.append(row)
    frame.body.append(section)
  }
  controlChoices('Pedals', 'pedalMode', ['auto', 'manual'], 'auto')
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
    let notesTarget: string | null = null
    const notesButton = createReleaseNotesButton(() => {
      const target = notesTarget
      if (!target) return
      const provider = new GitHubUpdateProvider(currentRun, currentAttempt)
      openReleaseNotesView(frame.overlay, () => provider.changesSince(target), () => {
        if (activeDownload && activeDownload.state !== 'complete' && activeDownload.state !== 'failed') monitor()
      })
    })
    notesButton.hidden = true
    const setNotesTarget = (version: string | null) => {
      notesTarget = version && hasBuildId && isNewerRelease(version, currentRun, currentAttempt) ? version : null
      notesButton.hidden = notesTarget === null
    }
    const panel = element('section', 'setup-section options-download-panel')
    const progress = document.createElement('progress')
    progress.setAttribute('aria-label', 'APK download progress')
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
      setNotesTarget(state.version)
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
      const controls = [progress, progressText, ...(state.state === 'complete' ? [install] : []), cancel]
      // Polling changes values, not the identity of the optical controls.
      if (panel.children.length !== controls.length ||
          controls.some((control, index) => panel.children[index] !== control)) {
        panel.replaceChildren(...controls)
      }
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
      if (!activeDownload) setNotesTarget(update.version)
      if (activeDownload) {
        status.textContent = `New release: ${update.version}. Remove the existing download before downloading another.`
        return
      }
      status.textContent = `New version available: ${update.version}`
      const download = button('DOWNLOAD APK', 'download-update', () => {
        download.disabled = true
        status.textContent = 'Starting Android download…'
        if (!update.apkUrl) {
          status.textContent = 'The release has no verified Android APK.'
          download.disabled = false
          return
        }
        void updates.download({ url: update.apkUrl, version: update.version }).then(() => {
          monitor()
        }).catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : 'Could not start download.'
          download.disabled = false
        })
      }, 'button button-primary')
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
          if (!activeDownload) {
            panel.replaceChildren()
            setNotesTarget(null)
          }
          return
        }
        showAvailableUpdate(update)
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not check for updates.'
      }).finally(() => { check.disabled = false })
    }, 'button')
    const updateActions = element('div', 'options-update-actions')
    updateActions.append(check, notesButton)
    frame.body.append(installed, updateActions, status, panel)
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
  else if (isPortableWindows()) {
    const currentRun = Number(import.meta.env.VITE_TRACKFORGE_BUILD_RUN)
    const currentAttempt = Number(import.meta.env.VITE_TRACKFORGE_BUILD_ATTEMPT)
    const hasBuildId = Number.isSafeInteger(currentRun) && currentRun > 0 &&
      Number.isSafeInteger(currentAttempt) && currentAttempt > 0
    const provider = new GitHubUpdateProvider(currentRun, currentAttempt, undefined, 'windows')
    const installed = element('p', 'modal-subtitle options-installed-build',
      hasBuildId ? `Installed build: ${currentRun}.${currentAttempt}` : 'Installed build: unavailable')
    const status = element('p', 'modal-subtitle', 'Check GitHub Releases for a newer Windows EXE.')
    status.setAttribute('role', 'status')
    const panel = element('section', 'setup-section options-download-panel')
    const instructions = element('p', 'modal-subtitle',
      'Portable update: download the new EXE in your browser, close TrackForge, then replace the old file. No installer is required; your saved tracks stay in your Windows profile.')
    const notesButton = createReleaseNotesButton(() => {
      if (!notesTarget) return
      openReleaseNotesView(frame.overlay, () => provider.changesSince(notesTarget!))
    })
    let notesTarget: string | null = null
    notesButton.hidden = true
    const showAvailableUpdate = (release: UpdateInfo) => {
      if (!release.exeUrl) {
        panel.replaceChildren()
        status.textContent = 'The release has no verified Windows EXE.'
        return
      }
      notesTarget = hasBuildId && isNewerRelease(release.version, currentRun, currentAttempt) ? release.version : null
      notesButton.hidden = notesTarget === null
      status.textContent = `New Windows version available: ${release.version}`
      const download = button('DOWNLOAD NEW EXE', 'download-windows-update', () => {
        download.disabled = true
        status.textContent = 'Opening the Windows browser for download…'
        void downloadWindowsUpdate(release.version).then(() => {
          status.textContent = 'Download opened in your browser. Close TrackForge before replacing its EXE.'
        }).catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : 'Could not open the Windows browser.'
        }).finally(() => { download.disabled = false })
      }, 'button button-primary')
      panel.replaceChildren(download, instructions)
    }
    const check = button('CHECK FOR UPDATES', 'check-updates', () => {
      check.disabled = true
      status.textContent = 'Checking for updates…'
      void provider.check().then((release) => {
        if (release) showAvailableUpdate(release)
        else {
          status.textContent = 'You are running the latest GitHub release.'
          panel.replaceChildren()
          notesTarget = null
          notesButton.hidden = true
        }
      }).catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not check for updates.'
      }).finally(() => { check.disabled = false })
    }, 'button')
    const actionsRow = element('div', 'options-update-actions')
    actionsRow.append(check, notesButton)
    frame.body.append(installed, actionsRow, status, panel)
    if (navigation.availableUpdate) showAvailableUpdate(navigation.availableUpdate)
  }
  if (Capacitor.isNativePlatform() || isPortableWindows()) capture('updates', updatesStart)
  const tabs = element('nav', 'choice-row options-tab-list')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Options categories')
  const available = Array.from(tabSections.keys())
  tabs.style.setProperty('--options-tab-count', String(available.length))
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
    const choice = button('', `options-tab-${tab}`, () => selectTab(tab), 'setup-choice')
    choice.append(optionsTabIcon(tab), element('span', 'options-tab-label', tab[0]!.toUpperCase() + tab.slice(1)))
    choice.setAttribute('aria-label', tab === 'display' ? 'Display and feedback' : tab)
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
