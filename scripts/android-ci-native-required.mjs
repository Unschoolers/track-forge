import { execFileSync } from 'node:child_process'

// Only paths known to contain web content, tests, or documentation may skip
// native verification. New or ambiguous paths intentionally require it.
export function requiresNative(paths) {
  return paths.length === 0 || paths.some((path) => !/^(?:src\/|public\/|tests\/|qa\/(?:browser|production)\/|playwright\.(?:mobile|production)\.config\.mjs$|docs\/|README\.md$|index\.html$|trackforge\.html$)/.test(path))
}

export function nativeRequired(eventName, baseSha, diff = execFileSync) {
  if (eventName !== 'pull_request' || !/^[a-f0-9]{40}$/.test(baseSha ?? '')) return true
  try {
    // Disabling rename detection checks both old and new names, including deletions.
    const paths = diff('git', ['diff', '--no-renames', '--name-only', '-z', baseSha, 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
    }).split('\0').filter(Boolean)
    return requiresNative(paths)
  } catch {
    // Missing history, oversized output, or any diff error must run native checks.
    return true
  }
}

if (process.argv[1]?.endsWith('/android-ci-native-required.mjs')) {
  console.log(`native=${nativeRequired(process.env.EVENT_NAME, process.env.BASE_SHA)}`)
}
