import type { AppSnapshot } from '@/application/appState'
import {
  TERRAIN_LIMITS,
  type TerrainBrushRadius,
} from '@/domain/config'
import type { RoadStructure } from '@/domain/model'
import type { TerrainBrushMode } from '@/domain/editor/terrainBrush'
import {
  EDITOR_SURFACES,
  type EditorSurface,
} from '@/domain/editor/editorGeometry'
import { button, element } from '@/ui/dom'

interface SegmentedButtonChoice<Value extends string | number> {
  readonly value: Value
  readonly label: string
  readonly action: string
  readonly pressed: boolean
  readonly ariaLabel?: string
  readonly data?: Readonly<Record<string, string | number>>
  readonly select: () => void
}

/**
 * Builds the shared accessible segmented-button pattern used by all editor
 * material, structure, terrain, and brush-size controls.
 */
function createSegmentedButtons<Value extends string | number>(
  label: string,
  choices: readonly SegmentedButtonChoice<Value>[],
): HTMLElement {
  const group = element('div', 'editor-segmented-buttons')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', label)

  for (const choice of choices) {
    const control = button(
      choice.label,
      choice.action,
      choice.select,
      `editor-segmented-button${choice.pressed ? ' active' : ''}`,
    )
    control.setAttribute('aria-pressed', String(choice.pressed))
    if (choice.ariaLabel) control.setAttribute('aria-label', choice.ariaLabel)
    for (const [name, value] of Object.entries(choice.data ?? {})) {
      control.dataset[name] = String(value)
    }
    group.append(control)
  }

  return group
}

export function createEditorContextDock(
  state: Pick<AppSnapshot, 'editorUi'>,
  actions: {
    readonly surface: (surface: EditorSurface) => void
    readonly structure: (structure: RoadStructure) => void
    readonly terrainMode: (mode: TerrainBrushMode) => void
    readonly terrainRadius: (radius: TerrainBrushRadius) => void
  },
): HTMLElement {
  const dock = element('footer', 'editor-context-dock')
  dock.dataset.editorContextDock = ''
  dock.dataset.layout = state.editorUi.tool === 'terrain' ? 'two-row' : 'one-row'

  if (state.editorUi.tool === 'structure') {
    dock.append(
      createContextRow(
        createSegmentedButtons('Road structure', [
          structureChoice('surface', state.editorUi.structure, actions.structure),
          structureChoice('overpass', state.editorUi.structure, actions.structure),
        ]),
      ),
    )
    return dock
  }

  if (state.editorUi.tool === 'terrain') {
    dock.append(
      createContextRow(
        createSegmentedButtons('Terrain brush', [
          terrainBrushChoice(
            'raise',
            'RAISE',
            state.editorUi.terrainBrush.mode === 'raise',
            actions.terrainMode,
          ),
          // Terrain has one authored height. LOWER removes terrain to ground;
          // GROUND represents the same stateful eraser mode and is selected.
          terrainBrushChoice(
            'lower',
            'LOWER',
            state.editorUi.terrainBrush.mode === 'lower',
            actions.terrainMode,
          ),
          terrainBrushChoice(
            'water',
            'WATER',
            state.editorUi.terrainBrush.mode === 'water',
            actions.terrainMode,
          ),
          terrainBrushChoice(
            'ground',
            'GROUND',
            state.editorUi.terrainBrush.mode === 'ground',
            actions.terrainMode,
          ),
        ]),
      ),
      createContextRow(
        createSegmentedButtons(
          'Brush radius',
          TERRAIN_LIMITS.brushRadii.map((radius) =>
            terrainRadiusChoice(
              radius,
              state.editorUi.terrainBrush.radius,
              actions.terrainRadius,
            ),
          ),
        ),
      ),
    )
    return dock
  }

  dock.append(
    createContextRow(
      createSegmentedButtons(
        'Road surface',
        EDITOR_SURFACES.map((surface) => surfaceChoice(surface, state.editorUi.surface, actions.surface)),
      ),
    ),
  )
  return dock
}

function createContextRow(content: HTMLElement): HTMLElement {
  const row = element('div', 'editor-context-row')
  row.append(content)
  return row
}

function surfaceChoice(
  surface: EditorSurface,
  selected: EditorSurface,
  select: (surface: EditorSurface) => void,
): SegmentedButtonChoice<EditorSurface> {
  return {
    value: surface,
    label: surface.toUpperCase(),
    action: `surface-${surface}`,
    pressed: selected === surface,
    data: { surface },
    select: () => select(surface),
  }
}

function structureChoice(
  structure: RoadStructure,
  selected: RoadStructure,
  select: (structure: RoadStructure) => void,
): SegmentedButtonChoice<RoadStructure> {
  return {
    value: structure,
    label: structure.toUpperCase(),
    action: `structure-${structure}`,
    pressed: selected === structure,
    data: { structureBrush: structure },
    select: () => select(structure),
  }
}

function terrainBrushChoice(
  verb: 'raise' | 'lower' | 'water' | 'ground',
  label: string,
  pressed: boolean,
  select: (mode: TerrainBrushMode) => void,
): SegmentedButtonChoice<typeof verb> {
  return {
    value: verb,
    label,
    action: `terrain-brush-${verb}`,
    pressed,
    ariaLabel:
      verb === 'lower' ? 'Lower terrain to ground' : `${label[0]}${label.slice(1).toLowerCase()} terrain`,
    data: { terrainBrush: verb },
    select: () => select(verb),
  }
}

function terrainRadiusChoice(
  radius: TerrainBrushRadius,
  selected: TerrainBrushRadius,
  select: (radius: TerrainBrushRadius) => void,
): SegmentedButtonChoice<TerrainBrushRadius> {
  return {
    value: radius,
    label: `${radius} WU`,
    action: `terrain-radius-${radius}`,
    pressed: selected === radius,
    ariaLabel: `${radius} world-unit brush radius`,
    data: { terrainRadius: radius },
    select: () => select(radius),
  }
}
