import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import type { AppSnapshot } from '@/application/appState'
import { courseIdentity, scoreCategoryLabel, timeMedal, nextMedalTarget } from '@/application/race/raceRecords'
import type { Track, TrackId } from '@/domain/model'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { validateTrack } from '@/domain/track/trackValidation'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { createTrackPreview } from '@/ui/modals/trackPreview'

export interface TrackLibraryActions {
  readonly share: (track: Track) => void
  readonly importFile: (content: string) => void
  readonly close: () => void
  readonly create: () => void
  readonly selectForEdit: (id: TrackId) => void
  readonly selectForRace: (id: TrackId) => void
  readonly delete: (track: Track) => void
}

export function createTrackLibraryModal(
  state: AppSnapshot,
  actions: TrackLibraryActions,
  geometry: TrackGeometryService,
): HTMLElement {
  if (state.overlay.type !== 'track-library') {
    throw new Error('Track library requires a track-library overlay')
  }
  const race = state.overlay.purpose === 'race'
  const frame = createModalFrame(
    race ? 'Choose a track' : 'Choose a track to edit',
    race
      ? 'Tap a circuit to choose your car.'
      : 'Select an existing named track or create a new one.',
    actions.close,
  )
  const list = element('div', 'track-list')
  if (race) list.append(element('h3', 'results-heading', 'SAVED TRACKS'))
  for (const track of state.tracks) {
    const path = geometry.get(track).path
    const validation = validateTrack(track, path.totalLength)
    const scores = state.scoresByTrack[track.id] ?? []
    const best = scores[0]
    const card = element(
      'article',
      `track-card${race ? '' : ' edit'}${track.id === state.currentTrack?.id ? ' selected' : ''}`,
    )
    const copy = element('span', 'track-card-copy')
    const meta = element(
      'span',
      'track-card-meta',
      `${validation.ready ? 'RACE READY' : 'NEEDS EDITING'} · BEST ${best ? `${formatRaceTime(best.time)} (${scoreCategoryLabel(best)}${best.category && best.category.course !== courseIdentity(track) ? ' · past layout' : ''})` : 'NO TIME'}`,
    )
    copy.append(
      element('strong', 'track-card-name', track.name),
      meta,
      createTrackPreview(path, track.points[0]),
    )
    if (race) {
      const select = button('', `select-race-${track.id}`, () => actions.selectForRace(track.id), 'track-card-select')
      select.setAttribute('aria-label', `Race ${track.name}`)
      meta.id = `race-track-status-${list.childElementCount}`
      select.setAttribute('aria-describedby', meta.id)
      select.disabled = !validation.ready
      select.append(copy)
      card.append(select)
    } else {
      card.append(copy)
    }
    const controls = element('div', 'track-card-actions')
    controls.append(shareButton(track, actions))
    if (!race) {
      controls.append(
        button('EDIT', `select-edit-${track.id}`, () => actions.selectForEdit(track.id), 'track-mini-button'),
        button('DELETE', `delete-${track.id}`, () => actions.delete(track), 'track-mini-button danger'),
      )
    }
    card.append(controls)
    list.append(card)
  }
  if (state.tracks.length === 0) {
    list.append(
      element('p', 'empty-state', 'No tracks saved yet.'),
    )
  }
  if (race) {
    list.append(element('h3', 'results-heading', 'OFFICIAL CIRCUITS'))
    for (const { track } of OFFICIAL_CIRCUITS) {
      const card = element('article', 'track-card')
      const select = button('', `select-race-${track.id}`, () => actions.selectForRace(track.id), 'track-card-select')
      select.setAttribute('aria-label', `Race ${track.name}`)
      const copy = element('span', 'track-card-copy')
      const medal = timeMedal(track, state.scoresByTrack[track.id] ?? [])
      const next = nextMedalTarget(track, medal)
      const meta = element('span', 'track-card-meta', `${medal ? `${medal.toUpperCase()} MEDAL` : 'NO TIME MEDAL'}${next ? ` · NEXT ${next.tier.toUpperCase()} ${formatRaceTime(next.time)}` : ' · ALL MEDALS EARNED'}`)
      meta.id = `race-track-status-${list.childElementCount}`
      select.setAttribute('aria-describedby', meta.id)
      copy.append(element('strong', 'track-card-name', track.name), meta, createTrackPreview(geometry.get(track).path))
      select.append(copy)
      card.append(select)
      list.append(card)
    }
  }
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.json,.trackforge.json,application/json'
  fileInput.hidden = true
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.item(0)
    if (!file) return
    if (file.size > 2_000_000) { actions.importFile(''); return }
    void file.text().then(actions.importFile).catch(() => actions.importFile(''))
    fileInput.value = ''
  })
  frame.body.append(list, fileInput)
  frame.footer.append(
    button('IMPORT TRACK', 'import-track-file', () => fileInput.click(), 'button'),
  )
  if (!race) {
    frame.footer.append(
      button(
        'NEW TRACK',
        'new-track',
        actions.create,
        'button',
      ),
    )
  }
  frame.footer.append(
    button('BACK', 'library-back', actions.close, 'button button-primary'),
  )
  return frame.overlay
}

function shareButton(track: Track, actions: TrackLibraryActions): HTMLButtonElement {
  const control = button('', `share-${track.id}`, () => actions.share(track), 'track-share-button')
  control.setAttribute('aria-label', `Share ${track.name}`)
  control.title = `Share ${track.name}`
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M12 16V3 M7 8l5-5 5 5 M5 13v7h14v-7')
  svg.append(path)
  control.append(svg)
  return control
}
