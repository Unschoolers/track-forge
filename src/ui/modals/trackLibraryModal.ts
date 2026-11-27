import { OFFICIAL_COURSES } from '@/domain/track/officialCircuits'
import { isSeededTrack } from '@/domain/track/trackCreator'
import { isSharedTrack } from '@/domain/track/trackAccess'
import { normalizeTrackEnvironmentId } from '@/domain/track/trackEnvironment'
import type { AppSnapshot } from '@/application/appState'
import { timeMedal } from '@/application/race/raceRecords'
import type { Track, TrackId } from '@/domain/model'
import type { TrackGeometryService } from '@/domain/track/trackGeometryService'
import { validateTrack } from '@/domain/track/trackValidation'
import { button, element } from '@/ui/dom'
import { createModalFrame } from '@/ui/modals/modalFrame'
import { iconAction } from '@/ui/components/trackActionButton'
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

export interface TrackLibraryViewState {
  readonly searchQuery: string
  readonly searchOpen?: boolean
  readonly filter: 'all' | 'favorites'
}

// Built-in tracks are immutable; reuse identity collections on each library redraw.
const OFFICIAL_TRACKS = OFFICIAL_COURSES.map(({ track }) => track)
const OFFICIAL_TRACK_IDS = new Set(OFFICIAL_TRACKS.map(track => track.id))

