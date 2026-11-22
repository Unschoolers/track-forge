import { OFFICIAL_CIRCUITS } from '@/domain/track/officialCircuits'
import { isSeededTrack } from '@/domain/track/trackCreator'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { AppSnapshot } from '@/application/appState'
import { timeMedal } from '@/application/race/raceRecords'
import type { Track, TrackId } from '@/domain/model'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { validateTrack } from '@/domain/track/trackValidation'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { createTrackPreview } from '@/ui/modals/trackPreview'

export interface TrackLibraryActions {
  readonly share: (track: Track) => void
  readonly sendNearby?: (track: Track) => void
  readonly importFile: (content: string) => void
  readonly close: () => void
  readonly create: () => void
  readonly selectForEdit: (id: TrackId) => void
  readonly selectForRace: (id: TrackId) => void
  readonly toggleFavorite: (id: TrackId) => void
  readonly delete: (track: Track) => void
}

const ENVIRONMENT_NAMES = {
  grass: 'Grass',
  cityscape: 'City',
  desert: 'Desert',
} as const

/** Favorites float above recently edited tracks without changing persisted edit dates. */
export function orderLibraryTracks(tracks: readonly Track[], favoriteIds: readonly string[] = []): readonly Track[] {
  const favorites = new Set(favoriteIds)
  return [...tracks].sort((a, b) =>
    Number(favorites.has(b.id)) - Number(favorites.has(a.id)) ||
    b.updatedAt - a.updatedAt ||
    a.name.localeCompare(b.name),
  )
}

