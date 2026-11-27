import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/styles/track-library.css', import.meta.url), 'utf8')

describe('track library layout styles', () => {
  it('keeps two compact cards per row on narrow screens with readable previews and touch controls', () => {
    expect(css).toMatch(/\.track-library-modal \.track-card\.edit\s*\{[^}]*flex-direction:\s*row/)
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.track-library-modal \.track-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.track-library-modal \.track-card-select\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*padding:\s*3\.15rem/)
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.track-library-modal \.track-preview\s*\{[^}]*height:\s*4\.25rem/)
    expect(css).toMatch(/\.track-card-favorite,[\s\S]*?\.track-menu-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/)
  })

  it('lets reduced transparency override quality-specific translucent toolbar styles', () => {
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)[\s\S]*?\.track-library-modal\[data-graphics-quality\] \.track-library-toolbar\s*\{[^}]*background:\s*#202a36;[^}]*backdrop-filter:\s*none/)
  })
})
