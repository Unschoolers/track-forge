// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createMenuLayout, createMenuDock } from '@/ui/menu/menuLayout'
import { createMenuAction, createMenuChoices } from '@/ui/menu/menuControls'

describe('menu design system', () => {
  it('separates decorative media, scrollable content and actions, and defaults to a live-safe backdrop', () => {
    const layout = createMenuLayout()
    expect(layout.root.dataset.backdrop).toBe('live')
    expect(layout.media.getAttribute('aria-hidden')).toBe('true')
    expect(Array.from(layout.root.children)).toEqual([layout.media, layout.header, layout.content, layout.actions])
    const dock = createMenuDock('Race actions', 'clear')
    layout.actions.append(dock)
    expect(dock.getAttribute('aria-label')).toBe('Race actions')
    expect(dock.dataset.material).toBe('clear')
  })

  it('preserves action identity and native disabled behavior', () => {
    const click = vi.fn()
    const action = createMenuAction('Race', 'race', click, 'primary')
    expect(action.type).toBe('button')
    expect(action.dataset.action).toBe('race')
    action.click()
    action.disabled = true
    action.click()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('isolates radio groups, reports selected values and supports restoring committed state', () => {
    const change = vi.fn()
    const choices = [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }, { value: 'green', label: 'Green', disabled: true }] as const
    const first = createMenuChoices('Vehicle', choices, 'red', change)
    const second = createMenuChoices('Vehicle', choices, 'blue', vi.fn())
    const inputs = Array.from(first.element.querySelectorAll('input'))
    const red = inputs[0]
    const blue = inputs[1]
    const green = inputs[2]
    if (!red || !blue || !green) throw new Error('Missing radio inputs')
    expect(first.element.querySelector('legend')?.textContent).toBe('Vehicle')
    expect(red.checked).toBe(true)
    expect(red.name).not.toBe(second.element.querySelector('input')?.name)
    blue.click()
    expect(change).toHaveBeenLastCalledWith('blue')
    expect(blue.checked).toBe(true)
    expect(red.checked).toBe(false)
    first.setValue('red')
    expect(red.checked).toBe(true)
    green.click()
    expect(change).toHaveBeenCalledTimes(1)
    expect(green.checked).toBe(false)
    expect(() => createMenuChoices('Vehicle', [choices[0], choices[0]], 'red', vi.fn())).toThrow('Duplicate')
  })
})
