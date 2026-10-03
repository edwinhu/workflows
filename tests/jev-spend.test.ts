import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { chmodSync, existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'
import { parseLog, render, summarize } from '../scripts/jev-spend.ts'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

/**
 * The Jev spend log and reply cache in hooks/work-hold.ts decisionsCall (2026-10-03). Every caller
 * runs as an ASYNC child: decisionsCall blocks on spawnSync, so an in-process call would wait on the
 * event loop serving its own stub.
 */

const ROOT = join(import.meta.dir, '..')
const USAGE = { input_tokens: 1234, output_tokens: 32, cost: 0.0000518 }

function serve(reply: (body: any) => { status: number; body: unknown }) {
  const seen: any[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text())
      seen.push({ body, auth: req.headers.get('authorization') })
      const r = reply(body)
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
    },
  })
  return { server, seen, url: `http://127.0.0.1:${server.port}` }
}

const answerAll = (b: any) => ({
  status: 200,
  body: {
    answers: Object.fromEntries(Object.keys(b.questions).map(k => [k, { type: 'noul', noul: 0.3 }])),
    usage: USAGE,
  },
})

async function run(cmd: string[], env: Record<string, string>) {
  const p = Bun.spawn(cmd, { cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, out, err }
}

const envFor = (dir: string, url: string, extra: Record<string, string> = {}) => ({
  ...HERMETIC_ENV,
  TMPDIR: dir,
  XDG_RUNTIME_DIR: '/nonexistent-so-no-agenix-key',
  WORK_HOLD_JUDGE_TOKEN: 'test-token-not-a-secret',
  WORK_HOLD_DECISIONS_URL: url,
  JEV_CALL_LOG: join(dir, 'jev-calls.ndjson'),
  JEV_CACHE: 'on',
  JEV_CACHE_DIR: join(dir, 'jev-cache'),
  // a broken default must land here, never in the user's ~/.cache or ~/.local/state
  XDG_CACHE_HOME: join(dir, 'xdg-cache'),
  XDG_STATE_HOME: join(dir, 'xdg-state'),
  ...extra,
})

const call = (env: Record<string, string>, state = 'S', qs = 1, opts = '{ caller: "t-caller", session: "s1" }') =>
  run(['bun', '-e', `import { decisionsCall } from './hooks/work-hold.ts'; ` +
    `const q = Object.fromEntries(Array.from({ length: ${qs} }, (_, i) => ['q' + i, { type: 'noul', instructions: 'x' + i }])); ` +
    `console.log(JSON.stringify(decisionsCall(${JSON.stringify(state)}, q, ${opts})))`], env)

// Everything under dir except bun's own transpiler cache, which follows XDG_CACHE_HOME.
const jevFiles = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).filter(f => !/^xdg-cache\/bun\b|^xdg-cache$/.test(f))

const logOf = (dir: string) => parseLog(readFileSync(join(dir, 'jev-calls.ndjson'), 'utf8')) as any[]

describe('the call log', () => {
  test('one line per call: caller, session, state bytes, questions, and the reply usage', async () => {
    const dir = mkTmp('jev-log-')
    const s = serve(answerAll)
    try {
      const r = await call(envFor(dir, s.url), 'hello state', 3)
      expect(JSON.parse(r.out).unavailable).toBeNull()
      const [rec] = logOf(dir)
      expect(rec).toMatchObject({
        caller: 't-caller', session: 's1', stateBytes: 11, questions: 3, cache: 'miss', status: 200,
        inTokens: 1234, outTokens: 32, cost: 0.0000518,
      })
    } finally {
      s.server.stop(true)
    }
  })

  test('the caller defaults to $JEV_CALLER, then the script name', async () => {
    const dir = mkTmp('jev-log-')
    const s = serve(answerAll)
    try {
      await call(envFor(dir, s.url, { JEV_CALLER: 'from-env' }), 'a', 1, '{}')
      await call(envFor(dir, s.url), 'b', 1, '{}')
      const [a, b] = logOf(dir).map(r => r.caller)
      expect(a).toBe('from-env')
      expect(b).not.toBe('from-env')
      expect(b.length).toBeGreaterThan(0)
    } finally {
      s.server.stop(true)
    }
  })

  test('against a stub URL with no JEV_CALL_LOG, nothing is logged or cached', async () => {
    const dir = mkTmp('jev-log-')
    const s = serve(answerAll)
    try {
      const env = envFor(dir, s.url)
      delete (env as any).JEV_CALL_LOG
      delete (env as any).JEV_CACHE
      delete (env as any).JEV_CACHE_DIR
      await call(env)
      await call(env)
      expect(s.seen.length).toBe(2)
      expect(jevFiles(dir)).toEqual([])
    } finally {
      s.server.stop(true)
    }
  })

  test('JEV_CALL_LOG=off writes nothing', async () => {
    const dir = mkTmp('jev-log-')
    const s = serve(answerAll)
    try {
      await call(envFor(dir, s.url, { JEV_CALL_LOG: 'off', JEV_CACHE: 'off' }))
      expect(jevFiles(dir)).toEqual([])
    } finally {
      s.server.stop(true)
    }
  })
})

