import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps native LAN ports, framing, and decoded packet bounds in sync', () => {
  const rust = readFileSync(new URL('../../src-tauri/src/lan.rs', import.meta.url), 'utf8')
  const java = readFileSync(new URL('../../android/app/src/main/java/io/trackforge/app/LanRacePlugin.java', import.meta.url), 'utf8')
  for (const body of [rust, java]) {
    expect(body).toMatch(/DISCOVERY_PORT(?:: u16)?\s*=\s*47831/)
    expect(body).toMatch(/RACE_PORT(?:: u16)?\s*=\s*47832/)
    expect(body).toMatch(/MAX_PAYLOAD(?:: usize)?\s*=\s*16_003/)
    expect(body).toContain('TF_LAN_1_SCAN')
    expect(body).toContain('TF_LAN_1|')
  }
})
