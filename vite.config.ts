import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: process.env.AI_BENCHMARK === '1'
      ? ['qa/lanes/*.benchmark.ts']
      : ['tests/**/*.test.ts'],
  },
  build: {
    target: 'es2023',
    // Phaser is a substantial engine dependency; this limit still flags
    // unexpected growth above the known engine-inclusive application bundle.
    chunkSizeWarningLimit: 1500,
  },
})
