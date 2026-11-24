/** A user-created, race-ready track. Built-in tracks are not shareable. */
export const OWNED_TRACK_NAME = 'QA Shared Circuit'

export async function seedOwnedTrack(page, environmentId = 'cityscape') {
  await page.addInitScript(({ name, environmentId }) => {
    const points = Array.from({ length: 17 }, (_, index) => {
      const radians = index / 16 * Math.PI * 2
      return {
        id: `qa-control-${index}`,
        x: Math.round(320 * Math.cos(radians)),
        y: Math.round(240 * Math.sin(radians)),
        surface: 'street',
        curve: 'smooth',
      }
    })
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'qa-owned-circuit',
      name, version: 8, origin: 'local',
      lighting: 'day', environmentId,
      createdAt: 1, updatedAt: 1, routeKind: 'circuit',
      points, recoveryCheckpoints: [0.25, 0.55, 0.8], trees: [], scenery: [], terrain: { cellSize: 32, cells: [] },
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, { name: OWNED_TRACK_NAME, environmentId })
}
