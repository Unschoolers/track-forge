import type { AppSnapshot } from '@/application/appState'
import type { EditorTool } from '@/domain/editor/editorGeometry'
import { element } from '@/ui/dom'
import { editorIcon, editorIconButton, type EditorIcon } from '@/ui/editor/editorIcons'

const tools: readonly {
  readonly id: EditorTool
  readonly icon: EditorIcon
  readonly label: string
  readonly shortLabel: string
}[] = [
  { id: 'draw', icon: 'draw', label: 'Draw road', shortLabel: 'Road' },
  { id: 'select', icon: 'select', label: 'Move points', shortLabel: 'Select' },
  { id: 'insert', icon: 'insert', label: 'Add point on road', shortLabel: 'Add point' },
  { id: 'start', icon: 'start', label: 'Place start line', shortLabel: 'Start' },
  { id: 'checkpoint', icon: 'checkpoint', label: 'Place checkpoint', shortLabel: 'Checkpoint' },
  { id: 'paint', icon: 'paint', label: 'Paint surface', shortLabel: 'Surface' },
  { id: 'structure', icon: 'structure', label: 'Paint structure', shortLabel: 'Structure' },
  { id: 'terrain', icon: 'terrain', label: 'Paint terrain', shortLabel: 'Terrain' },
  { id: 'pan', icon: 'pan', label: 'Pan map', shortLabel: 'Pan' },
  { id: 'tree', icon: 'tree', label: 'Scenery', shortLabel: 'Props' },
  { id: 'erase', icon: 'erase', label: 'Erase', shortLabel: 'Erase' },
]

export function createEditorToolPalette(
  state: Pick<AppSnapshot, 'editorUi' | 'editor'>,
  actions: { readonly tool: (tool: EditorTool) => void },
): HTMLElement {
  const palette = element('nav', 'tool-rail')
  palette.setAttribute('aria-label', 'Editor tools')
  const drawer = element('details', 'editor-toolbox-drawer')
  const summary = element('summary', 'editor-toolbox-summary')
  const active = tools.find((definition) => definition.id === state.editorUi.tool) ?? tools[0]
  if (!active) throw new Error('Editor tool palette is empty')
  summary.append(
    editorIcon(active.icon),
    element('span', 'editor-toolbox-summary-copy', 'TOOLS'),
    element('strong', 'editor-toolbox-current', active.shortLabel),
  )
  const choices = element('div', 'editor-toolbox-items')
  for (const definition of tools) {
    if (definition.id === 'start' && state.editor.routeKind === 'point-to-point') continue
    const tool = editorIconButton(
      definition.icon,
      definition.id,
      definition.label,
      () => actions.tool(definition.id),
      `tool-button${state.editorUi.tool === definition.id ? ' active' : ''}`,
    )
    tool.dataset.tool = definition.id
    tool.setAttribute('aria-pressed', String(state.editorUi.tool === definition.id))
    tool.append(element('span', 'editor-control-label', definition.shortLabel))
    choices.append(tool)
  }
  drawer.append(summary, choices)
  palette.append(drawer)
  return palette
}
