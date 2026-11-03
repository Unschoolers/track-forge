import type { AppSnapshot } from '@/application/appState'
import type { EditorTool } from '@/domain/editor/editorGeometry'
import { button, element } from '@/ui/dom'

const tools: readonly {
  readonly id: EditorTool
  readonly icon: string
  readonly label: string
}[] = [
  { id: 'draw', icon: '✎', label: 'Draw road' },
  { id: 'select', icon: '↖', label: 'Move points' },
  { id: 'start', icon: '⚑', label: 'Place start line' },
  { id: 'paint', icon: '▧', label: 'Paint surface' },
  { id: 'structure', icon: '↥', label: 'Paint structure' },
  { id: 'terrain', icon: '◒', label: 'Paint terrain' },
  { id: 'pan', icon: '✥', label: 'Pan map' },
  { id: 'tree', icon: '♣', label: 'Add trees' },
  { id: 'erase', icon: '⌫', label: 'Erase' },
]

export function createEditorToolPalette(
  state: Pick<AppSnapshot, 'editorUi'>,
  actions: { readonly tool: (tool: EditorTool) => void },
): HTMLElement {
  const palette = element('nav', 'tool-rail')
  palette.setAttribute('aria-label', 'Editor tools')

  for (const definition of tools) {
    const tool = button(
      definition.icon,
      definition.id,
      () => actions.tool(definition.id),
      `tool-button${state.editorUi.tool === definition.id ? ' active' : ''}`,
    )
    tool.dataset.tool = definition.id
    tool.title = definition.label
    tool.setAttribute('aria-label', definition.label)
    palette.append(tool)
  }

  return palette
}
