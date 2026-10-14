/**
 * No test binds a stub server to a literal port. Farm rows run this suite in sibling worktrees at the
 * same time, and a fixed port is shared between those runs: the second stub cannot bind, so that run's
 * hook talks to the OTHER run's stub (a verdict it never set) or to nothing once that stub is killed.
 * Three concurrent runs on 2026-10-13 failed 4-19 judge tests each this way; a foreign listener on
 * judge-integration's old 18781 failed it alone. Let the server bind port 0 and announce it: startPyStub (tests/helpers/stub-server.ts), or `Bun.serve({ port: 0 })`. A freePort() that closes its socket before the server binds is the same race, so no such helper exists.
 */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = dirname(import.meta.dir)
const LITERAL_PORT = /\bport\s*[=:]\s*\d{4,5}\b|TCPServer\(\(\s*["'][\d.]+["']\s*,\s*\d{4,5}\s*\)/

test('no test file binds a stub server to a literal port', () => {
  const files = [...new Bun.Glob('{tests,skills,hooks,scripts}/**/*.test.{ts,mjs}').scanSync({ cwd: ROOT })]
    .filter(f => !f.includes('node_modules') && f !== 'tests/no-fixed-stub-ports.test.ts')
  expect(files.length).toBeGreaterThan(100)
  const hits: string[] = []
  for (const f of files)
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (LITERAL_PORT.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`)
    })
  expect(hits).toEqual([])
})
