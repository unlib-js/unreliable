import { readFile, writeFile } from 'fs/promises'
import path from 'path/posix'
import { mods } from './entry'


interface PkgJson {
  exports: Record<string, {
    types: string
    import: string
    require: string
  }>
}

function modPath(builtMod: string) {
  const relPath = path.join('./build', builtMod)
  return relPath.startsWith('./') ? relPath : `./${relPath}`
}

async function main() {
  const pkgJson = JSON.parse(await readFile('package.json', 'utf-8')) as PkgJson
  pkgJson.exports = {
    '.': {
      types: './build/index.d.ts',
      import: './build/index.js',
      require: './build/index.cjs'
    }
  }
  for (const mod of mods) {
    pkgJson.exports[`./${mod}`] = {
      types: modPath(`${mod}.d.ts`),
      import: modPath(`${mod}.js`),
      require: modPath(`${mod}.cjs`)
    }
  }
  delete pkgJson.exports['./index']
  await writeFile('package.json', JSON.stringify(pkgJson, null, 2) + '\n')
  console.log('package.json updated')
}

await main()

export default null
