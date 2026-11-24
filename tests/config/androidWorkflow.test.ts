import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildPolicy, nativeRequired, onlyNonProductChanges, requiresNative, requiresRelease } from '../../scripts/android-ci-native-required.mjs'

const baseSha = 'a'.repeat(40)

describe('Android CI selection', () => {
  it('skips native only for known web, test, and documentation paths', () => {
    expect(requiresNative(['src/game.ts', 'public/icon.png', 'tests/game.test.ts', 'docs/guide.md'])).toBe(false)
    for (const path of ['android/app/build.gradle', 'package.json', 'package-lock.json', 'capacitor.config.json', 'vite.config.ts', 'scripts/build.mjs', '.github/workflows/build.yml', 'new-directory/file']) {
      expect(requiresNative([path]), path).toBe(true)
    }
    expect(requiresNative([])).toBe(true)
  })

  it('does not trigger native compilation for browser-only QA and configuration changes', () => {
    const webAndQa = ['src/ui/components/raceFlyover.ts', 'tests/ui/raceFlyoverRenderer.test.ts',
      'qa/browser/race-picker.spec.mjs', 'qa/production/race-start.spec.mjs',
      'playwright.mobile.config.mjs', 'playwright.production.config.mjs']
    expect(requiresNative(webAndQa)).toBe(false)
    for (const path of ['android/app/src/main/AndroidManifest.xml', 'src-tauri/Cargo.toml',
      'scripts/android-ci-native-required.mjs', 'qa/unknown/build.mjs',
      'playwright.mobile.config.mjs.backup', '.github/workflows/build.yml', 'package-lock.json']) {
      expect(requiresNative([...webAndQa, path]), path).toBe(true)
    }
  })

  it('keeps the PR native fallback for invalid bases or failed diffs', () => {
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

describe('Main release eligibility', () => {
  const testPaths = ['tests/ui/a.test.ts', 'qa/browser/a.spec.mjs', 'qa/production/a.spec.mjs',
    'qa/lanes/fixture.json', 'docs/testing-guidelines.md', 'README.md', 'playwright.mobile.config.mjs']
  const diffOf = (paths: string[]) => () => paths.join('\0') + '\0'

  it('verifies test/docs-only and empty main pushes without releasing', () => {
    expect(buildPolicy('push', baseSha, diffOf(testPaths))).toEqual({ native: false, release: false })
    expect(buildPolicy('push', baseSha, diffOf([]))).toEqual({ native: false, release: false })
    expect(requiresRelease(testPaths)).toBe(false)
  })

  it('verifies CI changes without publishing a new game version', () => {
    expect(buildPolicy('push', baseSha, diffOf([...testPaths, '.github/workflows/build.yml',
      'scripts/android-ci-native-required.mjs'])))
      .toEqual({ native: true, release: false })
    expect(requiresRelease(['.github/workflows/build.yml', 'scripts/android-ci-native-required.mjs'])).toBe(false)
  })

  it('runs native tests without publishing when only native tests change', () => {
    expect(buildPolicy('push', baseSha, diffOf(['android/app/src/test/a.java', 'src-tauri/tests/a.rs'])))
      .toEqual({ native: true, release: false })
  })

  it.each(['src/ui/game.ts', 'public/icon.png', 'package-lock.json', 'android/app/build.gradle',
    'src-tauri/src/main.rs', 'scripts/android-build-policy.mjs', 'unknown/new-file'])(
    'releases product or packaging changes alongside tests: %s', path => {
      expect(buildPolicy('push', baseSha, diffOf([...testPaths, path]))).toEqual({ native: true, release: true })
    })

  it('does not release a PR, including an unknown or failing diff, and permits explicit manual builds', () => {
    expect(buildPolicy('pull_request', baseSha, diffOf(['src/game.ts']))).toEqual({ native: false, release: false })
    expect(buildPolicy('pull_request', baseSha, () => { throw new Error('missing base') }))
      .toEqual({ native: true, release: false })
    expect(buildPolicy('workflow_dispatch', '')).toEqual({ native: true, release: true })
  })

  it('allows an in-flight verified release to remain latest after test-only commits', () => {
    const testFile = { filename: 'tests/ui/a.test.ts', status: 'modified' }
    const comparison = { status: 'ahead', files: [testFile] }
    expect(onlyNonProductChanges(comparison)).toBe(true)
    expect(onlyNonProductChanges({ ...comparison, files: [] })).toBe(true)
    expect(onlyNonProductChanges({ ...comparison, status: 'diverged' })).toBe(false)
    expect(onlyNonProductChanges({ ...comparison, files: undefined })).toBe(false)
    expect(onlyNonProductChanges({ ...comparison, files: Array.from({ length: 300 }, () => testFile) })).toBe(false)
    expect(onlyNonProductChanges({ ...comparison, files: [testFile, { filename: 'src/game.ts' }] })).toBe(false)
    expect(onlyNonProductChanges({ ...comparison, files: [
      { filename: 'tests/game.ts', status: 'renamed', previous_filename: 'src/game.ts' },
    ] })).toBe(false)
    expect(onlyNonProductChanges({ ...comparison, files: [
      { filename: 'tests/game.ts', status: 'renamed' },
    ] })).toBe(false)
  })

  it('fails visibly instead of publishing when the previous main revision cannot be resolved', () => {
    expect(() => buildPolicy('push', '0'.repeat(40), diffOf(testPaths))).toThrow()
    expect(() => buildPolicy('push', baseSha, () => { throw new Error('missing base') })).toThrow('missing base')
  })
})

it('keeps full web checks and gates publishing on Android, JavaScript, and Windows verification', () => {
  const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
  expect(workflow).toMatch(/\n {2}push:\s*\n {4}branches: \[main\]\s*\n {2}pull_request:\s*\n {2}workflow_dispatch:/)
  expect(workflow.match(/npm run build/g)).toHaveLength(1)
  expect(workflow.match(/npm run test:fast -- --maxWorkers=4/g)).toHaveLength(1)
  expect(workflow.match(/npm run test:ai:matrix/g)).toHaveLength(1)
  expect(workflow.match(/npm run lint/g)).toHaveLength(1)
  expect(workflow).toContain('needs: [web-build, android, verify, windows, ai-matrix]')
  expect(workflow).toContain("needs.web-build.outputs.release == 'true'")
  expect(workflow).toContain('github.event.pull_request.number || github.run_id')
  expect(workflow).toContain('group: android-release-main')
  expect(workflow).toContain('github.event.pull_request.base.sha || github.event.before')
  expect(workflow).toContain("if: needs.web-build.outputs.native != 'false'")
  expect(workflow).toContain('artifact-ids: ${{ needs.web-build.outputs.web_artifact_id }}')
  expect(workflow).toContain('./gradlew testDebugUnitTest assembleDebug')
  expect(workflow).toContain('Nearby LAN multiplayer supports Windows and Android')
  expect(workflow).toContain('GitHub release-notes API failed after three attempts.')
  expect(workflow).toContain('GitHub release creation failed after three attempts.')
  expect(workflow).toContain('runs-on: windows-latest')
  expect(workflow).toContain('cargo build --manifest-path src-tauri/Cargo.toml --release')
  expect(workflow).toContain('artifact-ids: ${{ needs.windows.outputs.exe_artifact_id }}')
  expect(workflow).toContain('gh release create "$tag" trackforge-debug.apk windows-exe/TrackForge.exe')

  expect(workflow).toContain('actions/upload-artifact@')
})
