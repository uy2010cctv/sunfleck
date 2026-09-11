import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js'], outDir: 'lib', dts: false, format: 'esm',
  platform: 'node', target: 'es2024', fixedExtension: false, clean: ['lib/index.js'],
})
