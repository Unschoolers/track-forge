// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachEdgeRefraction } from '@/ui/menu/edgeRefraction'

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly observed: Element[] = []
  disconnected = false

  constructor(private readonly callback: ResizeObserverCallback) { TestResizeObserver.instances.push(this) }
  observe(target: Element): void { this.observed.push(target) }
  disconnect(): void { this.disconnected = true }
  resize(target: Element): void { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
}

function mediaPreference(matches: boolean) {
  let listener: ((event: MediaQueryListEvent) => void) | undefined
  const preference = {
    matches,
    addEventListener: vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => { listener = callback }),
    removeEventListener: vi.fn(),
    change: (next: boolean) => {
      preference.matches = next
      listener?.({ matches: next } as MediaQueryListEvent)
    },
  }
  return preference
}

afterEach(() => {
  document.body.replaceChildren()
  TestResizeObserver.instances = []
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('static edge refraction', () => {
  it('builds a unique bounded normal map with directional normals on every edge and cleans up on teardown', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.stubGlobal('CSS', { supports: () => true })
    const preference = mediaPreference(false)
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference as unknown as MediaQueryList)
    const maps: ImageData[] = []
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: (image: ImageData) => maps.push(image),
    } as unknown as CanvasRenderingContext2D))
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,map')

    const root = document.createElement('div')
    root.id = 'app'
    root.dataset.graphicsQuality = 'medium'
    const first = document.createElement('div')
    const second = document.createElement('div')
    root.append(first, second)
    document.body.append(root)
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ width: 180, height: 80 } as DOMRect)
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ width: 4000, height: 4000 } as DOMRect)

    const cleanup = attachEdgeRefraction(root, 'div')
    const filters = [...root.querySelectorAll('filter')]
    expect(filters).toHaveLength(2)
    expect(new Set(filters.map(filter => filter.id)).size).toBe(2)
    expect(root.querySelector('style')?.textContent).toContain(`url(#${filters[0]?.id})`)
    expect(maps).toHaveLength(2)
    const normalMap = maps[0]
    const boundedMap = maps[1]
    if (!normalMap || !boundedMap) throw new Error('The normal maps were not drawn')
    expect(normalMap.data[(1 * normalMap.width + 90) * 4 + 1]).toBeLessThan(128)
    expect(normalMap.data[(78 * normalMap.width + 90) * 4 + 1]).toBeGreaterThan(128)
    expect(normalMap.data[(40 * normalMap.width + 1) * 4]).toBeLessThan(128)
    expect(normalMap.data[(40 * normalMap.width + 178) * 4]).toBeGreaterThan(128)
    expect(normalMap.data[(40 * normalMap.width + 90) * 4]).toBe(128)
    expect(boundedMap.width).toBeLessThanOrEqual(512)
    expect(boundedMap.height).toBeLessThanOrEqual(384)
    expect(boundedMap.width * boundedMap.height).toBeLessThanOrEqual(160_000)
    expect(filters[0]?.querySelector('feImage')?.getAttribute('width')).toBe('180')
    expect(filters[0]?.querySelector('feImage')?.getAttribute('height')).toBe('80')
    expect(filters[0]?.getAttribute('primitiveUnits')).toBe('userSpaceOnUse')

    const observer = TestResizeObserver.instances[0]
    if (!observer) throw new Error('Resize observer was not attached')
    observer.resize(first)
    expect(maps).toHaveLength(2)
    preference.change(true)
    expect(first.dataset.edgeRefraction).toBeUndefined()
    expect(root.querySelector('style')?.textContent).toBe('')
    preference.change(false)
    expect(first.dataset.edgeRefraction).toBe(filters[0]?.id)
    expect(getContext).toHaveBeenCalledTimes(2)
    cleanup()
    expect(observer.disconnected).toBe(true)
    expect(root.querySelector('svg')).toBeNull()
    expect(root.querySelector('style')).toBeNull()
    expect(first.dataset.edgeRefraction).toBeUndefined()
    const rerenderCleanup = attachEdgeRefraction(root, 'div')
    expect(getContext).toHaveBeenCalledTimes(2)
    rerenderCleanup()
  })

  it('does not attach maps for low quality, reduced transparency, or unsupported URL filters', () => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.stubGlobal('CSS', { supports: () => false })
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaPreference(false) as unknown as MediaQueryList)
    const root = document.createElement('div')
    const surface = document.createElement('div')
    root.append(surface)
    root.dataset.graphicsQuality = 'low'
    attachEdgeRefraction(root, 'div')()
    expect(root.querySelector('svg')).toBeNull()
    expect(TestResizeObserver.instances).toHaveLength(0)

    root.dataset.graphicsQuality = 'high'
    vi.mocked(window.matchMedia).mockReturnValue(mediaPreference(true) as unknown as MediaQueryList)
    attachEdgeRefraction(root, 'div')()
    expect(root.querySelector('svg')).toBeNull()
    vi.mocked(window.matchMedia).mockReturnValue(mediaPreference(false) as unknown as MediaQueryList)
    attachEdgeRefraction(root, 'div')()
    expect(root.querySelector('svg')).toBeNull()
  })
})
