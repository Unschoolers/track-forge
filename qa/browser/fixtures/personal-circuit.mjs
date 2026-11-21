/**
 * A valid, personally authored circuit for share/import/export browser journeys.
 * Built-in tracks are deliberately not shareable or directly editable.
 */
export async function seedPersonalCircuit(page, name = 'QA Circuit') {
  const points = Array.from({ length: 33 }, (_, index) => {
    const angle = (index % 32) * Math.PI / 16
    return {
      x: 180 * Math.cos(angle),
      y: 220 * Math.sin(angle),
      surface: 'street',
      curve: 'smooth',
      tension: 0.5,
    }
  })
  await page.addInitScript(track => {
    localStorage.setItem('trackforge-library-v2', JSON.stringify([track]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, {
    id: 'qa-personal-circuit',
    origin: 'local',
    name,
    version: 8,
    routeKind: 'circuit',
    points,
    trees: [],
    terrain: { cellSize: 32, cells: [] },
    start: { ratio: 0, reversed: false },
    lighting: 'day',
    createdAt: 1,
    updatedAt: 1,
  })
}
