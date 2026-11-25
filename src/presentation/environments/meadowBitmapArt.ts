import type { SurfaceId } from '@/domain/model'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { CITY_TERRAIN_ART, DESERT_TERRAIN_ART, KIDS_ROOM_TERRAIN_ART, MEADOW_TERRAIN_ART, type BitmapTerrainPalette } from './bitmapTerrainPalette'
import kidsUrl from '@/assets/environments/kids-room/materials.webp?url&no-inline'
import cityUrl from '@/assets/environments/cityscape/materials.webp?url&no-inline'
import desertUrl from '@/assets/environments/desert/materials.webp?url&no-inline'
import materialsUrl from '@/assets/environments/meadow/materials.webp?url&no-inline'
import patchesUrl from '@/assets/environments/meadow/patches.webp?url&no-inline'
import terrainUrl from '@/assets/environments/meadow/terrain.webp?url&no-inline'
import meadowGroundUrl from '@/assets/environments/meadow/ground.webp?url&no-inline'
import desertGroundUrl from '@/assets/environments/desert/ground.webp?url&no-inline'
import cityGroundUrl from '@/assets/environments/cityscape/ground.webp?url&no-inline'
import kidsGroundUrl from '@/assets/environments/kids-room/ground.webp?url&no-inline'
import meadowRoadUrl from '@/assets/environments/meadow/roads.webp?url&no-inline'
import desertRoadUrl from '@/assets/environments/desert/roads.webp?url&no-inline'
import cityRoadUrl from '@/assets/environments/cityscape/roads.webp?url&no-inline'
import kidsRoadUrl from '@/assets/environments/kids-room/roads.webp?url&no-inline'
import { createGroundTileRandom, GROUND_TILE_SIZE } from './groundTexture'
import { buildRoadTextureStrip, ROAD_TEXTURE_VARIANTS, ROAD_TEXTURE_SIZE, ROAD_TEXTURE_SURFACES, validateRoadAtlasDimensions } from './roadTextureVariants'
import { paintOrganicGround, type OrganicGroundTheme } from './organicGroundDetails'
import { createElevationMaterials, elevationMaterialForLevel, type ElevationMaterials } from './elevationMaterials'

export interface EnvironmentBitmapArt {
  readonly road: Readonly<Record<SurfaceId, HTMLCanvasElement>>
  readonly patches: readonly HTMLCanvasElement[]
  readonly organicGround?: { readonly theme: OrganicGroundTheme; readonly night: boolean }
  readonly sand: HTMLCanvasElement
  readonly water: HTMLCanvasElement
  readonly elevationMaterials: ElevationMaterials<HTMLCanvasElement>
  readonly terrainPalette: BitmapTerrainPalette
}

export interface MeadowBitmapArt extends EnvironmentBitmapArt {
  readonly tree: HTMLCanvasElement
}

