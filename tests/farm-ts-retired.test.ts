import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')

test('farm.ts no longer exists', () => {
  expect(existsSync(join(ROOT, 'skills', 'farm-out', 'scripts', 'farm.ts'))).toBe(false)
})

test('no skill names farm.ts as a runnable path', () => {
  const res = spawnSync('rg', ['-n', '--no-heading', 'farm\\.ts', 'skills/'], { cwd: ROOT, encoding: 'utf8' })
  const hits = (res.stdout || '').trim().split('\n').filter(Boolean)
  expect(hits).toEqual([])
})
