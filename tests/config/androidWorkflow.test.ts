import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('builds Android artifacts for main pushes, pull requests, and manual runs', () => {
  const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
  expect(workflow).toMatch(/\n {2}push:\s*\n {4}branches: \[main\]\s*\n {2}pull_request:\s*\n {2}workflow_dispatch:/)
  expect(workflow).toContain('./gradlew testDebugUnitTest assembleDebug')
  expect(workflow).toContain('actions/upload-artifact@')
})
