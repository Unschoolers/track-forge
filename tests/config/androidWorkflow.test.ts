import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('builds Android artifacts for standalone pushes on any branch', () => {
  const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
  expect(workflow).toMatch(/\n {2}push:\s*\n {2}pull_request:/)
  expect(workflow).toContain('./gradlew assembleDebug')
  expect(workflow).toContain('actions/upload-artifact@')
})
