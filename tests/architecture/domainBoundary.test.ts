// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  createSourceFile, isExportDeclaration, isImportDeclaration, isStringLiteral,
  ScriptKind, ScriptTarget,
} from 'typescript'
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
    const source = createSourceFile(file, readFileSync(file, 'utf8'), ScriptTarget.Latest, true, ScriptKind.TS)
    for (const statement of source.statements) {
      if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue
      const specifier = statement.moduleSpecifier
      if (!specifier || !isStringLiteral(specifier)) continue
      const spec = specifier.text
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
