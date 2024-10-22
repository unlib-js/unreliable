import { readdir } from 'fs/promises'
import path from 'path/posix'


export const srcPrefix = './src/'

export const mods = (await readdir(srcPrefix))
  .filter(file => file.endsWith('.ts') && !file.includes('.test.'))
  .map(file => file.substring(0, file.length - '.ts'.length))

const entry = mods
  .map(mod => path.join(srcPrefix, `${mod}.ts`))

export default entry