const ENVIRONMENT_NAMES = {
  grass: 'Grass',
  cityscape: 'City',
  desert: 'Desert',
  'kids-room': "Kids' Room",
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
  initialViewState?: TrackLibraryViewState,
): HTMLElement {
  if (state.overlay.type !== 'track-library') {
    throw new Error('Track library requires a track-library overlay')
  }
  const race = state.overlay.purpose !== 'edit'
  const racePicker = state.overlay.purpose === 'race'
  const nearbySelection = state.overlay.purpose === 'nearby'
  const nearbyHosting = state.overlay.purpose === 'nearby-host'
  const cupSelection = state.overlay.purpose === 'cup'
  const choosingNearby = nearbySelection || nearbyHosting
  const frame = createModalFrame(
    cupSelection ? 'Add Cup track' : nearbyHosting ? 'Choose a track to host' : nearbySelection ? 'Choose the next track' : race ? 'Choose a track' : 'Track garage',
    cupSelection ? 'Choose a track to add to your Cup.' : nearbyHosting ? 'Select a circuit to open your nearby room.'
      : nearbySelection ? 'Pick a track for everyone in the room.'
        : race ? 'Choose a circuit to race.'
          : 'Tap a track to open it. Star your favorites.',
    actions.close,
    'track-library-modal',
  )
  frame.overlay.dataset.graphicsQuality = state.preferences.graphicsQuality ?? 'medium'
  const favorites = new Set(state.preferences.favoriteTrackIds ?? [])
  const libraryContent = element('div', 'track-library-content')
  const toolbar = element('div', 'track-library-toolbar')
  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'track-library-search'
  search.placeholder = 'Search circuits or creators'
  search.setAttribute('aria-label', 'Search tracks')
  search.value = initialViewState?.searchQuery ?? ''
  search.id = 'track-library-search'
  search.dataset.action = 'library-search-input'
  search.hidden = !(initialViewState?.searchOpen || search.value)
  const searchToggle = iconAction('Search circuits', 'search', 'library-search-toggle', () => setSearchOpen(search.hidden), 'track-library-search-toggle')
  searchToggle.setAttribute('aria-controls', search.id)
  const updateSearchToggle = () => {
    const label = search.hidden ? 'Search circuits' : 'Close search'
    searchToggle.setAttribute('aria-expanded', String(!search.hidden))
    searchToggle.setAttribute('aria-label', label)
    searchToggle.title = label
  }
  const setSearchOpen = (open: boolean) => {
    search.hidden = !open
    updateSearchToggle()
    if (open) search.focus()
    else {
      search.value = ''
      renderTracks()
      searchToggle.focus()
    }
  }
  updateSearchToggle()
  const filter = element('div', 'track-library-filter')
  filter.setAttribute('role', 'group')
  filter.setAttribute('aria-label', 'Filter circuits')
  const initialFilter = initialViewState?.filter ?? 'all'
  const allFilter = button('All circuits', 'library-filter-all', () => setFilter('all'), `track-library-filter-button${initialFilter === 'all' ? ' active' : ''}`)
  const favoritesFilter = button('Favorites', 'library-filter-favorites', () => setFilter('favorites'), `track-library-filter-button${initialFilter === 'favorites' ? ' active' : ''}`)
  allFilter.setAttribute('aria-pressed', String(initialFilter === 'all'))
  favoritesFilter.setAttribute('aria-pressed', String(initialFilter === 'favorites'))
  filter.append(allFilter, favoritesFilter)
  const count = element('p', 'track-library-count')
  toolbar.append(filter, count, searchToggle, search)
  const list = element('div', 'track-list')
  list.setAttribute('aria-live', 'polite')
  libraryContent.append(toolbar, list)
  let activeFilter: 'all' | 'favorites' = initialFilter
  const setFilter = (next: 'all' | 'favorites') => {
    activeFilter = next
    allFilter.classList.toggle('active', next === 'all')
    favoritesFilter.classList.toggle('active', next === 'favorites')
    allFilter.setAttribute('aria-pressed', String(next === 'all'))
    favoritesFilter.setAttribute('aria-pressed', String(next === 'favorites'))
    renderTracks()
  }

  const cardFor = (track: Track, official = false): HTMLElement => {
    const readOnly = isSharedTrack(track)
    const path = geometry.get(track).path
    const validation = validateTrack(track, path.totalLength)
    const card = element('article', `track-card${race ? '' : ' edit'}${track.id === state.currentTrack?.id ? ' selected' : ''}`)
    const select = button('', race ? `select-race-${track.id}` : `select-edit-${track.id}`,
      () => race ? actions.selectForRace(track.id) : actions.selectForEdit(track.id), 'track-card-select')
    const action = race ? cupSelection ? 'Add' : nearbyHosting ? 'Host' : 'Race' : readOnly ? 'View' : 'Edit'
    select.setAttribute('aria-label', `${action} ${track.name}`)
    select.disabled = race && !validation.ready

    const preview = createTrackPreview(path, track.points[0], track.environmentId)
    const copy = element('span', 'track-card-copy')
    copy.append(element('strong', 'track-card-name', track.name))
    const creator = element('span', 'track-card-creator')
    const environment = normalizeTrackEnvironmentId(track.environmentId)
    const dot = element('span', 'track-environment-dot')
    dot.dataset.environment = environment
    dot.setAttribute('title', ENVIRONMENT_NAMES[environment])
    dot.setAttribute('aria-label', `${ENVIRONMENT_NAMES[environment]} environment`)
    creator.append(dot, element('span', 'track-creator-name', track.creator?.name ?? (official ? 'Track Forge' : 'Unknown creator')))
    copy.append(creator)
    if (readOnly) copy.append(element('span', 'track-card-creator', 'Shared original · read-only'))
    if (!validation.ready) {
      const status = element('span', 'track-card-unavailable',
        validation.code === 'missing-checkpoints' ? 'INCOMPLETE · Add checkpoints' : validation.message)
      status.id = `track-status-${track.id}`
      if (race) select.setAttribute('aria-describedby', status.id)
      copy.append(status)
    } else if (race && official) {
      const medal = timeMedal(track, state.scoresByTrack[track.id] ?? [])
      if (medal) copy.append(element('span', 'track-card-medal', `${medal.toUpperCase()} MEDAL`))
    }
    select.append(preview, copy)
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
      if (racePicker) {
        const edit = iconAction(readOnly ? 'VIEW' : 'EDIT', 'edit', `edit-${track.id}`, () => { options.open = false; actions.selectForEdit(track.id) })
        edit.setAttribute('aria-label', `${readOnly ? 'View' : 'Edit'} ${track.name}`)
        menu.append(edit)
      }
      if (!isSeededTrack(track)) {
        const share = iconAction('SHARE', 'share', `share-${track.id}`, () => { options.open = false; actions.share(track) })
        share.setAttribute('aria-label', `Share ${track.name}`)
        menu.append(share)
        if (actions.sendNearby) {
          const nearby = iconAction('NEARBY', 'nearby', `send-nearby-${track.id}`, () => { options.open = false; actions.sendNearby?.(track) })
          nearby.setAttribute('aria-label', `Send ${track.name} nearby`)
          menu.append(nearby)
        }
      }
      if (!race) {
        const remove = iconAction('DELETE', 'delete', `delete-${track.id}`, () => { options.open = false; actions.delete(track) }, 'danger')
        remove.setAttribute('aria-label', `Delete ${track.name}`)
        menu.append(remove)
      }
      if (menu.childElementCount) {
        trigger.addEventListener('click', () => {
          for (const openMenu of list.querySelectorAll<HTMLDetailsElement>('.track-card-overflow[open]')) {
            if (openMenu !== options) openMenu.open = false
          }
        })
        options.append(trigger, menu)
        card.append(options)
      }
    }
    return card
  }

  // A favorite official circuit ranks above non-favorite saved tracks as well.
  const libraryTracks = race ? [...state.tracks, ...OFFICIAL_TRACKS] : state.tracks
  const renderTracks = () => {
    const query = search.value.trim().toLocaleLowerCase()
    const tracks = orderLibraryTracks(libraryTracks, state.preferences.favoriteTrackIds).filter(track => {
      if (activeFilter === 'favorites' && !favorites.has(track.id)) return false
      if (!query) return true
      return `${track.name} ${track.creator?.name ?? ''}`.toLocaleLowerCase().includes(query)
    })
    list.replaceChildren()
    count.textContent = `${tracks.length} ${tracks.length === 1 ? 'circuit' : 'circuits'}`
    if (tracks.length === 0) {
      list.append(element('p', 'empty-state', libraryTracks.length === 0 ? 'No tracks saved yet.' : 'No circuits match this view.'))
      return
    }
    for (const track of tracks) list.append(cardFor(track, OFFICIAL_TRACK_IDS.has(track.id)))
  }
  search.addEventListener('input', renderTracks)
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setSearchOpen(false)
    }
  })
  renderTracks()

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
  frame.body.append(libraryContent, fileInput)
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
