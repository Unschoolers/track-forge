import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('gives the game canvas the entire landscape desktop window', () => {
  const css = readFileSync(new URL('../../src/styles/layout.css', import.meta.url), 'utf8')
  expect(css).toMatch(/html, body, #app \{[^}]*width: 100%;[^}]*height: 100%/)
  expect(css).toMatch(/#game-container \{[^}]*inset: 0/)
  expect(css).not.toMatch(/#app\s*\{[^}]*max-width\s*:/)
})
