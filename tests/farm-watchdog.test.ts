import { test, expect, setDefaultTimeout } from 'bun:test'
import { writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(30_000)

const WATCHDOG = join(import.meta.dir, '..', 'skills', 'farm-out', 'scripts', 'watchdog.py')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const msg = (id: string, text: string, out: number) => JSON.stringify({
  type: 'assistant',
  message: { id, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: out } },
})

/** Run watchdog.py against a log the "child" is still writing; the child is `sleep` and exits after lifeSec. */
async function run(log: string, steps: Array<[number, Buffer]>, lifeSec: number, budget = 0, maxTurns = 0) {
  const child = Bun.spawn(['sleep', String(lifeSec)])
  const wd = Bun.spawn(['python3', WATCHDOG, String(child.pid), log, String(budget), String(maxTurns)],
    { stdout: 'pipe', stderr: 'pipe' })
  for (const [delay, chunk] of steps) { await sleep(delay); appendFileSync(log, chunk) }
  const [out, err, code] = await Promise.all([new Response(wd.stdout).text(), new Response(wd.stderr).text(), wd.exited])
  return { out, err, code }
}

test('a read landing mid-UTF-8-character or mid-JSON does not crash the watchdog or lose the line', async () => {
  const log = join(mkTmp('farm-wd-'), 'stream.log')
  writeFileSync(log, '')
  const a = Buffer.from(msg('m1', 'first', 1) + '\n')
  const b = Buffer.from(msg('m2', 'em dash — and “quotes”', 2) + '\n')
  const cut = b.indexOf(0xe2) + 1            // inside the 3-byte '—'
  const jsonCut = b.indexOf(Buffer.from('"usage"')) // mid-JSON, after the dash
  const c = Buffer.from(msg('m3', 'tail', 3))  // final line, no trailing newline
  const r = await run(log, [
    [300, Buffer.concat([a, b.subarray(0, cut)])],
    [600, b.subarray(cut, jsonCut)],
    [600, Buffer.concat([b.subarray(jsonCut), c])],
  ], 3)
  expect(r.err).toBe('')
  expect(r.code).toBe(0)
  // m1: 10+5*1, m2: 10+5*2, m3: 10+5*3 (the unterminated final line is drained on exit)
  expect(JSON.parse(r.out)).toEqual({ tokensW: 15 + 20 + 25, turns: 3, budgetExceeded: false })
})

test('the turn cap still kills the child', async () => {
  const log = join(mkTmp('farm-wd-'), 'stream.log')
  writeFileSync(log, [msg('a', 'x', 1), msg('b', 'y', 1), msg('c', 'z', 1)].join('\n') + '\n')
  const r = await run(log, [], 20, 0, 2)
  expect(r.code).toBe(0)
  expect(JSON.parse(r.out).budgetExceeded).toBe(true)
})
