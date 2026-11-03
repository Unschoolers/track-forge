export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function button(
  label: string,
  action: string,
  onClick: () => void,
  className = 'button',
): HTMLButtonElement {
  const node = element('button', className, label)
  node.type = 'button'
  node.dataset.action = action
  node.addEventListener('click', onClick)
  return node
}
