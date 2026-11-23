import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('decodes native LAN frames on Android versions below API 33', () => {
  const plugin = readFileSync(new URL('../../android/app/src/main/java/io/trackforge/app/LanRacePlugin.java', import.meta.url), 'utf8')
  // ByteArrayOutputStream.toString(Charset) was introduced in Android API 33,
  // but TrackForge supports Android API 24 and newer.
  expect(plugin).not.toContain('buffer.toString(StandardCharsets.UTF_8)')
  expect(plugin).toContain('new String(buffer.toByteArray(), StandardCharsets.UTF_8)')
})