let artwork: Readonly<Record<'day' | 'night', MeadowBitmapArt>> | undefined
let desertArtwork: Readonly<Record<'day' | 'night', EnvironmentBitmapArt>> | undefined
let cityArtwork: Readonly<Record<'day' | 'night', EnvironmentBitmapArt>> | undefined
let kidsArtwork: Readonly<Record<'day' | 'night', EnvironmentBitmapArt>> | undefined
let loading: Promise<void> | undefined

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load environment artwork: ${url}`))
    image.src = url
  })
}

export function createArtCanvas(width: number, height = width): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable for Meadow artwork')
  return { canvas, context }
}

function extract(image: HTMLImageElement, size: number, column: number, row: number, night: boolean): HTMLCanvasElement {
  const { canvas, context } = createArtCanvas(size)
  context.drawImage(image, column * size, row * size, size, size, 0, 0, size, size)
  if (night) {
    context.globalCompositeOperation = 'source-atop'
    context.fillStyle = 'rgba(8, 24, 39, 0.54)'
    context.fillRect(0, 0, size, size)
  }
  return canvas
}

function tint(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const { canvas, context } = createArtCanvas(source.width, source.height)
  context.drawImage(source, 0, 0)
  context.globalCompositeOperation = 'source-atop'
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/** Bake once at boot; the world-tile cache and GPU layer count stay unchanged. */
function roadStrip(source: HTMLCanvasElement): HTMLCanvasElement {
  const sourceContext = source.getContext('2d')
  if (!sourceContext) throw new Error('Canvas 2D is unavailable for road artwork')
  const size = source.width
  const { canvas, context } = createArtCanvas(size, size * ROAD_TEXTURE_VARIANTS)
  const pixels = sourceContext.getImageData(0, 0, size, size)
  const strip = context.createImageData(canvas.width, canvas.height)
  strip.data.set(buildRoadTextureStrip(pixels.data, size))
  context.putImageData(strip, 0, 0)
  return canvas
}

function roadAtlas(image: HTMLImageElement): Readonly<Record<'day' | 'night', EnvironmentBitmapArt['road']>> {
  validateRoadAtlasDimensions(image.naturalWidth, image.naturalHeight)
  const cell = (surface: SurfaceId) => roadStrip(extract(image, ROAD_TEXTURE_SIZE, ROAD_TEXTURE_SURFACES.indexOf(surface), 0, false))
  const day = { street: cell('street'), dirt: cell('dirt'), ice: cell('ice') }
  // Bake the costly three-variant strip only once per surface. Night
  // lighting is a single color pass over the same finished strip.
  const shade = (surface: SurfaceId) => tint(day[surface], 'rgba(8, 24, 39, 0.54)')
  return { day, night: { street: shade('street'), dirt: shade('dirt'), ice: shade('ice') } }
}

/** Decode the bundled, generated WebP atlases before creating any scenes.
 * No remote requests, per-frame image decoding or silent asset-load failures. */
export function loadEnvironmentBitmapArt(): Promise<void> {
  loading ??= Promise.all([
    loadImage(materialsUrl), loadImage(patchesUrl), loadImage(terrainUrl),
    loadImage(desertUrl), loadImage(cityUrl), loadImage(kidsUrl),
    loadImage(meadowGroundUrl), loadImage(desertGroundUrl), loadImage(cityGroundUrl), loadImage(kidsGroundUrl),
    loadImage(meadowRoadUrl), loadImage(desertRoadUrl), loadImage(cityRoadUrl), loadImage(kidsRoadUrl),
  ]).then(([materials, patches, terrain, desert, city, kids, meadowGround, desertGround, cityGround, kidsGround,
    meadowRoad, desertRoad, cityRoad, kidsRoad]) => {
    for (const [name, image] of [['Meadow', meadowGround], ['Desert', desertGround], ['Cityscape', cityGround], ['Kids’ Room', kidsGround]] as const) {
      if (image.naturalWidth !== GROUND_TILE_SIZE || image.naturalHeight !== GROUND_TILE_SIZE) {
        throw new Error(`Unexpected ${name} ground artwork dimensions`)
      }
    }
    if (materials.naturalWidth !== 192 || materials.naturalHeight !== 192 ||
      patches.naturalWidth !== 128 || patches.naturalHeight !== 128 ||
      terrain.naturalWidth !== 128 || terrain.naturalHeight !== 64) {
      throw new Error('Unexpected Meadow artwork atlas dimensions')
    }
    if (desert.naturalWidth !== 144 || desert.naturalHeight !== 96) {
      throw new Error('Unexpected Desert artwork atlas dimensions')
    }
    if (city.naturalWidth !== 144 || city.naturalHeight !== 96) {
      throw new Error('Unexpected Cityscape artwork atlas dimensions')
    }
    if (kids.naturalWidth !== 144 || kids.naturalHeight !== 96) {
      throw new Error('Unexpected Kids’ Room artwork atlas dimensions')
    }
    const meadowRoads = roadAtlas(meadowRoad)
    const desertRoads = roadAtlas(desertRoad)
    const cityRoads = roadAtlas(cityRoad)
    const kidsRoads = roadAtlas(kidsRoad)
    const build = (night: boolean): MeadowBitmapArt => {
      const ground = extract(meadowGround, GROUND_TILE_SIZE, 0, 0, night)
      return {
        road: meadowRoads[night ? 'night' : 'day'],
        elevationMaterials: createElevationMaterials(ground, {
          plateau: ground,
          slope: extract(terrain, 64, 1, 0, night),
          shading: MEADOW_TERRAIN_ART[night ? 'night' : 'day'].raised,
        }),
        terrainPalette: MEADOW_TERRAIN_ART[night ? 'night' : 'day'],
        water: extract(terrain, 64, 0, 0, night),
        patches: [extract(patches, 64, 0, 0, night), extract(patches, 64, 1, 0, night), extract(patches, 64, 0, 1, night)],
        tree: extract(patches, 64, 1, 1, night),
        sand: tint(extract(materials, 96, 0, 1, night), night ? 'rgba(107, 108, 79, 0.45)' : 'rgba(222, 198, 143, 0.48)'),
      }
    }
    const buildDesert = (night: boolean): EnvironmentBitmapArt => {
      const cell = (x: number, y: number) => extract(desert, 48, x, y, night)
      const dune = cell(2, 1)
      return {
        elevationMaterials: createElevationMaterials(extract(desertGround, GROUND_TILE_SIZE, 0, 0, night), {
          plateau: dune, slope: dune,
          shading: DESERT_TERRAIN_ART[night ? 'night' : 'day'].raised,
        }),
        road: desertRoads[night ? 'night' : 'day'],
        water: cell(1, 1),
        sand: tint(dune, night ? 'rgba(125,103,82,0.25)' : 'rgba(250,221,161,0.30)'),
        patches: [],
        organicGround: { theme: 'desert', night },
        terrainPalette: DESERT_TERRAIN_ART[night ? 'night' : 'day'],
      }
    }
    const buildCity = (night: boolean): EnvironmentBitmapArt => {
      const cell = (x: number, y: number) => extract(city, 48, x, y, night)
      const cobble = extract(cityGround, GROUND_TILE_SIZE, 0, 0, night)
      const quay = cell(2, 1)
      return {
        elevationMaterials: createElevationMaterials(cobble, {
          plateau: cobble, slope: quay,
          shading: CITY_TERRAIN_ART[night ? 'night' : 'day'].raised,
        }),
        road: cityRoads[night ? 'night' : 'day'],
        water: cell(1, 1),
        sand: tint(quay, night ? 'rgba(87,104,109,0.24)' : 'rgba(185,190,180,0.20)'),
        patches: [],
        organicGround: { theme: 'cityscape', night },
        terrainPalette: CITY_TERRAIN_ART[night ? 'night' : 'day'],
      }
    }
    const buildKids = (night: boolean): EnvironmentBitmapArt => {
      const cell = (x: number, y: number) => extract(kids, 48, x, y, night)
      // The new source is already royal blue; preserve its original fiber detail.
      const ground = extract(kidsGround, GROUND_TILE_SIZE, 0, 0, night)
      const quilt = cell(2, 1)
      return {
        elevationMaterials: createElevationMaterials(ground, {
          plateau: quilt, slope: quilt,
          shading: KIDS_ROOM_TERRAIN_ART[night ? 'night' : 'day'].raised,
        }),
        road: kidsRoads[night ? 'night' : 'day'],
        water: cell(1, 1),
        sand: tint(ground, night ? 'rgba(44,17,46,0.58)' : 'rgba(90,25,65,0.52)'),
        patches: [],
        organicGround: { theme: 'kids-room', night },
        terrainPalette: KIDS_ROOM_TERRAIN_ART[night ? 'night' : 'day'],
      }
    }
    kidsArtwork = { day: buildKids(false), night: buildKids(true) }
    cityArtwork = { day: buildCity(false), night: buildCity(true) }
    artwork = { day: build(false), night: build(true) }
    desertArtwork = { day: buildDesert(false), night: buildDesert(true) }
  })
  return loading
}

export function getMeadowBitmapArt(night: boolean): MeadowBitmapArt | undefined {
  return artwork?.[night ? 'night' : 'day']
}

export function getEnvironmentBitmapArt(environment: TrackEnvironmentId, night: boolean): EnvironmentBitmapArt | undefined {
  if (environment === 'grass') return getMeadowBitmapArt(night)
  if (environment === 'desert') return desertArtwork?.[night ? 'night' : 'day']
  if (environment === 'cityscape') return cityArtwork?.[night ? 'night' : 'day']
  if (environment === 'kids-room') return kidsArtwork?.[night ? 'night' : 'day']
  return undefined
}

/** Same base repeat phase in every world tile; variation lives in the
 * transparent bitmap and procedural patch placements. Art stays inside the
 * central tile, leaving its old padding
 * transparent so adjacent world tiles cannot cover one another. */
export function paintBitmapGround(context: CanvasRenderingContext2D, art: EnvironmentBitmapArt, variant: number, padding: number): void {
  const ground = elevationMaterialForLevel(art.elevationMaterials, 0).plateau
  // The generated swatch covers the full tile at one texel per world unit.
  context.drawImage(ground, padding, padding, GROUND_TILE_SIZE, GROUND_TILE_SIZE)
  if (art.organicGround) {
    paintOrganicGround(context, art.organicGround.theme, variant, art.organicGround.night, padding)
  }
  const random = createGroundTileRandom(variant, 0x5c3a)
  for (const patch of art.patches) {
    const size = 55 + random() * 35
    const x = padding + size / 2 + random() * (GROUND_TILE_SIZE - size)
    const y = padding + size / 2 + random() * (GROUND_TILE_SIZE - size)
    context.save()
    context.translate(x, y)
    context.rotate(random() * Math.PI * 2)
    context.drawImage(patch, -size / 2, -size / 2, size, size)
    context.restore()
  }
}
