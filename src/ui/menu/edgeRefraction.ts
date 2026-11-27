const MAX_WIDTH = 512
const MAX_HEIGHT = 384
const MAX_PIXELS = 160_000
const MAX_CACHED_MAPS = 16
// SVG displacement ranges from -scale/2 to +scale/2 CSS pixels.
const REFRACTION_SCALE = 24
const normalMapCache = new Map<string, string>()
let nextFilterId = 0

/** Attach bounded static normal maps to the selected glass surfaces. */
export function attachEdgeRefraction(root: HTMLElement, selector: string): () => void {
  const quality = root.dataset.graphicsQuality
  if (typeof ResizeObserver === 'undefined' || quality === 'low') {
    return () => undefined
  }
  const accessibilityPreference = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)')
  if (accessibilityPreference.matches) return () => undefined
  const supportsFilter = window.CSS?.supports?.('(backdrop-filter: url(#track-forge-edge-refraction)) or (-webkit-backdrop-filter: url(#track-forge-edge-refraction))') ?? false
  if (!supportsFilter) return () => undefined

  const surfaces = [...root.querySelectorAll<HTMLElement>(selector)]
  if (surfaces.length === 0) return () => undefined
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  const entries = surfaces.map(surface => {
    const id = `track-forge-edge-refraction-${++nextFilterId}`
    const filter = document.createElementNS(svg.namespaceURI, 'filter')
    filter.id = id
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse')
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    const image = document.createElementNS('http://www.w3.org/2000/svg', 'feImage') as SVGFEImageElement
    image.setAttribute('x', '0')
    image.setAttribute('y', '0')
    image.setAttribute('width', '1')
    image.setAttribute('height', '1')
    image.setAttribute('preserveAspectRatio', 'none')
    image.setAttribute('result', 'edge-map')
    const displacement = document.createElementNS(svg.namespaceURI, 'feDisplacementMap')
    displacement.setAttribute('in', 'SourceGraphic')
    displacement.setAttribute('in2', 'edge-map')
    displacement.setAttribute('scale', String(REFRACTION_SCALE))
    displacement.setAttribute('xChannelSelector', 'R')
    displacement.setAttribute('yChannelSelector', 'G')
    filter.append(image, displacement)
    svg.append(filter)
    return { surface, image, id }
  })
  const activeEntries = new Set<(typeof entries)[number]>()
  const style = document.createElement('style')
  root.append(svg)
  root.append(style)

  const updateStyles = () => {
    style.textContent = [...activeEntries].map(({ id }) => `#app [data-edge-refraction="${id}"] { backdrop-filter: url(#${id}); -webkit-backdrop-filter: url(#${id}); }`).join('\n')
  }
  const enableEntry = (entry: (typeof entries)[number]) => {
    const { id } = entry
    entry.surface.dataset.edgeRefraction = id
    activeEntries.add(entry)
    updateStyles()
  }
  const disableRefraction = () => {
    for (const entry of entries) delete entry.surface.dataset.edgeRefraction
    activeEntries.clear()
    updateStyles()
  }
  const onAccessibilityChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      disableRefraction()
      return
    }
    for (const entry of entries) {
      if (drawMap(entry.surface, entry.image, previousSizes)) enableEntry(entry)
    }
  }
  accessibilityPreference.addEventListener('change', onAccessibilityChange)

  const entryBySurface = new Map<Element, (typeof entries)[number]>(entries.map(entry => [entry.surface, entry]))
  const previousSizes = new WeakMap<HTMLElement, string>()
  const observer = new ResizeObserver(changes => {
    for (const change of changes) {
      const entry = entryBySurface.get(change.target)
      if (entry && !accessibilityPreference.matches) {
        if (drawMap(entry.surface, entry.image, previousSizes)) enableEntry(entry)
        else {
          delete entry.surface.dataset.edgeRefraction
          activeEntries.delete(entry)
          updateStyles()
        }
      }
    }
  })
  for (const entry of entries) {
    observer.observe(entry.surface)
    if (drawMap(entry.surface, entry.image, previousSizes)) enableEntry(entry)
  }
  return () => {
    observer.disconnect()
    accessibilityPreference.removeEventListener('change', onAccessibilityChange)
    for (const { surface } of entries) {
      delete surface.dataset.edgeRefraction
    }
    svg.remove()
    style.remove()
  }
}

function drawMap(surface: HTMLElement, image: SVGFEImageElement, previousSizes: WeakMap<HTMLElement, string>): boolean {
  const rect = surface.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const corner = getComputedStyle(surface).borderTopLeftRadius
  const parsed = Number.parseFloat(corner)
  const cssRadius = Number.isFinite(parsed)
    ? corner.endsWith('%') ? Math.min(rect.width, rect.height) * parsed / 100 : parsed
    : 28
  const cornerRadius = Math.max(0, Math.min(rect.width / 2, rect.height / 2, cssRadius))
  const size = `${rect.width}x${rect.height}:${cornerRadius}`
  if (previousSizes.get(surface) === size) return image.hasAttribute('href')
  const fit = Math.min(1, MAX_WIDTH / rect.width, MAX_HEIGHT / rect.height, Math.sqrt(MAX_PIXELS / (rect.width * rect.height)))
  const width = Math.max(1, Math.round(rect.width * fit))
  const height = Math.max(1, Math.round(rect.height * fit))
  const radius = cornerRadius * fit
  const edgeWidth = Math.max(1, Math.min(16, rect.width / 4, rect.height / 4) * fit)
  const cacheKey = `${width}x${height}:${fit}:${radius}:${edgeWidth}`
  const cachedMap = normalMapCache.get(cacheKey)
  image.setAttribute('width', String(rect.width))
  image.setAttribute('height', String(rect.height))
  if (cachedMap) {
    image.setAttribute('href', cachedMap)
    previousSizes.set(surface, size)
    return true
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return false
  const pixels = context.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const qx = Math.abs(x + 0.5 - width / 2) - (width / 2 - radius)
      const qy = Math.abs(y + 0.5 - height / 2) - (height / 2 - radius)
      const outsideX = Math.max(qx, 0)
      const outsideY = Math.max(qy, 0)
      const cornerLength = Math.hypot(outsideX, outsideY)
      const distance = cornerLength + Math.min(Math.max(qx, qy), 0) - radius
      const edge = Math.max(0, 1 - Math.abs(distance) / edgeWidth)
      const strength = edge * edge * (3 - 2 * edge)
      const normalX = cornerLength > 0
        ? outsideX / cornerLength * Math.sign(x + 0.5 - width / 2)
        : qx > qy ? Math.sign(x + 0.5 - width / 2) : 0
      const normalY = cornerLength > 0
        ? outsideY / cornerLength * Math.sign(y + 0.5 - height / 2)
        : qy >= qx ? Math.sign(y + 0.5 - height / 2) : 0
      const offset = (y * width + x) * 4
      pixels.data[offset] = clampByte(128 + normalX * strength * 127)
      pixels.data[offset + 1] = clampByte(128 + normalY * strength * 127)
      pixels.data[offset + 2] = 128
      pixels.data[offset + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')
  image.setAttribute('href', dataUrl)
  previousSizes.set(surface, size)
  normalMapCache.set(cacheKey, dataUrl)
  if (normalMapCache.size > MAX_CACHED_MAPS) {
    const oldest = normalMapCache.keys().next().value
    if (oldest !== undefined) normalMapCache.delete(oldest)
  }
  return true
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
