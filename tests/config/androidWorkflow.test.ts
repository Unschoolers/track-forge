import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { nativeRequired, requiresNative } from '../../scripts/android-ci-native-required.mjs'

const baseSha = 'a'.repeat(40)

describe('Android CI selection', () => {
  it('skips native only for known web, test, and documentation paths', () => {
    expect(requiresNative(['src/game.ts', 'public/icon.png', 'tests/game.test.ts', 'docs/guide.md'])).toBe(false)
    for (const path of ['android/app/build.gradle', 'package.json', 'package-lock.json', 'capacitor.config.json', 'vite.config.ts', 'scripts/build.mjs', '.github/workflows/build.yml', 'new-directory/file']) {
      expect(requiresNative([path]), path).toBe(true)
    }
    expect(requiresNative([])).toBe(true)
  })

  it('always runs native on main and manual runs, invalid bases, or failed diffs', () => {
    expect(nativeRequired('push', baseSha)).toBe(true)
    expect(nativeRequired('workflow_dispatch', baseSha)).toBe(true)
    expect(nativeRequired('pull_request', 'invalid')).toBe(true)
    expect(nativeRequired('pull_request', baseSha, () => { throw new Error('missing base') })).toBe(true)
  })

  it('checks both names of renamed files and handles NUL-delimited names', () => {
    const diff = vi.fn(() => 'src/old name.ts\0android/new name.ts\0')
    expect(nativeRequired('pull_request', baseSha, diff)).toBe(true)
    expect(diff).toHaveBeenCalledWith('git', ['diff', '--no-renames', '--name-only', '-z', baseSha, 'HEAD'], expect.any(Object))
    expect(nativeRequired('pull_request', baseSha, () => 'src/a.ts\0')).toBe(false)
  })
})

it('keeps full web checks and gates publishing on Android, JavaScript, and Windows verification', () => {
  const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
  expect(workflow).toMatch(/\n {2}push:\s*\n {4}branches: \[main\]\s*\n {2}pull_request:\s*\n {2}workflow_dispatch:/)
  expect(workflow.match(/npm run build/g)).toHaveLength(1)
  expect(workflow.match(/npm test -- --maxWorkers=4/g)).toHaveLength(1)
  expect(workflow.match(/npm run lint/g)).toHaveLength(1)
  expect(workflow).toContain('needs: [android, verify, windows]')
  expect(workflow).toContain("if: needs.web-build.outputs.native != 'false'")
  expect(workflow).toContain('artifact-ids: ${{ needs.web-build.outputs.web_artifact_id }}')
  expect(workflow).toContain('./gradlew testDebugUnitTest assembleDebug')
  expect(workflow).toContain('runs-on: windows-latest')
  expect(workflow).toContain('cargo build --manifest-path src-tauri/Cargo.toml --release')
  expect(workflow).toContain('artifact-ids: ${{ needs.windows.outputs.exe_artifact_id }}')
  expect(workflow).toContain('gh release create "$tag" trackforge-debug.apk windows-exe/TrackForge.exe')

  expect(workflow).toContain('actions/upload-artifact@')
})
