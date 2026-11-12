import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import type { AppSnapshot } from '@/application/appState'
import type { Track, TrackId } from '@/domain/model'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { validateTrack } from '@/domain/track/trackValidation'
import { button, element } from '@/ui/dom'
import { formatRaceTime } from '@/ui/format'
import { createModalFrame } from '@/ui/modals/modalFrame'

export interface TrackLibraryActions {
  readonly export: (track: Track) => void
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
      ? 'Select a race-ready circuit. Car and difficulty come next.'
      : 'Select an existing named track or create a new one.',
    actions.close,
  )
  const list = element('div', 'track-list')
  if (race) list.append(element('h3', 'results-heading', 'SAVED TRACKS'))
  for (const track of state.tracks) {
    const validation = validateTrack(
      track,
      geometry.get(track).path.totalLength,
    )
    const scores = state.scoresByTrack[track.id] ?? []
    const best = scores[0]
    const card = element(
      'article',
      `track-card${track.id === state.currentTrack?.id ? ' selected' : ''}`,
    )
    const copy = element('div', 'track-card-copy')
    copy.append(
      element('strong', 'track-card-name', track.name),
      element(
        'span',
        'track-card-meta',
        `${validation.ready ? 'RACE READY' : 'NEEDS EDITING'} · BEST ${best ? formatRaceTime(best.time) : 'NO TIME'}`,
      ),
    )
    const controls = element('div', 'track-card-actions')
    const select = button(
      race ? (validation.ready ? 'SELECT' : 'LOCKED') : 'EDIT',
      race ? `select-race-${track.id}` : `select-edit-${track.id}`,
      () =>
        race
          ? actions.selectForRace(track.id)
          : actions.selectForEdit(track.id),
      `track-mini-button${race && validation.ready ? ' primary' : ''}`,
    )
    if (race && !validation.ready) {
      select.disabled = true
      select.setAttribute('aria-disabled', 'true')
    }
    controls.append(
      select,
      button('SHARE', `share-${track.id}`, () => actions.share(track), 'track-mini-button'),
      button('EXPORT', `export-${track.id}`, () => actions.export(track), 'track-mini-button'),
    )
    if (!race) {
      controls.append(
        button(
          'DELETE',
          `delete-${track.id}`,
          () => actions.delete(track),
          'track-mini-button danger',
        ),
      )
    }
    card.append(copy, controls)
    list.append(card)
  }
  if (state.tracks.length === 0) {
    list.append(
      element('p', 'empty-state', 'No tracks saved yet.'),
    )
  }
  if (race) {
    list.append(element('h3', 'results-heading', 'OFFICIAL CIRCUITS'))
    for (const { track, target } of OFFICIAL_CIRCUITS) {
      const card = element('article', 'track-card')
      const copy = element('div', 'track-card-copy')
      copy.append(element('strong', 'track-card-name', track.name), element('span', 'track-card-meta', `ONE LAP TARGET ${formatRaceTime(target)}`))
      card.append(copy, button('SELECT', `select-race-${track.id}`, () => actions.selectForRace(track.id), 'track-mini-button primary'))
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
