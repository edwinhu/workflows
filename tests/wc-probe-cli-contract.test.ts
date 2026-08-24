import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(import.meta.dir, '..', 'skills', 'workflow-creator', 'scripts', 'wc-probe.ts'), 'utf8')

// wc-probe's CLI contract is not this migration's to change. HEAD accepted no bare positional
// target; the round-1 diff added one and rewrote USAGE. Assert on booleans, never file text.
test('wc-probe still requires --target and accepts no bare positional', () => {
  expect(SRC.includes("!a.startsWith('-') && target === null")).toBe(false)
})

test('USAGE does not advertise an optional --target', () => {
  expect(SRC.includes('[--target] <dir>')).toBe(false)
})
