/** Model browsers that discard scroll assignments before an element is attached. */
export function clampDetachedScrollTopForTest(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  if (!descriptor?.get || !descriptor.set) throw new Error('Missing DOM scrollTop accessors')
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    get() { return this.isConnected ? descriptor.get?.call(this) ?? 0 : 0 },
    set(value: number) { descriptor.set?.call(this, this.isConnected ? value : 0) },
  })
  return () => Object.defineProperty(Element.prototype, 'scrollTop', descriptor)
}
