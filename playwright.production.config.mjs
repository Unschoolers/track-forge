import { defineConfig } from '@playwright/test'
import mobile from './playwright.mobile.config.mjs'

const baseURL = 'http://127.0.0.1:4175'

export default defineConfig({
  ...mobile,
  testDir: './qa/production',
  outputDir: './test-results/production',
  reporter: 'list',
  use: { ...mobile.use, baseURL },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175 --strictPort',
    url: baseURL,
    timeout: 120_000,
  },
})
