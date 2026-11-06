import type { AppSnapshot } from '@/application/appState'
import type { EditorTool } from '@/domain/editor/editorGeometry'
import { element } from '@/ui/dom'
import { editorIconButton, type EditorIcon } from '@/ui/editor/editorIcons'

const tools: readonly {
  readonly id: EditorTool
  readonly icon: EditorIcon
  readonly label: string
}[] = [
  { id: 'draw', icon: 'draw', label: 'Draw road' },
  { id: 'select', icon: 'select', label: 'Move points' },
  { id: 'start', icon: 'start', label: 'Place start line' },
  { id: 'paint', icon: 'paint', label: 'Paint surface' },
  { id: 'structure', icon: 'structure', label: 'Paint structure' },
  { id: 'terrain', icon: 'terrain', label: 'Paint terrain' },
  { id: 'pan', icon: 'pan', label: 'Pan map' },
  { id: 'tree', icon: 'tree', label: 'Add trees' },
  { id: 'erase', icon: 'erase', label: 'Erase' },
]

export function createEditorToolPalette(
  state: Pick<AppSnapshot, 'editorUi'>,
  actions: { readonly tool: (tool: EditorTool) => void },
): HTMLElement {
  const palette = element('nav', 'tool-rail')
  palette.setAttribute('aria-label', 'Editor tools')

  for (const definition of tools) {
    const tool = editorIconButton(
      definition.icon,
      definition.id,
      definition.label,
      () => actions.tool(definition.id),
      `tool-button${state.editorUi.tool === definition.id ? ' active' : ''}`,
    )
    tool.dataset.tool = definition.id
    if (definition.id === 'pan') tool.classList.add('desktop-pan-tool')
    tool.title = definition.label
    tool.setAttribute('aria-label', definition.label)
    palette.append(tool)
  }

  return palette
}
