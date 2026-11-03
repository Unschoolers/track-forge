import type { AppOverlay } from '@/application/appState'

function isOpen(overlay: AppOverlay): boolean {
  return overlay.type !== 'none'
}

function focusable(dialog: Element): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ]
}

export class DialogController {
  private previousOverlay: AppOverlay = { type: 'none' }
  private restoreAction: string | undefined
  private close: (() => void) | undefined

  beforeRender(root: HTMLElement, next: AppOverlay): void {
    if (!isOpen(this.previousOverlay) && isOpen(next)) {
      const active = document.activeElement
      if (active instanceof HTMLElement && root.contains(active)) {
        this.restoreAction = active.dataset.action
      }
    }
  }

  afterRender(
    root: HTMLElement,
    overlay: AppOverlay,
    close: () => void,
  ): void {
    this.close = close
    document.removeEventListener('keydown', this.onKeyDown)
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')
    if (dialog) {
      document.addEventListener('keydown', this.onKeyDown)
      focusable(dialog)[0]?.focus()
    } else if (isOpen(this.previousOverlay) && !isOpen(overlay)) {
      if (this.restoreAction) {
        root
          .querySelector<HTMLElement>(
            `[data-action="${this.restoreAction}"]`,
          )
          ?.focus()
      }
      this.restoreAction = undefined
    }
    this.previousOverlay = overlay
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeyDown)
    this.close = undefined
    this.restoreAction = undefined
    this.previousOverlay = { type: 'none' }
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    if (!dialog) return
    if (event.key === 'Escape') {
      const label = dialog.getAttribute('aria-label')
      if (label !== 'Race paused') {
        event.preventDefault()
        this.close?.()
      }
      return
    }
    if (event.key !== 'Tab') return
    const controls = focusable(dialog)
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls.at(-1)
    if (
      event.shiftKey &&
      document.activeElement === first &&
      last
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
