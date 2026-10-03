import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

/**
 * 2026-10-03: the OpenRouter account hit HTTP 402. curl exits 0 on a 402, so the error body reached
 * every Decisions caller as a reply with no answers — rule legs read "missing answers.q0.probabilities
 * in reply", the work hold fell through to the chat judge and said "judge endpoint unreachable", and
 * the release canary was the first thing to notice. These pin the explicit reason and the warning
 * that comes before it.
 *
 * Every stub is an in-process Bun.serve, so every caller runs as an ASYNC child: `decisionsCall`
 * blocks on spawnSync, and an in-process call would wait on the event loop serving it.
 */

const ROOT = join(import.meta.dir, '..')
const OUT = 'OpenRouter is out of credits — top up at https://openrouter.ai/settings/credits'
// OpenRouter's documented error shape (docs/api_reference/errors-and-debugging.md): HTTP status
// equals error.code, and 402 is "Your account or API key has insufficient credits".
const BODY_402 = JSON.stringify({ error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits' } })

type Reply = { status: number; body: string }
function serve(reply: Reply | ((path: string) => Reply)) {
  const hits: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text()
      const path = new URL(req.url).pathname
      hits.push(path)
      const r = typeof reply === 'function' ? reply(path) : reply
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } })
    },
  })
  return { server, hits, url: `http://127.0.0.1:${server.port}` }
}

async function run(cmd: string[], env: Record<string, string>, input = '') {
  const p = Bun.spawn(cmd, { cwd: ROOT, env, stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, out, err }
}

const baseEnv = (dir: string, extra: Record<string, string> = {}) => ({
  ...HERMETIC_ENV,
  TMPDIR: dir,
  XDG_RUNTIME_DIR: '/nonexistent-so-no-agenix-key',
  WORK_HOLD_JUDGE_TOKEN: 'test-token-not-a-secret',
  ...extra,
})

describe('(1) a 402 is named as out of credits, in every Decisions caller', () => {
  const call = (dir: string, url: string) =>
    run(['bun', '-e', `import { decisionsCall } from './hooks/work-hold.ts'; ` +
      `console.log(JSON.stringify(decisionsCall('{}', { q0: { type: 'noul', instructions: 'x' } }, { maxTimeSeconds: 10 })))`],
      baseEnv(dir, { WORK_HOLD_DECISIONS_URL: `${url}/decisions` }))

  test('decisionsCall: HTTP 402 -> the top-up reason', async () => {
    const s = serve({ status: 402, body: BODY_402 })
    const r = await call(mkTmp('orc-'), s.url)
    s.server.stop(true)
    expect(JSON.parse(r.out)).toEqual({ stdout: null, unavailable: OUT })
  })

  test('decisionsCall: an insufficient-credits body under another status -> the top-up reason', async () => {
    const s = serve({ status: 200, body: BODY_402 })
    const r = await call(mkTmp('orc-'), s.url)
    s.server.stop(true)
    expect(JSON.parse(r.out).unavailable).toBe(OUT)
  })

  test('decisionsCall: a healthy reply is untouched', async () => {
    const ok = JSON.stringify({ answers: { q0: { type: 'noul', noul: 0.4 } } })
    const s = serve({ status: 200, body: ok })
    const r = await call(mkTmp('orc-'), s.url)
    s.server.stop(true)
    expect(JSON.parse(r.out)).toEqual({ stdout: ok, unavailable: null })
  })

  test('rule-check: every rule UNAVAILABLE carries the top-up reason, not "missing answers.q0.probabilities"', async () => {
    const s = serve({ status: 402, body: BODY_402 })
    const r = await run(['bun', join(ROOT, 'skills/work/scripts/rule-check.ts'), '--files', join(ROOT, 'skills/work/scripts/rule-check.ts')],
      baseEnv(mkTmp('orc-'), { WORK_HOLD_DECISIONS_URL: `${s.url}/` }))
    s.server.stop(true)
    const v = JSON.parse(r.out)
    expect(v.unavailable.length).toBeGreaterThan(0)
    for (const u of v.unavailable) expect(u.reason).toBe(OUT)
    // out of credits is not transient: one call per rule, no retry
    expect(s.hits.length).toBe(v.unavailable.length)
  })

  test('the work hold message names the top-up, not "judge endpoint unreachable"', async () => {
    const dir = mkTmp('orc-hold-')
    const s = serve({ status: 402, body: BODY_402 })
    const sid = 'orc-hold'
    writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify({
      check: '', goal: 'the report is written', startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 6, rounds: 0,
    }))
    const transcript = join(dir, 't.jsonl')
    writeFileSync(transcript, JSON.stringify({ message: { content: 'I wrote half of the report.' } }) + '\n')
    const r = await run(['bun', join(ROOT, 'hooks/work-hold.ts')],
      baseEnv(dir, {
        WORK_HOLD_DECISIONS_URL: `${s.url}/decisions`,
        WORK_HOLD_JUDGE_URL: 'http://127.0.0.1:1/v1/chat/completions',
      }),
      JSON.stringify({ session_id: sid, transcript_path: transcript }))
    s.server.stop(true)
    expect(r.out).toContain('"decision":"block"')
    expect(r.out).toContain(OUT)
    expect(r.out).not.toContain('judge endpoint unreachable')
  })

  test('the canary failure line names the top-up', async () => {
    const dir = mkTmp('orc-canary-')
    const rdir = join(dir, 'run')
    const events = join(dir, 'events')
    mkdirSync(rdir, { recursive: true })
    mkdirSync(events, { recursive: true })
    const verdict = JSON.stringify({ verdicts: [], unavailable: [{ rule: 'LOOP', reason: OUT }, { rule: 'MOCK', reason: OUT }] })
    writeFileSync(join(rdir, 'loop.exit'), '0\n')
    writeFileSync(join(rdir, 'result.json'), JSON.stringify({ overallPass: false }))
    writeFileSync(join(rdir, 'checks.json'), JSON.stringify({ mechanical: [], rules: [{ name: 'jev-dev-rules', exitCode: 0, stdout: verdict }] }))
    const r = await run(['bash', join(ROOT, 'scripts/canary.sh'), '--assert', rdir, '--events', events, '--expect-exit', '0'], { ...HERMETIC_ENV, TMPDIR: dir })
    expect(r.out).toContain(`FAIL [run] rule leg jev-dev-rules: ${OUT}`)
  })
})

