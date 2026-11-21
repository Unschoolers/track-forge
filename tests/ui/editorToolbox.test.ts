// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '@/application/appState'
import { createEditorState } from '@/domain/editor/editorState'
import { createEditorToolPalette } from '@/ui/editor/editorToolPalette'
import { createEditorHistoryActions, createEditorTrackActions } from '@/ui/editor/editorFrameControls'

const editor = createEditorState([], [])
const editorUi: AppSnapshot['editorUi'] = {
  tool: 'draw',
  surface: 'street',
  structure: 'surface',
  terrainBrush: { mode: 'ground', radius: 96 },
  grid: false,
  cameraRequest: null,
  selectedCrossing: null,
  selectedPoint: null,
}

describe('editor mobile toolbox', () => {
  it('identifies the active tool and gives every action an on-screen text label', () => {
    const onTool = vi.fn()
    const palette = createEditorToolPalette({ editor, editorUi }, { tool: onTool })
    expect(palette.querySelector('details')?.open).toBe(false)
    expect(palette.querySelector('summary')?.textContent).toContain('Road')
    const controls = palette.querySelectorAll<HTMLButtonElement>('.tool-button')
    expect(controls).toHaveLength(11)
    for (const control of controls) {
      expect(control.querySelector('.editor-control-label')?.textContent?.length).toBeGreaterThan(0)
      expect(control.getAttribute('aria-label')).toBeTruthy()
    }
    expect(palette.querySelector('[data-tool="draw"]')?.getAttribute('aria-pressed')).toBe('true')
    palette.querySelector<HTMLButtonElement>('[data-tool="insert"]')?.click()
    expect(onTool).toHaveBeenCalledWith('insert')
    palette.querySelector<HTMLButtonElement>('[data-tool="tree"]')?.click()
    expect(onTool).toHaveBeenCalledWith('tree')
  })

  it('retains undo/redo and groups view commands in a discoverable menu', () => {
    const camera = vi.fn()
    const edit = vi.fn()
    const toggleGrid = vi.fn()
    const history = createEditorHistoryActions({ editorUi }, { camera, edit, toggleGrid })
    expect(history.querySelector('[data-action="undo"]')?.textContent).toContain('Undo')
    expect(history.querySelector('[data-action="redo"]')?.textContent).toContain('Redo')
    expect(history.querySelector('summary')?.textContent).toContain('VIEW')
    for (const control of history.querySelectorAll('.editor-view-items button')) {
      expect(control.querySelector('.editor-action-label')?.textContent).toBeTruthy()
    }
    history.querySelector<HTMLButtonElement>('[data-action="fit-track"]')?.click()
    expect(camera).toHaveBeenCalledWith('fit')
  })

  it('labels save, clear, load and race actions without changing their dispatch', () => {
    const save = vi.fn()
    const load = vi.fn()
    const race = vi.fn()
    const edit = vi.fn()
    const controls = createEditorTrackActions({ save, load, race, edit })
    const labels = [...controls.querySelectorAll('.editor-action-label')].map((el) => el.textContent)
    expect(labels).toEqual(['Save', 'Clear', 'Open', 'Race'])
    controls.querySelector<HTMLButtonElement>('[data-action="save-track"]')?.click()
    controls.querySelector<HTMLButtonElement>('[data-action="clear-track"]')?.click()
    controls.querySelector<HTMLButtonElement>('[data-action="load-track"]')?.click()
    controls.querySelector<HTMLButtonElement>('[data-action="editor-race"]')?.click()
    expect(save).toHaveBeenCalledOnce()
    expect(edit).toHaveBeenCalledWith({ type: 'clear' })
    expect(load).toHaveBeenCalledOnce()
    expect(race).toHaveBeenCalledOnce()
  })
})
