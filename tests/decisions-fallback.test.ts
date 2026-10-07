import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'
// Namespace imports: an export that does not exist yet reads as undefined and fails an assertion,
// where a named import would fail the whole file at link time.
import * as workHold from '../hooks/work-hold.ts'
import * as jevSpend from '../scripts/jev-spend.ts'
import * as jevRules from '../hooks/jev/rules.ts'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

/**
 * When Jev (OpenRouter Decisions) fails — 429, 402, any 5xx, a dead endpoint, or a reply that does not
 * answer every question — decisionsCall asks OpenAI's Decisions API (gpt-6-luna) instead, returns the
 * answer in Jev's shape tagged `provider: "openai"`, and every caller holds a tagged answer to a bar
 * of at least 0.95.
 *
 * Every stub is an in-process Bun.serve, so every caller runs as an ASYNC child: decisionsCall blocks
 * on spawnSync, and an in-process call would wait on the event loop serving its own stub.
 */

const ROOT = join(import.meta.dir, '..')
const KEY = 'sk-test-fallback'

type Reply = { status: number; body: string }

/** The Jev stub: a reply per request (mutable through `set`), and a count of what reached it. */
function jevStub(initial: (body: any) => Reply) {
  let reply = initial
  const seen: any[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text())
      seen.push(body)
      const r = reply(body)
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } })
    },
  })
  return { server, seen, url: `http://127.0.0.1:${server.port}/decisions`, set: (r: (body: any) => Reply) => { reply = r } }
}

/** Jev's documented reply: every question answered in its own type's shape. */
const jevAnswers = (p: number) => (b: any): Reply => ({
  status: 200,
  body: JSON.stringify({
    answers: Object.fromEntries(Object.entries(b.questions as Record<string, any>).map(([k, q]) => [k,
      q.type === 'choice'
        ? { type: 'choice', choice: p >= 0.5 ? 'VIOLATED' : 'SATISFIED', probabilities: { VIOLATED: p, SATISFIED: 1 - p } }
        : { type: 'noul', noul: p }])),
    usage: { input_tokens: 500, output_tokens: 3, cost: 0.000021 },
  }),
})
const jevStatus = (status: number) => (): Reply => ({ status, body: JSON.stringify({ error: { code: status, message: `upstream ${status}` } }) })

