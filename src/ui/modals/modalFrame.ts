import { button, element } from '@/ui/dom'

export interface ModalFrame {
  readonly overlay: HTMLElement
  readonly body: HTMLElement
  readonly footer: HTMLElement
}

export function createModalFrame(
  title: string,
  subtitle: string,
  close: (() => void) | undefined,
  className = '',
): ModalFrame {
  const overlay = element(
    'div',
    `modal-overlay${className ? ` ${className}` : ''}`,
  )
  const dialog = element('section', 'modal-card')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', title)
  const header = element('header', 'modal-header')
  const heading = element('div')
  heading.append(
    element('h2', 'modal-title', title),
    element('p', 'modal-subtitle', subtitle),
  )
  header.append(heading)
  if (close) {
    const closeButton = button('×', 'close-dialog', close, 'modal-close')
    closeButton.setAttribute('aria-label', 'Close')
    header.append(closeButton)
  }
  const body = element('div', 'modal-body')
  const footer = element('footer', 'modal-footer')
  dialog.append(header, body, footer)
  overlay.append(dialog)
  return { overlay, body, footer }
}
