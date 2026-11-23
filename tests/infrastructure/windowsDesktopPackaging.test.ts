import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(
  readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as {
  identifier: string
  build: { frontendDist: string; devUrl?: string }
  bundle: { active: boolean }
  app: { windows: Array<{ maximized: boolean }> }
}

describe('portable Windows build contract', () => {
  it('embeds local Vite game assets instead of relying on a web server', () => {
    expect(config.build.frontendDist).toBe('../dist')
    expect(config.build.devUrl).toBeUndefined()
  })

  it('does not require an installer and preserves a stable profile between EXE upgrades', () => {
    expect(config.bundle.active).toBe(false)
    expect(config.identifier).toBe('io.trackforge.desktop')
    expect(config.app.windows[0]?.maximized).toBe(true)
  })
})
