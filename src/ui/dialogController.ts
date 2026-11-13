import type { AppOverlay } from '@/application/appState'

function isOpen(overlay: AppOverlay): boolean {
  return overlay.type !== 'none'
}

function focusable(dialog: Element): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])',
    ),
  ]
}

export class DialogController {
  private previousOverlay: AppOverlay = { type: 'none' }
  private restoreAction: string | undefined
  private dialogAction: string | undefined
  private dialogScroll = 0
  private close: (() => void) | undefined

  beforeRender(root: HTMLElement, next: AppOverlay): void {
    const active = document.activeElement
    this.dialogAction = undefined
    this.dialogScroll = 0
    if (!isOpen(this.previousOverlay) && isOpen(next)) {
      if (active instanceof HTMLElement && root.contains(active)) {
        this.restoreAction = active.dataset.action
      }
    }
    if (next.type === this.previousOverlay.type) {
      const dialog = root.querySelector<HTMLElement>('[role="dialog"]')
      this.dialogScroll = dialog?.querySelector('.modal-body')?.scrollTop ?? 0
      if (active instanceof HTMLElement && dialog?.contains(active)) {
        this.dialogAction = active.dataset.action
      }
    } else if (next.type === 'race-setup' && this.previousOverlay.type === 'options' &&
      this.previousOverlay.returnTo === 'race-setup') {
      this.dialogAction = 'setup-options'
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
      const controls = focusable(dialog)
      const control = controls.find((item) => item.dataset.action === this.dialogAction) ?? controls[0]
      control?.focus({ preventScroll: true })
      const body = dialog.querySelector<HTMLElement>('.modal-body')
      if (body) body.scrollTop = this.dialogScroll
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
