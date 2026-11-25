import { describe, expect, it } from 'vitest'
import { POLISH_TEXTURE_SIZE, POLISH_CELLS, validatePolishAtlas } from '@/presentation/environments/environmentPolishAtlas'

describe('generated environment materials', () => {
  it('requires four independent 256px material cells with the stable atlas layout', () => {
    expect(POLISH_TEXTURE_SIZE).toBe(256)
    expect(POLISH_CELLS).toEqual({ water: [0, 0], elevation: [1, 0], patch: [0, 1], bridge: [1, 1] })
    expect(() => validatePolishAtlas(512, 512)).not.toThrow()
    expect(() => validatePolishAtlas(256, 256)).toThrow('Unexpected generated environment polish atlas dimensions')
    expect(() => validatePolishAtlas(512, 256)).toThrow()
  })
})
