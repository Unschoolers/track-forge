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
  const classes = className.split(/\s+/)
  node.dataset.menuActionIntent = classes.includes('button-danger')
    ? 'danger'
    : classes.includes('button-primary') || classes.includes('tf-menu-action--primary')
      ? 'primary'
      : 'secondary'
  node.addEventListener('click', onClick)
  return node
}
