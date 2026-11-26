import { isCarId, type CreatorGhostChallenge } from '@/domain/model'

export const MAX_CREATOR_GHOST_FRAMES = 3_000
export const MAX_CREATOR_GHOST_SPLITS = 1_200
export const MAX_CREATOR_GHOST_SECONDS = 86_400

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function lapCount(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
}

/** External challenge data is untrusted and must stay within replay/storage bounds. */
export function decodeCreatorGhostChallenge(value: unknown): CreatorGhostChallenge | undefined {
  const input = object(value)
  if (!input || !isCarId(input.car) || !lapCount(input.laps) ||
      !finite(input.time) || input.time <= 0 || input.time > MAX_CREATOR_GHOST_SECONDS ||
      !Array.isArray(input.frames) || input.frames.length < 2 ||
      input.frames.length > MAX_CREATOR_GHOST_FRAMES) return undefined

  const frames: CreatorGhostChallenge['frames'][number][] = []
  for (let index = 0; index < input.frames.length; index++) {
    const frame = object(input.frames[index])
    const structureRunId = frame?.structureRunId
    if (structureRunId !== null &&
        (typeof structureRunId !== 'string' || structureRunId.length > 96)) return undefined
    if (!frame || !finite(frame.t) || !finite(frame.x) || !finite(frame.y) ||
        !finite(frame.angle) || !finite(frame.z) || Math.abs(frame.angle) > 1_000_000 ||
        Math.abs(frame.z) > 1_000_000 || frame.t < 0 || frame.t > input.time ||
        Math.abs(frame.x) > 10_000_000 || Math.abs(frame.y) > 10_000_000 ||
        (frame.cut !== undefined && typeof frame.cut !== 'boolean') ||
        (index === 0 ? frame.t !== 0 : frame.t <= (frames[index - 1]?.t ?? -1))) return undefined
    frames.push({
      t: frame.t, x: frame.x, y: frame.y, angle: frame.angle, z: frame.z,
      structureRunId: structureRunId ?? null,
      ...(frame.cut === true ? { cut: true } : {}),
    })
  }
  if (frames.at(-1)?.t !== input.time) return undefined

  let splits: number[] | undefined
  if (input.splits !== undefined) {
    if (!Array.isArray(input.splits) || input.splits.length === 0 ||
        input.splits.length > MAX_CREATOR_GHOST_SPLITS) return undefined
    splits = []
    for (let index = 0; index < input.splits.length; index++) {
      const split = input.splits[index]
      if (!finite(split) || split <= 0 || split > input.time ||
          (index > 0 && split < (splits[index - 1] ?? 0))) return undefined
      splits.push(split)
    }
  }
  return { car: input.car, laps: input.laps, time: input.time, frames,
    ...(splits ? { splits } : {}) }
}

export function isCreatorGhostChallenge(value: unknown): value is CreatorGhostChallenge {
  return decodeCreatorGhostChallenge(value) !== undefined
}
