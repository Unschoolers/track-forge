import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// QA code, test fixtures and documentation do not ship in the application.
const nonProductPath = /^(?:tests\/|qa\/|docs\/|README\.md$|playwright\.(?:mobile|production)\.config\.mjs$|android\/app\/src\/(?:test|androidTest)\/|src-tauri\/tests\/)/

// Only paths known to contain web content, tests, or documentation may skip
// native verification on PRs. Unknown paths intentionally require it.
export function requiresNative(paths) {
  return paths.length === 0 || paths.some((path) => !/^(?:src\/|public\/|tests\/|qa\/(?:browser|production)\/|playwright\.(?:mobile|production)\.config\.mjs$|docs\/|README\.md$|index\.html$|trackforge\.html$)/.test(path))
}

export function requiresRelease(paths) {
  return paths.some(path => !nonProductPath.test(path))
}

function changedPaths(baseSha, diff) {
  if (!/^[a-f0-9]{40}$/.test(baseSha ?? '') || /^0+$/.test(baseSha)) {
    throw new Error('A valid previous commit is required to determine changed paths.')
  }
  // Disabling rename detection checks both old and new names, including deletions.
  return diff('git', ['diff', '--no-renames', '--name-only', '-z', baseSha, 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  }).split('\0').filter(Boolean)
}

export function nativeRequired(eventName, baseSha, diff = execFileSync) {
  if (eventName !== 'pull_request') return true
  try {
    return requiresNative(changedPaths(baseSha, diff))
  } catch {
    // Missing history, oversized output, or any diff error must run native checks.
    return true
  }
}

// GitHub compare responses expose at most 300 changed files. Do not promote an
// older release if the comparison may be truncated or the commits diverged.
export function onlyNonProductChanges(comparison) {
  if (comparison?.status !== 'ahead' || !Array.isArray(comparison.files) || comparison.files.length >= 300) return false
  const paths = []
  for (const file of comparison.files) {
    if (typeof file.filename !== 'string' || !file.filename) return false
    paths.push(file.filename)
    if (file.status === 'renamed') {
      if (typeof file.previous_filename !== 'string' || !file.previous_filename) return false
      paths.push(file.previous_filename)
    }
  }
  return !requiresRelease(paths)
}

// Publication is a separate decision from verification. An uncertain push
// must fail visibly rather than accidentally publishing a test-only change.
export function buildPolicy(eventName, baseSha, diff = execFileSync) {
  if (eventName === 'pull_request') {
    return { native: nativeRequired(eventName, baseSha, diff), release: false }
  }
  if (eventName === 'workflow_dispatch') return { native: true, release: true }
  if (eventName !== 'push') throw new Error('Unsupported build event: ' + eventName)
  const paths = changedPaths(baseSha, diff)
  const release = requiresRelease(paths)
  return { native: release || paths.some(path => /^(?:android\/|src-tauri\/)/.test(path)), release }
}

if (process.argv[1]?.endsWith('/android-ci-native-required.mjs')) {
  if (process.argv[2] === 'compare') {
    console.log(onlyNonProductChanges(JSON.parse(readFileSync(process.argv[3], 'utf8'))))
  } else {
    const policy = buildPolicy(process.env.EVENT_NAME, process.env.BASE_SHA)
    console.log(`native=${policy.native}\nrelease=${policy.release}`)
  }
}
