import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/styles/race-menus.css', import.meta.url), 'utf8')

describe('track library layout styles', () => {
  it('keeps edit cards horizontal with useful preview width on narrow screens', () => {
    expect(css).toMatch(/\.track-library-modal \.track-card\.edit\s*\{[^}]*flex-direction:\s*row/)
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.track-library-modal \.track-card-select\s*\{[^}]*grid-template-columns:\s*minmax\(5rem,\s*\.8fr\) minmax\(0,\s*1\.2fr\)/)
  })

  it('lets reduced transparency override quality-specific translucent toolbar styles', () => {
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)[\s\S]*?\.track-library-modal\[data-graphics-quality\] \.track-library-toolbar\s*\{[^}]*background:\s*#202a36;[^}]*backdrop-filter:\s*none/)
  })
})
