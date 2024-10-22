import { defineConfig } from 'tsup'
import entry from './scripts/entry'


console.log('Entries:', entry)

export default defineConfig({
  entry,
  format: [ 'cjs', 'esm' ],
  dts: true,
  sourcemap: true,
  outDir: 'build',
  splitting: true
})
