import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const consumers = [
  'src/domain/track/trackDiagnostics.ts',
  'src/domain/track/trackValidation.ts',
  'src/phaser/input/editorInput.ts',
  'src/phaser/rendering/editorRenderer.ts',
  'src/ui/editor/editorSelectionPanels.ts',
] as const

describe('track geometry authority', () => {
  it('keeps runtime consumers from reconstructing road paths or geometry', () => {
    for (const file of consumers) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(
        /\b(?:buildRoadPath|buildTrackGeometry)\b/,
      )
    }
  })
})
