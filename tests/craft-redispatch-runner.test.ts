import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(import.meta.dir, '..', 'skills', 'craft', 'scripts', 'craft-redispatch.sh'), 'utf8')

// Assert on booleans, never on the file's text: a diff that dumps this script contains the
// words "not found", which craft's red-probe classifier reads as a missing command.
test('craft-redispatch resolves the runner to farm.sh', () => {
  expect(SRC.includes('farm-out/scripts/farm.ts')).toBe(false)
  expect(SRC.includes('farm-out/scripts/farm.sh')).toBe(true)
})

test('craft-redispatch invokes the runner with bash, not bun', () => {
  expect(SRC.includes('bun "$FARM"')).toBe(false)
  expect(SRC.includes('bash "$FARM"')).toBe(true)
})

test('no liveness check in craft-redispatch names a runner file', () => {
  const lines = SRC.split('\n').filter((l) => l.includes('result\\.json') || l.includes('farm-alive'))
  const offenders = lines.map((l) => l.replace(/\\/g, '')).filter((l) => l.includes('arm.ts') || l.includes('arm.sh')).length
  expect(offenders).toBe(0)
})