/** The OpenAI stub: records path, Authorization and body; answers every predicate with `probs[name]` (else `fallbackP`). */
function openaiStub(fallbackP: number, probs: Record<string, number> = {}) {
  const seen: { path: string; auth: string | null; body: any }[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = JSON.parse(await req.text())
      seen.push({ path: new URL(req.url).pathname, auth: req.headers.get('authorization'), body })
      const answers = (body.questions ?? []).map((q: any) => ({ type: 'predicate', name: q.name, probability: probs[q.name] ?? fallbackP }))
      return new Response(JSON.stringify({ answers, usage: { input_tokens: 2000 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  return { server, seen, url: `http://127.0.0.1:${server.port}/v1/decisions` }
}

async function run(cmd: string[], env: Record<string, string>, input = '') {
  const p = Bun.spawn(cmd, { cwd: ROOT, env, stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code: await p.exited, out, err }
}

function baseEnv(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const { OPENAI_API_KEY: _k, OPENAI_DECISIONS_URL: _u, FARM_OUT_CHILD: _f, GRIND_ITERATION: _g, EARLY_STOP_HOOK: _e, ...rest } = HERMETIC_ENV
  return {
    ...rest,
    TMPDIR: dir,
    // no agenix dir: neither the OpenRouter nor the OpenAI secret can be read from the machine
    XDG_RUNTIME_DIR: '/nonexistent-so-no-agenix-key',
    WORK_HOLD_JUDGE_TOKEN: 'test-token-not-a-secret',
    JEV_CALL_LOG: join(dir, 'jev-calls.ndjson'),
    JEV_CACHE: 'off',
    JEV_CACHE_DIR: join(dir, 'jev-cache'),
    XDG_CACHE_HOME: join(dir, 'xdg-cache'),
    XDG_STATE_HOME: join(dir, 'xdg-state'),
    ...extra,
  }
}

/** Env with Jev at `jevUrl` and the OpenAI fallback reachable at `oaUrl` with the fake key. */
const fbEnv = (dir: string, jevUrl: string, oaUrl: string, extra: Record<string, string> = {}) =>
  baseEnv(dir, { WORK_HOLD_DECISIONS_URL: jevUrl, OPENAI_DECISIONS_URL: oaUrl, OPENAI_API_KEY: KEY, ...extra })

const NOUL_Q = { q0: { type: 'noul', instructions: 'The report is written.' } }
const CHOICE_Q = {
  q1: {
    type: 'choice',
    instructions: 'Decide whether this is true of the state: every claim cites a source.',
    criteria: { VIOLATED: 'A claim in the state has no source.', SATISFIED: 'Every claim has a source.' },
  },
}

/** decisionsCall in a child; its return value parsed. */
async function decide(env: Record<string, string>, questions: Record<string, unknown> = NOUL_Q, opts = '{ caller: "t-fallback" }', state = 'STATE-R') {
  const r = await run(['bun', '-e', `import * as wh from './hooks/work-hold.ts'; ` +
    `console.log(JSON.stringify(wh.decisionsCall(${JSON.stringify(state)}, ${JSON.stringify(questions)}, ${opts})))`], env)
  try {
    return JSON.parse(r.out)
  } catch {
    throw new Error(`decisionsCall child printed no JSON (exit ${r.code}): ${r.err.slice(0, 500)}`)
  }
}
const replyOf = (res: any) => (typeof res?.stdout === 'string' ? JSON.parse(res.stdout) : null)
const logOf = (dir: string): any[] => {
  try {
    return readFileSync(join(dir, 'jev-calls.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch {
    return []
  }
}

// ------------------------------------------------------------------------------- the triggers

describe('decisionsCall falls back to OpenAI when Jev fails', () => {
  const failures: [string, (body: any) => Reply][] = [
    ['HTTP 429', jevStatus(429)],
    ['HTTP 402', jevStatus(402)],
    ['HTTP 500', jevStatus(500)],
    ['HTTP 503', jevStatus(503)],
    ['HTTP 529', jevStatus(529)],
    ['a 200 that answers only some questions', (b: any) => ({
      status: 200,
      body: JSON.stringify({ answers: { [Object.keys(b.questions)[0]]: { type: 'noul', noul: 0.5 } } }),
    })],
  ]
  for (const [name, reply] of failures) {
    test(`${name} from Jev -> one OpenAI request, and the answer comes back tagged openai`, async () => {
      const jev = jevStub(reply)
      const oa = openaiStub(0.37)
      try {
        const res = await decide(fbEnv(mkTmp('fb-'), jev.url, oa.url), { ...NOUL_Q, q2: { type: 'noul', instructions: 'second' } })
        expect(oa.seen.length).toBe(1)
        expect(res.unavailable).toBeNull()
        const d = replyOf(res)
        expect(d.provider).toBe('openai')
        expect(d.answers.q0.noul).toBe(0.37)
        expect(d.answers.q2.noul).toBe(0.37)
      } finally {
        jev.server.stop(true)
        oa.server.stop(true)
      }
    })
  }

  test('an unreachable Jev endpoint (curl fails) -> the OpenAI answer, not "decisions endpoint unreachable"', async () => {
    const oa = openaiStub(0.41)
    try {
      const res = await decide(fbEnv(mkTmp('fb-'), 'http://127.0.0.1:1/decisions', oa.url))
      expect(oa.seen.length).toBe(1)
      expect(res.unavailable).toBeNull()
      expect(replyOf(res)).toMatchObject({ provider: 'openai', answers: { q0: { noul: 0.41 } } })
    } finally {
      oa.server.stop(true)
    }
  })
})

// ------------------------------------------------------------------------------ the request

describe('the OpenAI request', () => {
  test('POSTs to $OPENAI_DECISIONS_URL with Bearer <key>, model gpt-6-luna and the state as input', async () => {
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      await decide(fbEnv(mkTmp('fb-'), jev.url, oa.url), NOUL_Q, '{}', 'the exact state text')
      expect(oa.seen.length).toBe(1)
      expect(oa.seen[0].path).toBe('/v1/decisions')
      expect(oa.seen[0].auth).toBe(`Bearer ${KEY}`)
      expect(oa.seen[0].body.model).toBe('gpt-6-luna')
      expect(oa.seen[0].body.input).toBe('the exact state text')
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('a noul question becomes a predicate carrying its key as name and its instructions verbatim', async () => {
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      await decide(fbEnv(mkTmp('fb-'), jev.url, oa.url), NOUL_Q)
      expect(oa.seen[0]?.body.questions).toEqual([{ type: 'predicate', name: 'q0', instructions: 'The report is written.' }])
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('a choice question becomes a predicate whose instructions carry the question AND the VIOLATED criterion, not SATISFIED', async () => {
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      await decide(fbEnv(mkTmp('fb-'), jev.url, oa.url), CHOICE_Q)
      const qs = oa.seen[0]?.body.questions
      expect(qs?.length).toBe(1)
      expect(qs[0].type).toBe('predicate')
      expect(qs[0].name).toBe('q1')
      expect(qs[0].instructions).toContain('every claim cites a source.')
      expect(qs[0].instructions).toContain('A claim in the state has no source.')
      expect(qs[0].instructions).not.toContain('Every claim has a source.')
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('the key is read from $XDG_RUNTIME_DIR/agenix/openai-api-key when $OPENAI_API_KEY is unset', async () => {
    const dir = mkTmp('fb-')
    const rt = join(dir, 'rt')
    mkdirSync(join(rt, 'agenix'), { recursive: true })
    writeFileSync(join(rt, 'agenix', 'openai-api-key'), 'sk-test-from-file\n')
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      const env = fbEnv(dir, jev.url, oa.url, { XDG_RUNTIME_DIR: rt })
      delete env.OPENAI_API_KEY
      await decide(env)
      expect(oa.seen.length).toBe(1)
      expect(oa.seen[0].auth).toBe('Bearer sk-test-from-file')
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })
})

// ------------------------------------------------------------------------------- the reply

describe('the reply comes back in Jev shape', () => {
  test('a choice question answers probabilities.VIOLATED with the predicate probability; noul answers noul', async () => {
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0, { q0: 0.23, q1: 0.62 })
    try {
      const res = await decide(fbEnv(mkTmp('fb-'), jev.url, oa.url), { ...NOUL_Q, ...CHOICE_Q })
      const d = replyOf(res)
      expect(d?.provider).toBe('openai')
      expect(d.answers.q0.noul).toBe(0.23)
      expect(d.answers.q1.probabilities.VIOLATED).toBe(0.62)
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })
})

// --------------------------------------------------------------- when OpenAI must NOT be asked

describe('when the fallback must not run', () => {
  test('Jev answers -> OpenAI is never contacted and the reply is not tagged', async () => {
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      const dir = mkTmp('fb-')
      // the same env does reach OpenAI when Jev fails, so a zero below is not an unreachable stub
      const failed = await decide(fbEnv(dir, jev.url, oa.url))
      expect(replyOf(failed)?.provider).toBe('openai')
      expect(oa.seen.length).toBe(1)
      jev.set(jevAnswers(0.6))
      const ok = await decide(fbEnv(dir, jev.url, oa.url))
      expect(oa.seen.length).toBe(1)
      expect(replyOf(ok).provider).toBeUndefined()
      expect(replyOf(ok).answers.q0.noul).toBe(0.6)
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('opts.fallback === false -> no OpenAI request', async () => {
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      const dir = mkTmp('fb-')
      const on = await decide(fbEnv(dir, jev.url, oa.url))
      expect(replyOf(on)?.provider).toBe('openai')
      const off = await decide(fbEnv(dir, jev.url, oa.url), NOUL_Q, '{ fallback: false }')
      expect(oa.seen.length).toBe(1)
      expect(replyOf(off)?.provider).toBeUndefined()
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('no OpenAI key -> the original unavailable result, unchanged, and no OpenAI request', async () => {
    const oa = openaiStub(0.3)
    try {
      const dir = mkTmp('fb-')
      const withKey = await decide(fbEnv(dir, 'http://127.0.0.1:1/decisions', oa.url))
      expect(replyOf(withKey)?.provider).toBe('openai')
      const env = fbEnv(dir, 'http://127.0.0.1:1/decisions', oa.url)
      delete env.OPENAI_API_KEY
      const noKey = await decide(env)
      expect(noKey).toEqual({ stdout: null, unavailable: 'decisions endpoint unreachable' })
      expect(oa.seen.length).toBe(1)
    } finally {
      oa.server.stop(true)
    }
  })
})

// ------------------------------------------------------------------------- log, cache, spend

describe('the call log and the cache', () => {
  test('the failed Jev attempt and the OpenAI fallback each write their own record; luna is priced at $0.10/M in', async () => {
    const dir = mkTmp('fb-')
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      await decide(fbEnv(dir, jev.url, oa.url))
      const recs = logOf(dir)
      expect(recs.length).toBe(2)
      expect(recs[0].status).toBe(529)
      expect(recs[0].provider).not.toBe('openai')
      expect(recs[1]).toMatchObject({ provider: 'openai', model: 'gpt-6-luna', status: 200, inTokens: 2000, caller: 't-fallback' })
      expect(recs[1].cost).toBeCloseTo(0.0002, 10)
      expect(typeof recs[1].ms).toBe('number')
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('a luna reply is never cached under the Jev request: a repeat after Jev recovers asks Jev again', async () => {
    const dir = mkTmp('fb-')
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.3)
    try {
      const env = fbEnv(dir, jev.url, oa.url, { JEV_CACHE: 'on' })
      const first = await decide(env)
      expect(replyOf(first)?.provider).toBe('openai')
      expect(jev.seen.length).toBe(1)
      jev.set(jevAnswers(0.6))
      const second = await decide(env)
      expect(jev.seen.length).toBe(2)
      expect(replyOf(second).provider).toBeUndefined()
      expect(replyOf(second).answers.q0.noul).toBe(0.6)
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('jev-spend groups openai records under <caller>/luna, apart from the Jev spend', () => {
    const ts = new Date().toISOString()
    const recs = [
      { ts, caller: 'rule-check', model: 'typesafe/jev-1.13', status: 200, inTokens: 500, cost: 0.000021, cache: 'miss' },
      { ts, caller: 'rule-check', model: 'typesafe/jev-1.13', status: 529, inTokens: null, cost: null, cache: 'miss', unavailable: 'no answers' },
      { ts, caller: 'rule-check', provider: 'openai', model: 'gpt-6-luna', status: 200, inTokens: 2000, cost: 0.0002, ms: 40 },
    ]
    const rows = jevSpend.summarize(recs as any, { by: 'caller', sinceMs: 0 })
    const byKey = Object.fromEntries(rows.map((r: any) => [r.key, r]))
    expect(Object.keys(byKey).sort()).toEqual(['rule-check', 'rule-check/luna'])
    expect(byKey['rule-check/luna']).toMatchObject({ calls: 1, billed: 1, inTokens: 2000 })
    expect(byKey['rule-check/luna'].cost).toBeCloseTo(0.0002, 10)
    expect(byKey['rule-check']).toMatchObject({ calls: 2, billed: 1, failed: 1, inTokens: 500 })
  })
})

// --------------------------------------------------------------------- the stricter bar

describe('a luna answer is held to a bar of at least 0.95', () => {
  const tagged = JSON.stringify({ provider: 'openai', answers: { met: { type: 'noul', noul: 0.9 } } })
  const untagged = JSON.stringify({ answers: { met: { type: 'noul', noul: 0.9 } } })

  test('decisionThreshold: max(threshold, 0.95) for an openai reply, the threshold itself otherwise', () => {
    expect(typeof workHold.decisionThreshold).toBe('function')
    const dt = (workHold as any).decisionThreshold
    expect(dt(tagged, 0.8)).toBe(0.95)
    expect(dt(tagged, 0.97)).toBe(0.97)
    expect(dt(untagged, 0.8)).toBe(0.8)
    expect(dt('not json', 0.8)).toBe(0.8)
  })

  test('parseNoul: 0.9 at threshold 0.8 is UNMET from luna and MET from Jev', () => {
    expect(workHold.parseNoul(tagged, 'met', 0.8).verdict).toBe('UNMET')
    expect(workHold.parseNoul(untagged, 'met', 0.8).verdict).toBe('MET')
  })
})

// ---------------------------------------------------------------------------- the callers

/** A one-rule rules dir: the default evidence.py runs it (rule-check.test.ts's X-SPAN pattern). */
function oneRule(dir: string): string {
  const rules = join(dir, 'rules')
  mkdirSync(rules, { recursive: true })
  writeFileSync(join(rules, 'X-LUNA.py'), [
    "PROPOSITION = 'Every claim cites a source.'",
    "CRITERIA = {'VIOLATED': 'A claim has no source.', 'SATISFIED': 'Every claim has a source.'}",
    'def evidence(files, plan_lines=None):',
    "    return {'items': [{'file': 'a.md', 'line': 1}]}", ''].join('\n'))
  return rules
}

const RULE_CHECK = join(ROOT, 'skills/work/scripts/rule-check.ts')
const verdictsOf = (out: string): any => {
  try {
    return JSON.parse(out)
  } catch {
    return { verdicts: [], unavailable: [{ rule: '-', reason: `no JSON: ${out.slice(0, 200)}` }] }
  }
}

describe('callers apply decisionThreshold', () => {
  test('rule-check: P(VIOLATED)=0.9 fails the rule when Jev says it, not when luna does', async () => {
    const dir = mkTmp('fb-rc-')
    const rules = oneRule(dir)
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.9)
    try {
      const env = fbEnv(dir, jev.url, oa.url)
      const viaLuna = await run(['bun', RULE_CHECK, '--files', RULE_CHECK, '--rules', rules], env)
      expect(oa.seen.length).toBe(1)
      expect(verdictsOf(viaLuna.out).verdicts).toEqual([expect.objectContaining({ rule: 'X-LUNA', p: 0.9, verdict: 'MET' })])
      expect(viaLuna.code).toBe(0)

      jev.set(jevAnswers(0.9))
      const viaJev = await run(['bun', RULE_CHECK, '--files', RULE_CHECK, '--rules', rules], env)
      expect(verdictsOf(viaJev.out).verdicts).toEqual([expect.objectContaining({ rule: 'X-LUNA', p: 0.9, verdict: 'VIOLATED' })])
      expect(viaJev.code).toBe(2)
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  test('early-stop: a noul of 0.9 blocks the stop from Jev but is below the bar from luna', async () => {
    const turn = (dir: string) => {
      const t = join(dir, 'transcript.jsonl')
      writeFileSync(t, [
        { type: 'user', uuid: 'turn-1', message: { content: 'build the parser and run the suite' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      ].map(l => JSON.stringify(l)).join('\n') + '\n')
      return t
    }
    const payload = (session: string, transcript: string) => JSON.stringify({
      session_id: session, transcript_path: transcript, hook_event_name: 'Stop', stop_hook_active: false,
      last_assistant_message: 'The tests are written. Next I should run the suite — want me to go ahead?',
    })
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.9)
    try {
      const d1 = mkTmp('fb-es-')
      const viaLuna = await run(['bun', join(ROOT, 'hooks/early-stop.ts')], fbEnv(d1, jev.url, oa.url), payload('fb-es-luna', turn(d1)))
      expect(oa.seen.length).toBe(1)
      expect(viaLuna.out).toBe('')
      expect(readFileSync(join(d1, 'early-stop.log'), 'utf8')).toContain('below threshold')

      jev.set(jevAnswers(0.9))
      const d2 = mkTmp('fb-es-')
      const viaJev = await run(['bun', join(ROOT, 'hooks/early-stop.ts')], fbEnv(d2, jev.url, oa.url), payload('fb-es-jev', turn(d2)))
      expect(viaJev.out).toContain('"decision":"block"')
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })

  // The mod itself runs only under `claude plugin test` (hooks/mod-tests/jev.test.ts, with rule-check
  // faked). Its bun-runnable path is the real `rule-check.ts --batch` it spawns, fed to contextLines.
  test('jev/mod: a luna P(VIOLATED)=0.9 adds no context line; the same 0.9 from Jev adds one', async () => {
    const dir = mkTmp('fb-mod-')
    const rules = oneRule(dir)
    const jev = jevStub(jevStatus(529))
    const oa = openaiStub(0.9)
    const lines = (out: string) => jevRules.contextLines(verdictsOf(out).verdicts ?? [], 'a.md', [[1, 1]])
    try {
      const env = fbEnv(dir, jev.url, oa.url)
      const viaLuna = await run(['bun', RULE_CHECK, '--batch', '--rules', rules, '--files', RULE_CHECK], env)
      expect(oa.seen.length).toBe(1)
      expect(verdictsOf(viaLuna.out).verdicts.map((v: any) => v.rule)).toEqual(['X-LUNA'])
      expect(lines(viaLuna.out)).toEqual([])

      jev.set(jevAnswers(0.9))
      const viaJev = await run(['bun', RULE_CHECK, '--batch', '--rules', rules, '--files', RULE_CHECK], env)
      expect(lines(viaJev.out).length).toBe(1)
    } finally {
      jev.server.stop(true)
      oa.server.stop(true)
    }
  })
})