test('the defaults are machine-wide, not $TMPDIR: XDG state for the log, XDG cache for replies', async () => {
  const dir = mkTmp('jev-paths-')
  const env: Record<string, string> = { ...HERMETIC_ENV, TMPDIR: join(dir, 'per-run-tmp'), XDG_STATE_HOME: join(dir, 's'), XDG_CACHE_HOME: join(dir, 'c') }
  for (const k of ['WORK_HOLD_DECISIONS_URL', 'JEV_CALL_LOG', 'JEV_CACHE', 'JEV_CACHE_DIR']) delete env[k]
  const r = await run(['bun', '-e', `import { jevCallLogPath, jevCacheDir } from './hooks/work-hold.ts'; console.log(JSON.stringify([jevCallLogPath(), jevCacheDir()]))`], env)
  expect(JSON.parse(r.out)).toEqual([join(dir, 's/jev/calls.ndjson'), join(dir, 'c/jev')])
})

describe('the reply cache', () => {
  test('an identical request is answered from the cache, unbilled, and logs what it saved', async () => {
    const dir = mkTmp('jev-cache-')
    const s = serve(answerAll)
    try {
      const a = await call(envFor(dir, s.url))
      const b = await call(envFor(dir, s.url))
      expect(s.seen.length).toBe(1)
      expect(JSON.parse(b.out)).toEqual(JSON.parse(a.out))
      const log = logOf(dir)
      expect(log.map(r => r.cache)).toEqual(['miss', 'hit'])
      expect(log[1]).toMatchObject({ cost: 0, saved: 0.0000518 })
    } finally {
      s.server.stop(true)
    }
  })

  test('a different state, question set or model is asked again', async () => {
    const dir = mkTmp('jev-cache-')
    const s = serve(answerAll)
    try {
      await call(envFor(dir, s.url), 'one')
      await call(envFor(dir, s.url), 'two')
      await call(envFor(dir, s.url), 'one', 2)
      await call(envFor(dir, s.url, { WORK_HOLD_DECISIONS_MODEL: 'typesafe/other' }), 'one')
      expect(s.seen.length).toBe(4)
    } finally {
      s.server.stop(true)
    }
  })

  test('an entry older than JEV_CACHE_TTL is asked again', async () => {
    const dir = mkTmp('jev-cache-')
    const s = serve(answerAll)
    try {
      await call(envFor(dir, s.url, { JEV_CACHE_TTL: '60' }))
      const cdir = join(dir, 'jev-cache')
      for (const f of readdirSync(cdir)) utimesSync(join(cdir, f), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
      await call(envFor(dir, s.url, { JEV_CACHE_TTL: '60' }))
      expect(s.seen.length).toBe(2)
    } finally {
      s.server.stop(true)
    }
  })

  test('a partial reply, an error body and a 402 are never replayed', async () => {
    for (const reply of [
      (b: any) => ({ status: 200, body: { answers: { q0: { type: 'noul', noul: 0.4 } }, usage: USAGE } }),
      () => ({ status: 500, body: { error: { code: 500, message: 'boom' } } }),
      () => ({ status: 402, body: { error: { code: 402, message: 'Insufficient credits' } } }),
    ]) {
      const dir = mkTmp('jev-cache-')
      const s = serve(reply)
      try {
        await call(envFor(dir, s.url), 'S', 2)
        await call(envFor(dir, s.url), 'S', 2)
        expect(s.seen.length).toBe(2)
      } finally {
        s.server.stop(true)
      }
    }
  })

  test('cache: false (rule-calibrate) neither reads nor writes it', async () => {
    const dir = mkTmp('jev-cache-')
    const s = serve(answerAll)
    try {
      await call(envFor(dir, s.url))
      await call(envFor(dir, s.url), 'S', 1, '{ cache: false }')
      await call(envFor(dir, s.url), 'T', 1, '{ cache: false }')
      await call(envFor(dir, s.url), 'T', 1, '{ cache: false }')
      expect(s.seen.length).toBe(4)
      expect(logOf(dir).map(r => r.cache)).toEqual(['miss', 'off', 'off', 'off'])
    } finally {
      s.server.stop(true)
    }
  })

  test('rule-calibrate re-asks every job on every run: its spread is the measurement', async () => {
    const dir = mkTmp('jev-cache-')
    const s = serve(b => ({
      status: 200,
      body: { answers: Object.fromEntries(Object.keys(b.questions).map(k => [k, { type: 'choice', choice: 'MET', probabilities: { VIOLATED: 0.2, MET: 0.8 } }])), usage: USAGE },
    }))
    try {
      const r = await run(['bun', 'skills/work/scripts/rule-calibrate.ts', '--set', 'writing', '--runs', '2'], envFor(dir, s.url))
      const jobs = Number(/(\d+) Jev calls/.exec(r.out)?.[1])
      expect(jobs).toBeGreaterThan(10)
      expect(s.seen.length).toBe(jobs + 1) // + the liveness ping, never cached either
      expect(existsSync(join(dir, 'jev-cache'))).toBe(false)
      expect(new Set(logOf(dir).map(r => r.caller))).toEqual(new Set(['rule-calibrate']))
    } finally {
      s.server.stop(true)
    }
  })

  test('a rule-check re-run on an unchanged file is answered from the cache', async () => {
    const dir = mkTmp('jev-cache-')
    const s = serve(b => ({
      status: 200,
      body: { answers: Object.fromEntries(Object.keys(b.questions).map(k => [k, { type: 'choice', choice: 'MET', probabilities: { VIOLATED: 0.2, MET: 0.8 } }])), usage: USAGE },
    }))
    try {
      const f = join(dir, 'memo.md')
      writeFileSync(f, '# Memo\n\nThe board should adopt the plan. It saves money.\n')
      const argv = ['bun', 'skills/work/scripts/rule-check.ts', '--files', f, '--rules', 'constraints/jev/writing']
      const a = await run(argv, envFor(dir, s.url))
      const asked = s.seen.length
      const b = await run(argv, envFor(dir, s.url))
      expect(asked).toBeGreaterThan(0)
      expect(s.seen.length).toBe(asked)
      expect(b.out).toBe(a.out)
      expect(b.code).toBe(a.code)
      expect(logOf(dir).filter(r => r.cache === 'hit').length).toBe(asked)
      expect(new Set(logOf(dir).map(r => r.caller))).toEqual(new Set(['rule-check']))
    } finally {
      s.server.stop(true)
    }
  })
})

describe('the key never reaches argv', () => {
  test('curl reads it, and the payload, from a config on stdin; no file is written', async () => {
    const dir = mkTmp('jev-argv-')
    const bin = join(dir, 'bin')
    require('node:fs').mkdirSync(bin)
    // a fake curl: records argv and stdin, then answers
    writeFileSync(join(bin, 'curl'), `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/argv"
cat > "${dir}/stdin"
printf '{"answers":{"q0":{"type":"noul","noul":0.2}}}\\n200'
`)
    chmodSync(join(bin, 'curl'), 0o755)
    const env = envFor(dir, 'http://127.0.0.1:9/never', { PATH: `${bin}:${process.env.PATH}`, WORK_HOLD_JUDGE_TOKEN: 'sk-or-v1-FAKEKEY123456', TMPDIR: join(dir, 't') })
    require('node:fs').mkdirSync(join(dir, 't'))
    const r = await call(env, 'a "quoted" \\ state\nline two')
    expect(JSON.parse(r.out).unavailable).toBeNull()
    expect(readFileSync(join(dir, 'argv'), 'utf8')).not.toContain('FAKEKEY')
    expect(readFileSync(join(dir, 'argv'), 'utf8').split('\n')).toContain('-K')
    const conf = readFileSync(join(dir, 'stdin'), 'utf8')
    expect(conf).toContain('header = "Authorization: Bearer sk-or-v1-FAKEKEY123456"')
    expect(conf).toMatch(/^data-binary = ".*"$/m)
    expect(readdirSync(join(dir, 't'))).toEqual([])
  })

  test('the stdin config carries the payload byte for byte through a real curl', async () => {
    const seen: string[] = []
    const server = Bun.serve({ port: 0, async fetch(req) {
      seen.push(await req.text())
      return Response.json({ answers: { q0: { type: 'noul', noul: 0.5 } } })
    } })
    const dir = mkTmp('jev-argv-')
    try {
      const state = 'quotes " and \\ backslashes, \t tabs, é unicode\nand a newline ' + 'x'.repeat(200_000)
      writeFileSync(join(dir, 'state.txt'), state)
      const r = await run(['bun', '-e', `import { readFileSync } from 'node:fs'; import { decisionsCall } from './hooks/work-hold.ts'; ` +
        `console.log(JSON.stringify(decisionsCall(readFileSync(${JSON.stringify(join(dir, 'state.txt'))}, 'utf8'), { q0: { type: 'noul', instructions: 'x' } })))`],
        envFor(dir, `http://127.0.0.1:${server.port}`, { JEV_CACHE: 'off' }))
      expect(JSON.parse(r.out).unavailable).toBeNull()
      expect(JSON.parse(seen[0]).state).toBe(state)
    } finally {
      server.stop(true)
    }
  })
})

describe('jev-spend', () => {
  const recs = [
    { ts: '2026-10-03T14:00:00Z', caller: 'jev-edit', session: 'a', cost: 0.001, inTokens: 100, stateBytes: 400, cache: 'miss' },
    { ts: '2026-10-03T14:01:00Z', caller: 'jev-edit', session: 'a', cost: 0, saved: 0.001, cache: 'hit' },
    { ts: '2026-10-03T15:00:00Z', caller: 'early-stop', session: 'b', cost: 0.0002, inTokens: 20, stateBytes: 80, cache: 'miss' },
    { ts: '2026-10-03T15:01:00Z', caller: 'early-stop', session: 'b', unavailable: 'decisions endpoint unreachable', cache: 'miss' },
    { ts: '2026-09-01T15:00:00Z', caller: 'old', cost: 9 },
  ]
  const text = recs.map(r => JSON.stringify(r)).join('\n') + '\n{"torn'

  test('summarize: per day x caller, billed, hits, failures, cost and savings; the window drops older days', () => {
    const rows = summarize(parseLog(text), { by: 'caller', sinceMs: Date.parse('2026-10-01T00:00:00Z') })
    expect(rows.map(r => r.key)).toEqual(['jev-edit', 'early-stop'])
    expect(rows[0]).toMatchObject({ calls: 2, billed: 1, hits: 1, failed: 0, inTokens: 100, saved: 0.001 })
    expect(rows[0].cost).toBeCloseTo(0.001)
    expect(rows[1]).toMatchObject({ calls: 2, billed: 1, hits: 0, failed: 1 })
  })

  test('by session, and a TOTAL line per day', () => {
    const rows = summarize(parseLog(text), { by: 'session', sinceMs: Date.parse('2026-10-01T00:00:00Z') })
    expect(rows.map(r => r.key).sort()).toEqual(['a', 'b'])
    const out = render(rows, 'session')
    expect(out).toMatch(/TOTAL\s+4\s+2\s+1\s+1\s+120\s+0\.001200\s+0\.001000/)
  })

  test('the command reads the log JEV_CALL_LOG names', async () => {
    const dir = mkTmp('jev-spend-')
    const log = join(dir, 'calls.ndjson')
    const now = new Date().toISOString()
    writeFileSync(log, JSON.stringify({ ts: now, caller: 'rule-check', cost: 0.5, inTokens: 9, cache: 'miss' }) + '\n')
    const r = await run(['bin/jev-spend', '--days', '1'], { ...HERMETIC_ENV, TMPDIR: dir, JEV_CALL_LOG: log })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/rule-check\s+1\s+1\s+0\s+0\s+9\s+0\.5000/)
    const none = await run(['bin/jev-spend'], { ...HERMETIC_ENV, TMPDIR: dir, JEV_CALL_LOG: join(dir, 'absent') })
    expect(none.out).toContain('no call log')
  })
})
