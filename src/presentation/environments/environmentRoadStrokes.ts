import type { SurfaceId } from '@/domain/model'
import type { RoadPathPoint } from '@/domain/track/pathBuilder'
import type { TrackEnvironmentId } from '@/domain/track/trackEnvironment'
import { kidsRoomRoadStrokes, type RoadMaterialStroke } from './kidsRoomRoadStrokes'

type RoadPoint = Pick<RoadPathPoint, 'x' | 'y' | 'distance'>

/**
 * Distance-anchored, deterministic material detail shared by race, editor
 * and flyover. Decorations do not alter road geometry, grip or saved tracks.
 * Renderers build strokes only when creating their static road geometry.
 */
export function environmentRoadStrokes(
  environment: TrackEnvironmentId,
  surface: SurfaceId,
  from: RoadPoint,
  to: RoadPoint,
  night: boolean,
): readonly RoadMaterialStroke[] {
  if (environment === 'kids-room') return kidsRoomRoadStrokes(surface, from, to, night)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const span = to.distance - from.distance
  if (length < 0.001 || span <= 0 ||
      ![from.x, from.y, from.distance, to.x, to.y, to.distance].every(Number.isFinite)) return []

  const tangentX = dx / length
  const tangentY = dy / length
  const normalX = -tangentY
  const normalY = tangentX
  // Fewer marks on asphalt; frequent directional grains on loose material.
  const interval = surface === 'street' ? 72 : surface === 'dirt' ? 34 : 48
  const first = Math.floor(from.distance / interval) + 1
  const last = Math.min(Math.floor(to.distance / interval), first + 31)
  const strokes: RoadMaterialStroke[] = []
  const draw = (
    centerX: number, centerY: number,
    along1: number, across1: number, along2: number, across2: number,
    color: number, alpha: number, width: number,
  ): void => {
    strokes.push({
      start: { x: centerX + tangentX * along1 + normalX * across1,
        y: centerY + tangentY * along1 + normalY * across1 },
      end: { x: centerX + tangentX * along2 + normalX * across2,
        y: centerY + tangentY * along2 + normalY * across2 },
      color, alpha, width,
    })
  }

  for (let mark = first; mark <= last; mark += 1) {
    const t = (mark * interval - from.distance) / span
    const x = from.x + dx * t
    const y = from.y + dy * t
    const jitter = ((Math.imul(mark + 19, 2654435761) >>> 8) % 27) - 13
    switch (environment) {
      case 'grass':
        if (surface === 'street') {
          // Fine stone aggregate and occasional worn asphalt repairs.
          draw(x, y, -7, jitter, 9, jitter + 3, night ? 0x89949d : 0x8e9894, 0.34, 1.5)
          draw(x, y, -3, jitter - 10, 4, jitter - 13, night ? 0x151c23 : 0x252c31, 0.35, 1.3)
          if (mark % 5 === 0) draw(x, y, 0, -30, 0, 30, 0x151b1e, night ? 0.32 : 0.28, 1.8)
        } else if (surface === 'dirt') {
          // Twin shallow wheel ruts and broken pebbly edges.
          draw(x, y, -14, -17, 15, -17, night ? 0x312c26 : 0x573f2c, 0.44, 2.3)
          draw(x, y, -14, 17, 15, 17, night ? 0x312c26 : 0x573f2c, 0.44, 2.3)
          draw(x, y, -4, jitter, 1, jitter - 3, night ? 0xb4a083 : 0xd9b98b, 0.52, 2)
        } else {
          draw(x, y, -14, jitter, 15, jitter + 2, night ? 0x9ed9ec : 0xe8faff, 0.7, 1.8)
          draw(x, y, -5, -21, 7, -17, night ? 0x70a7bb : 0xffffff, 0.38, 1.5)
        }
        break
      case 'desert':
        if (surface === 'street') {
          // Pale dust trapped at the shoulder, fine heat-weathered cracks.
          draw(x, y, -15, -31, 16, -31, night ? 0xb4a083 : 0xeacda2, 0.4, 2)
          draw(x, y, -15, 31, 16, 31, night ? 0xb4a083 : 0xeacda2, 0.4, 2)
          draw(x, y, -8, jitter, 6, jitter - 5, night ? 0x24252a : 0x484239, 0.34, 1.5)
        } else if (surface === 'dirt') {
          // Wind-sculpted sand ripples across the track, plus ruts.
          draw(x, y, 0, -26, -3, 25, night ? 0xdbac73 : 0xffd899, 0.48, 1.8)
          draw(x, y, 4, -24, 1, 25, night ? 0x513923 : 0x92633a, 0.28, 1.6)
          draw(x, y, -9, jitter, 5, jitter, night ? 0xd7b47d : 0xffe6b2, 0.43, 1.4)
        } else {
          // Pale reflective salt/ice crust stays unmistakably slippery.
          draw(x, y, -19, jitter, 18, jitter + 2, night ? 0xa4cfdf : 0xf7ffff, 0.72, 2)
          draw(x, y, -3, -13, 7, -6, night ? 0x709bb2 : 0x8cbec7, 0.45, 1.4)
          if (mark % 3 === 0) draw(x, y, 0, -23, 0, 23, night ? 0x91bdc7 : 0xffffff, 0.35, 1.3)
        }
        break
      case 'cityscape':
        if (surface === 'street') {
          // Tar seams and sparse tiny road aggregate; no repeated tile grid.
          draw(x, y, -8, jitter, 7, jitter + 1, night ? 0xb3b9bd : 0x8b9296, 0.3, 1.2)
          draw(x, y, -4, jitter - 9, 3, jitter - 11, night ? 0x111c24 : 0x273238, 0.35, 1.8)
          if (mark % 3 === 0) draw(x, y, 0, -29, 0, 29, night ? 0x111c23 : 0x30383c, 0.38, 2.3)
        } else if (surface === 'dirt') {
          // Construction gravel, grit and rough scrape marks.
          draw(x, y, -12, jitter - 8, 12, jitter - 4, night ? 0xb1aba0 : 0xd8c9b2, 0.38, 2.4)
          draw(x, y, -4, jitter + 8, 3, jitter + 11, night ? 0x292f32 : 0x5e5c55, 0.48, 2.6)
          draw(x, y, 4, jitter - 18, 9, jitter - 21, night ? 0xc3bfb5 : 0xe4d7ba, 0.42, 1.4)
        } else {
          // Long sharp glints make frozen urban pavement read as slick.
          draw(x, y, -19, jitter, 18, jitter + 1, night ? 0x9ecddd : 0xf2ffff, 0.74, 2.1)
          draw(x, y, -8, -21, 11, -21, night ? 0x8ab9c8 : 0xffffff, 0.44, 1.5)
          if (mark % 4 === 0) draw(x, y, -3, -28, 3, 28, night ? 0x658d9f : 0xa8dfe7, 0.3, 1.4)
        }
        break
    }
  }
  return strokes
}
