import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps discovery lock lifecycle paired with the permission and closes it on exit', () => {
  const root = new URL('../../', import.meta.url)
  const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', root), 'utf8')
  const java = readFileSync(new URL('android/app/src/main/java/io/trackforge/app/LanRacePlugin.java', root), 'utf8')
  const rust = readFileSync(new URL('src-tauri/src/lan.rs', root), 'utf8')
  expect(manifest).toContain('android.permission.CHANGE_WIFI_MULTICAST_STATE')
  expect(java).toContain('wifiDiscoveryLock.release()')
  expect(java).toContain('acquireWifiDiscoveryLock();')
  expect(java).toContain('public void connectDirect(PluginCall call)')
  expect(rust).toContain('pub fn lan_connect_direct(')
})
