// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? typescriptFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

/** The application may use domain; domain must depend on neither host nor adapters. */
it.each(['domain', 'application'] as const)('keeps %s imports within their intended layers', layer => {
  const sourceRoot = resolve('src')
  const layerRoot = resolve(sourceRoot, layer)
  const domainRoot = resolve(sourceRoot, 'domain')
  const allowedRoots = layer === 'domain' ? [domainRoot] : [domainRoot, layerRoot]
  const violations: string[] = []
  const files = typescriptFiles(layerRoot)
  expect(files.length).toBeGreaterThan(0)

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    // TypeScript 7 uses the native compiler and no longer exports the old JS AST API.
    // Scan static paths in import/export/from and literal dynamic imports.
    const specifiers = [...content.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['\"]([^'\"]+)['\"]/g)]
    for (const match of specifiers) {
      const spec = match[1]
      if (!spec) continue
      const target = spec.startsWith('@/') ? resolve(sourceRoot, spec.slice(2))
        : spec.startsWith('.') ? resolve(dirname(file), spec) : null
      if (!target || !target.startsWith(sourceRoot + sep)) continue
      if (!allowedRoots.some(root => target === root || target.startsWith(root + sep))) {
        violations.push(`${relative(sourceRoot, file)} imports ${spec}`)
      }
    }
  }
  expect(violations).toEqual([])
})
