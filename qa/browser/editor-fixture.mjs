// Independent of the shipped circuit catalog.
export const EDITOR_FIXTURE_NAME = 'Editor QA'
export async function seedEditorFixture(page) {
  const points = Array.from({ length: 17 }, (_, index) => {
    const theta = (index % 16) * Math.PI / 8
    return { x: 260 * Math.cos(theta), y: 345 * Math.sin(theta), surface: 'street' }
  })
  await page.addInitScript(({ name, points }) => {
    if (localStorage.getItem('trackforge-library-v2')) return
    localStorage.setItem('trackforge-library-v2', JSON.stringify([{
      id: 'editor-qa', name, version: 8, points, trees: [],
      recoveryCheckpoints: [0.45], autoCheckpoints: false,
      terrain: { cellSize: 32, cells: [] }, lighting: 'day', createdAt: 1, updatedAt: 1,
    }]))
    localStorage.setItem('trackforge-library-v1-migrated', '1')
  }, { name: EDITOR_FIXTURE_NAME, points })
}
