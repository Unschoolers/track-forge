import { element } from '@/ui/dom'

export function createToast(message: string): HTMLElement {
  const toast = element('div', 'toast show', message)
  toast.setAttribute('role', 'status')
  toast.setAttribute('aria-live', 'polite')
  return toast
}
