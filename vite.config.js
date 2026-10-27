import { defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` sets SINGLEFILE=1 to inline all JS/CSS/assets into index.html.
const singleFile = process.env.SINGLEFILE === '1'

export default defineConfig({
  plugins: singleFile ? [viteSingleFile()] : [],
  build: {
    target: 'es2022',
    // Fonts/icons must inline in the single-file build.
    assetsInlineLimit: singleFile ? Number.MAX_SAFE_INTEGER : 4096,
  },
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
})
