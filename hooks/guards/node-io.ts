// GuardIO for the settings-hook scripts: node fs, process.env, process.cwd(). Never imported by
// the mod (a hooks module has no Node).
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { EnvName, GuardIO } from './core.ts'

export function nodeIO(): GuardIO {
  return {
    env: (name: EnvName) => process.env[name],
    cwd: process.cwd(),
    pluginRoot: resolve(import.meta.dir, '..', '..'),
    osTmpdir: tmpdir(),
    fallbackKey: String(process.ppid),
    nowMs: () => Date.now(),
    stat: async p => {
      try {
        const s = statSync(p)
        return { kind: s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other', size: s.size, mtimeMs: s.mtimeMs }
      } catch {
        return null
      }
    },
    read: async p => {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return null
      }
    },
    list: async p => {
      try {
        return readdirSync(p)
      } catch {
        return null
      }
    },
    write: async (p, text) => writeFileSync(p, text),
    append: async (p, text) => appendFileSync(p, text),
  }
}
