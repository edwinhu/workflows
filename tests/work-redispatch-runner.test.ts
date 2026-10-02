import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-redispatch.sh'), 'utf8')

// Assert on booleans, never on the file's text: a diff that dumps this script contains the
// words "not found", which `work`'s red-probe classifier reads as a missing command.
test('work-redispatch resolves the runner to farm.sh', () => {
  expect(SRC.includes('farm-out/scripts/farm.ts')).toBe(false)
  expect(SRC.includes('farm-out/scripts/farm.sh')).toBe(true)
})

// The round itself runs in work-round.sh, so that is where the runner is invoked; redispatch hands
// it the runner path and launches it with bash.
const ROUND = readFileSync(join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-round.sh'), 'utf8')

test('work-redispatch invokes the runner with bash, not bun', () => {
  expect(SRC.includes('bun "$FARM"')).toBe(false)
  expect(SRC.includes('WORK_FARM="$FARM" bash "${WORK_ROUND:-$SKILL/scripts/work-round.sh}"')).toBe(true)
  expect(ROUND.includes('bun "$FARM"')).toBe(false)
  expect(ROUND.includes('bash "$FARM"')).toBe(true)
})

test('no liveness check in work-redispatch names a runner file', () => {
  const lines = SRC.split('\n').filter((l) => l.includes('result\\.json') || l.includes('farm-alive'))
  const offenders = lines.map((l) => l.replace(/\\/g, '')).filter((l) => l.includes('arm.ts') || l.includes('arm.sh')).length
  expect(offenders).toBe(0)
})