describe('(2) the low-balance warning', () => {
  const SCRIPT = join(ROOT, 'scripts/lib/openrouter-credits.ts')
  const credits = (total: number, usage: number): Reply => ({ status: 200, body: JSON.stringify({ data: { total_credits: total, total_usage: usage } }) })

  /** A notify-send on PATH that records each call, so the desktop leg is observable. */
  function fakeNotify(dir: string) {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'notify-send'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/notify.log"\n`)
    chmodSync(join(bin, 'notify-send'), 0o755)
    return { PATH: `${bin}:${process.env.PATH}` }
  }
  const notified = (dir: string) => (existsSync(join(dir, 'notify.log')) ? readFileSync(join(dir, 'notify.log'), 'utf8').trim().split('\n') : [])
  const credEnv = (dir: string, url: string, extra: Record<string, string> = {}) =>
    baseEnv(dir, { OPENROUTER_CREDITS_URL: `${url}/api/v1/credits`, ...fakeNotify(dir), ...extra })

  test('healthy balance: silent, no notification', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 10.3))
    const r = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(notified(dir)).toEqual([])
    expect(s.hits).toEqual(['/api/v1/credits'])
  })

  test('low balance: a loud line and one desktop notification per day', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 28.25))
    const r1 = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
    const r2 = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r1.out).toContain('OpenRouter balance is LOW: $1.75 (warning below $3.00)')
    expect(r1.out).toContain('https://openrouter.ai/settings/credits')
    expect(r2.out).toContain('$1.75')
    expect(notified(dir).length).toBe(1)
    // the cache: one API call for both sessions inside the hour
    expect(s.hits.length).toBe(1)
  })

  test('the threshold is env-overridable', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 10.3))
    const r = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url, { OPENROUTER_LOW_BALANCE: '25' }))
    s.server.stop(true)
    expect(r.out).toContain('OpenRouter balance is LOW: $19.70 (warning below $25.00)')
  })

  test('balance <= 0: the out-of-credits line', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 30.24))
    const r = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r.out).toContain(OUT)
    expect(r.out).toContain('-$0.24')
    expect(notified(dir).length).toBe(1)
  })

  test('API answers 402 on the credits read: out of credits', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve({ status: 402, body: BODY_402 })
    const r = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r.out).toContain(OUT)
  })

  test('API unreachable: silent, no false alarm, and cached so the next session does not retry', async () => {
    const dir = mkTmp('orc-bal-')
    const env = baseEnv(dir, { OPENROUTER_CREDITS_URL: 'http://127.0.0.1:1/api/v1/credits', ...fakeNotify(dir) })
    const r = await run(['bun', SCRIPT, '--session'], env)
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(notified(dir)).toEqual([])
    const s = serve(credits(30, 30.24))
    const r2 = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r2.out).toBe('')
    expect(s.hits).toEqual([])
  })

  test('an error body (401, 500) is unknown, not low', async () => {
    for (const status of [401, 500]) {
      const dir = mkTmp('orc-bal-')
      const s = serve({ status, body: JSON.stringify({ error: { code: status, message: 'nope' } }) })
      const r = await run(['bun', SCRIPT, '--session'], credEnv(dir, s.url))
      s.server.stop(true)
      expect(r.out).toBe('')
      expect(notified(dir)).toEqual([])
    }
  })

  test('OPENROUTER_CREDITS_URL=off: no read, no cache file', async () => {
    const dir = mkTmp('orc-bal-')
    const r = await run(['bun', SCRIPT, '--session'], baseEnv(dir, { OPENROUTER_CREDITS_URL: 'off' }))
    expect(r.code).toBe(0)
    expect(r.out).toBe('')
    expect(existsSync(join(dir, 'openrouter-credits.json'))).toBe(false)
  })

  test('no key: silent', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 30.24))
    const env = credEnv(dir, s.url)
    delete (env as Record<string, string>).WORK_HOLD_JUDGE_TOKEN
    const r = await run(['bun', SCRIPT, '--session'], env)
    s.server.stop(true)
    expect(r.out).toBe('')
    expect(s.hits).toEqual([])
  })

  test('the key is never printed, and never in curl argv', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 28.25))
    const r = await run(['bun', SCRIPT, '--balance', '--fresh'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r.out + r.err).not.toContain('test-token-not-a-secret')
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/'-H',\s*`Authorization/)
  })

  test('--preflight: exit 1 with the top-up line at <= 0; a cached 0 is re-read in case of a top-up', async () => {
    const dir = mkTmp('orc-bal-')
    let total = 30
    const s = serve(() => credits(total, 30.24))
    const r1 = await run(['bun', SCRIPT, '--preflight'], credEnv(dir, s.url))
    expect(r1.code).toBe(1)
    expect(r1.out).toContain(`FAIL [credits] ${OUT}`)
    total = 50
    const r2 = await run(['bun', SCRIPT, '--preflight'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(r2.code).toBe(0)
    expect(s.hits.length).toBe(2)
  })

  test('--preflight: low is a warning, unreachable is silent; both exit 0', async () => {
    const dir = mkTmp('orc-bal-')
    const s = serve(credits(30, 28.25))
    const low = await run(['bun', SCRIPT, '--preflight'], credEnv(dir, s.url))
    s.server.stop(true)
    expect(low.code).toBe(0)
    expect(low.out).toContain('LOW: $1.75')
    const dead = await run(['bun', SCRIPT, '--preflight'],
      baseEnv(mkTmp('orc-bal-'), { OPENROUTER_CREDITS_URL: 'http://127.0.0.1:1/api/v1/credits' }))
    expect(dead.code).toBe(0)
    expect(dead.out).toBe('')
  })

  test('canary --run fails fast on an empty account, before any suite or dispatch', async () => {
    const dir = mkTmp('orc-canary-')
    const s = serve(credits(30, 30.24))
    const r = await run(['bash', join(ROOT, 'scripts/canary.sh'), '--run', '--only', 'diag'],
      credEnv(dir, s.url, { CANARY_TMP: dir, CANARY_STATE: join(dir, 'state'), CANARY_COURSE: join(dir, 'no-course'), CANARY_NESTED: '' }))
    s.server.stop(true)
    expect(r.code).toBe(1)
    expect(r.out + r.err).toContain(`FAIL [credits] ${OUT}`)
    expect(r.out + r.err).not.toContain('no deck for lecture')
  })

  test('SessionStart: an interactive session gets the line as a systemMessage', async () => {
    const dir = mkTmp('orc-ss-')
    const s = serve(credits(30, 28.25))
    const env = credEnv(dir, s.url, { CLAUDE_CODE_ENTRYPOINT: 'cli', FARM_OUT_CHILD: '' })
    const r = await run(['bun', join(ROOT, 'hooks/session-start.ts')], env, JSON.stringify({ session_id: 'orc-ss' }))
    const headless = await run(['bun', join(ROOT, 'hooks/session-start.ts')],
      credEnv(mkTmp('orc-ss-'), s.url, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), JSON.stringify({ session_id: 'orc-ss2' }))
    s.server.stop(true)
    const out = JSON.parse(r.out)
    expect(out.systemMessage).toContain('OpenRouter balance is LOW: $1.75')
    expect(out.hookSpecificOutput.additionalContext).toContain('OpenRouter balance is LOW')
    expect(JSON.parse(headless.out).systemMessage ?? '').not.toContain('OpenRouter')
  })
})