export function createTrackLibraryModal(
  state: AppSnapshot,
  actions: TrackLibraryActions,
  geometry: TrackGeometryService,
): HTMLElement {
  if (state.overlay.type !== 'track-library') {
    throw new Error('Track library requires a track-library overlay')
  }
  const race = state.overlay.purpose !== 'edit'
  const nearbySelection = state.overlay.purpose === 'nearby'
  const nearbyHosting = state.overlay.purpose === 'nearby-host'
  const cupSelection = state.overlay.purpose === 'cup'
  const choosingNearby = nearbySelection || nearbyHosting
  const frame = createModalFrame(
    cupSelection ? 'Add Cup track' : nearbyHosting ? 'Choose a track to host' : nearbySelection ? 'Choose the next track' : race ? 'Choose a track' : 'Track garage',
    cupSelection ? 'Choose a track to add to your Cup.' : nearbyHosting ? 'Select a circuit to open your nearby room.'
      : nearbySelection ? 'Pick a track for everyone in the room.'
        : race ? 'Choose a circuit to race.'
          : 'Tap a track to edit. Star your favorites.',
    actions.close,
    'track-library-modal',
  )
  const favorites = new Set(state.preferences.favoriteTrackIds ?? [])
  const list = element('div', 'track-list')

  const cardFor = (track: Track, official = false): HTMLElement => {
    const path = geometry.get(track).path
    const validation = validateTrack(track, path.totalLength)
    const card = element('article', `track-card${race ? '' : ' edit'}${track.id === state.currentTrack?.id ? ' selected' : ''}`)
    const select = button('', race ? `select-race-${track.id}` : `select-edit-${track.id}`,
      () => race ? actions.selectForRace(track.id) : actions.selectForEdit(track.id), 'track-card-select')
    select.setAttribute('aria-label', `${race ? cupSelection ? 'Add' : nearbyHosting ? 'Host' : 'Race' : 'Edit'} ${track.name}`)
    select.disabled = race && !validation.ready

    const copy = element('span', 'track-card-copy')
    copy.append(createTrackPreview(path, track.points[0], track.environmentId), element('strong', 'track-card-name', track.name))
    const creator = element('span', 'track-card-creator')
    const environment = normalizeTrackEnvironmentId(track.environmentId)
    const dot = element('span', 'track-environment-dot')
    dot.dataset.environment = environment
    dot.setAttribute('title', ENVIRONMENT_NAMES[environment])
    dot.setAttribute('aria-label', `${ENVIRONMENT_NAMES[environment]} environment`)
    creator.append(dot, element('span', 'track-creator-name', track.creator?.name ?? (official ? 'Track Forge' : 'Unknown creator')))
    copy.append(creator)
    if (race && !validation.ready) {
      const status = element('span', 'track-card-unavailable', 'Needs editing')
      status.id = `track-status-${track.id}`
      select.setAttribute('aria-describedby', status.id)
      copy.append(status)
    } else if (race && official) {
      const medal = timeMedal(track, state.scoresByTrack[track.id] ?? [])
      if (medal) copy.append(element('span', 'track-card-medal', `${medal.toUpperCase()} MEDAL`))
    }
    select.append(copy)
    card.append(select)

    const favorite = button(favorites.has(track.id) ? '★' : '☆', `favorite-${track.id}`, () => actions.toggleFavorite(track.id), 'track-card-favorite')
    favorite.setAttribute('aria-label', `${favorites.has(track.id) ? 'Remove' : 'Add'} ${track.name} ${favorites.has(track.id) ? 'from' : 'to'} favorites`)
    favorite.setAttribute('aria-pressed', String(favorites.has(track.id)))
    favorite.title = favorites.has(track.id) ? 'Remove favorite' : 'Add favorite'
    card.append(favorite)

    if (!official && !choosingNearby) {
      const options = element('details', 'track-card-overflow')
      const trigger = element('summary', 'track-menu-trigger', '⋯')
      trigger.setAttribute('aria-label', `More actions for ${track.name}`)
      trigger.title = `More actions for ${track.name}`
      const menu = element('div', 'track-card-menu')
      if (!isSeededTrack(track)) {
        const share = iconAction('SHARE', 'share', `share-${track.id}`, () => actions.share(track))
        share.setAttribute('aria-label', `Share ${track.name}`)
        menu.append(share)
        if (actions.sendNearby) {
          const nearby = iconAction('NEARBY', 'nearby', `send-nearby-${track.id}`, () => actions.sendNearby?.(track))
          nearby.setAttribute('aria-label', `Send ${track.name} nearby`)
          menu.append(nearby)
        }
      }
      if (!race) {
        const remove = iconAction('DELETE', 'delete', `delete-${track.id}`, () => actions.delete(track), 'danger')
        remove.setAttribute('aria-label', `Delete ${track.name}`)
        menu.append(remove)
      }
      if (menu.childElementCount) {
        options.append(trigger, menu)
        card.append(options)
      }
    }
    return card
  }

  // A favorite official circuit ranks above non-favorite saved tracks as well.
  const officialIds = new Set(OFFICIAL_CIRCUITS.map(({ track }) => track.id))
  const libraryTracks = race
    ? [...state.tracks, ...OFFICIAL_CIRCUITS.map(({ track }) => track)]
    : state.tracks
  for (const track of orderLibraryTracks(libraryTracks, state.preferences.favoriteTrackIds)) {
    list.append(cardFor(track, officialIds.has(track.id)))
  }
  if (libraryTracks.length === 0) list.append(element('p', 'empty-state', 'No tracks saved yet.'))

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
  if (!race) {
    frame.footer.append(
      button('IMPORT', 'import-track-file', () => fileInput.click(), 'button'),
      button('＋ NEW TRACK', 'new-track', actions.create, 'button button-primary'),
    )
  } else {
    frame.footer.append(
      button('IMPORT', 'import-track-file', () => fileInput.click(), 'button'),
      button('BACK', 'library-back', actions.close, 'button button-primary'),
    )
  }
  return frame.overlay
}

type TrackActionIcon = 'share' | 'nearby' | 'delete'
const actionPaths: Record<TrackActionIcon, string> = {
  share: 'M12 16V3 M7 8l5-5 5 5 M5 13v7h14v-7',
  nearby: 'M5 18v-4 M10 18v-7 M15 18V8 M20 18V5',
  delete: 'M4 7h16 M10 4h4 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',
}

function iconAction(label: string, icon: TrackActionIcon, action: string, invoke: () => void, variant = ''): HTMLButtonElement {
  const control = button('', action, invoke, `track-mini-button track-icon-action ${variant}`.trim())
  control.setAttribute('aria-label', label)
  control.title = label
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', actionPaths[icon])
  svg.append(path)
  control.append(svg, element('span', undefined, label))
  return control
}
