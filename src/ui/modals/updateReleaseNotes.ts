import type { ReleaseNotes } from '@/application/updates/updateProvider'
import { button, element } from '@/ui/dom'

export function createReleaseNotesButton(onClick: () => void): HTMLButtonElement {
  const control = button('', 'view-release-notes', onClick, 'button options-release-notes-button')
  control.setAttribute('aria-label', 'View release notes')
  control.title = 'What changed since my installed version?'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M14 3v5h5 M8 12h8 M8 16h8')
  svg.append(path)
  control.append(svg)
  return control
}

function buildLabel(version: string): string {
  return version.replace(/^android-build-(\d+)-(\d+)$/, 'Build $1.$2')
}

/**
 * Switch the existing Options dialog into a full-screen reader. Reuse one dialog
 * to preserve the keyboard focus trap and prevent stacked Android modals.
 */
export function openReleaseNotesView(
  overlay: HTMLElement,
  load: () => Promise<ReleaseNotes>,
  onBack: () => void = () => {},
): void {
  const card = overlay.querySelector<HTMLElement>('.modal-card')
  if (!card) throw new Error('Release notes require an open Options dialog.')
  const oldChildren = [...card.children]
  const header = element('header', 'release-notes-header')
  const heading = element('div', 'release-notes-heading')
  heading.append(element('h2', 'modal-title', "WHAT'S NEW"), element('p', 'modal-subtitle', 'Changes since your installed build'))
  const body = element('div', 'release-notes-scroll')
  body.setAttribute('role', 'region')
  body.setAttribute('aria-label', 'Release notes')
  body.tabIndex = 0
  const restore = () => {
    overlay.removeEventListener('keydown', onKeyDown, true)
    card.classList.remove('release-notes-card')
    card.replaceChildren(...oldChildren)
    overlay.classList.remove('release-notes-active')
    onBack()
    overlay.querySelector<HTMLButtonElement>('[data-action="view-release-notes"]')?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      restore()
    }
  }
  const back = button('←', 'back-release-notes', restore, 'modal-close release-notes-back')
  back.setAttribute('aria-label', 'Back to Updates')
  header.append(back, heading)
  card.replaceChildren(header, body)
  card.classList.add('release-notes-card')
  overlay.classList.add('release-notes-active')
  overlay.addEventListener('keydown', onKeyDown, true)
  back.focus({ preventScroll: true })

  const render = (notes: ReleaseNotes) => {
    const summary = element('section', 'release-notes-summary')
    summary.append(
      element('p', 'release-notes-range', `${buildLabel(notes.fromVersion)} → ${buildLabel(notes.toVersion)}`),
      element('p', 'modal-subtitle', `${notes.releases.length} published build${notes.releases.length === 1 ? '' : 's'} in this update`),
    )
    const items = notes.releases.map((release) => {
      const section = element('section', 'release-notes-build')
      section.append(element('h3', 'release-notes-build-title', buildLabel(release.version)))
      if (release.publishedAt) {
        const date = new Date(release.publishedAt)
        if (!Number.isNaN(date.getTime())) section.append(element('p', 'modal-subtitle', date.toLocaleDateString()))
      }
      if (release.changes.length) {
        const list = element('ul', 'release-notes-list')
        for (const change of release.changes) list.append(element('li', '', change))
        section.append(list)
      } else {
        section.append(element('p', 'modal-subtitle', 'No detailed changes were published for this build.'))
      }
      return section
    })
    body.replaceChildren(summary, ...items)
    if (notes.releases.length === 0) body.append(element('p', 'modal-subtitle', 'No published release notes were found in this version range.'))
    if (!notes.complete) body.append(element('p', 'release-notes-warning', 'Release history is very long. Older changes may be missing.'))
  }

  const request = () => {
    body.replaceChildren(element('p', 'modal-subtitle', 'Loading release history…'))
    void load().then((notes) => {
      if (card.classList.contains('release-notes-card')) render(notes)
    }).catch((error: unknown) => {
      if (!card.classList.contains('release-notes-card')) return
      body.replaceChildren(
        element('p', 'release-notes-warning', error instanceof Error ? error.message : 'Could not load release history.'),
        button('RETRY', 'retry-release-notes', request, 'button button-primary'),
      )
    })
  }
  request()
}
