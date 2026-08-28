import { defineConfig } from 'tsdown'

export default defineConfig({ entry: ['src/index.ts', 'src/invariant.ts'], dts: false, format: 'esm' })
