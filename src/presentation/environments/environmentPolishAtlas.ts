/** Local generated material atlas layout shared by every environment. */
export const POLISH_TEXTURE_SIZE = 256
export const POLISH_CELLS = {
  water: [0, 0],
  elevation: [1, 0],
  patch: [0, 1],
  bridge: [1, 1],
} as const

export function validatePolishAtlas(width: number, height: number): void {
  if (width !== POLISH_TEXTURE_SIZE * 2 || height !== POLISH_TEXTURE_SIZE * 2) {
    throw new Error('Unexpected generated environment polish atlas dimensions')
  }
}
