import { test, expect, describe } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

/**
 * Provider-constrained rows: a row naming a kind AND a provider but no model resolves to the first
 * AVAILABLE candidate of that provider in the kind's chain (pick, then fallbacks, in order).
 *
 *   chain has an available candidate of the provider  -> {..., candidate:<id>, source:'table'}
 *   chain has candidates of the provider, none available -> REFUSED: exit 2, empty stdout,
 *                                                          stderr names the kind and the provider
 *   chain has no candidate of the provider             -> today's explicit passthrough, unchanged
 *
 * Every case runs the CLI with Jev at the dead port or at an in-test stub — never the network.
 */

const ROOT = join(import.meta.dir, '..')
const ROUTE = join(ROOT, 'scripts', 'lib', 'route.ts')
const COMMITTED = join(ROOT, 'scripts', 'lib', 'routing.json')
const FIXTURE = join(import.meta.dir, 'fixtures', 'routing', 'provider-chain.json')
const DEAD = 'http://127.0.0.1:1/'

function fixtureCopy(edit: (t: any) => void): string {
  const t = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  edit(t)
  const p = join(mkTmp('route-provider-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2))
  return p
}

type Run = { code: number; stdout: string; stderr: string; ms: number }

async function runCli(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const { WORK_HOLD_DECISIONS_MODEL: _m, ROUTING_TABLE: _t, ...base } = HERMETIC_ENV
  const t0 = Date.now()
  const p = Bun.spawn(['bun', ROUTE, ...args], {
    env: { ...base, WORK_HOLD_DECISIONS_URL: DEAD, WORK_HOLD_JUDGE_TOKEN: 'test-token', ...env },
    stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 20_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr, ms: Date.now() - t0 }
}

const decide = (row: object, table = FIXTURE, env: Record<string, string> = {}) =>
  runCli(['--row', JSON.stringify(row), '--table', table], env)

function parseDecision(r: Run) {
  expect({ code: r.code, stderr: r.stderr }).toEqual({ code: 0, stderr: '' })
  const lines = r.stdout.trim().split('\n')
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0])
}

/** A constrained decision: exactly the candidate fields, source table. */
function expectConstrained(d: any, want: { provider: string; model: string; kind: string; candidate: string }) {
  expect(d).toEqual({ ...want, source: 'table' })
}

/** A stub Decisions server that records every request body and answers with scores of 0.99. */
function stubJev() {
  const bodies: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      bodies.push(await req.text())
      return new Response('{"answers":{}}', { headers: { 'content-type': 'application/json' } })
    },
  })
  return { url: `http://127.0.0.1:${server.port}/`, bodies, stop: () => server.stop(true) }
}

// ----------------------------------------------------------------- (a) the committed table

describe('the committed routing.json', () => {
  test('carries sol and flash38 with the decided provider, model, owner and openrouter id', () => {
    const t = JSON.parse(readFileSync(COMMITTED, 'utf8'))
    expect(t.candidates.sol).toMatchObject({
      provider: 'codex', model: 'gpt-6.1-sol', owner: 'openai', openrouter: 'openai/gpt-6.1-sol',
    })
    expect(t.candidates.flash38).toMatchObject({
      provider: 'gemini', model: 'gemini-3.8-flash-high', owner: 'antigravity', openrouter: 'google/gemini-3.8-flash',
    })
  })

  test("review's chain is sonnet, then opus, sol, flash38 — the pick is still sonnet", () => {
    const t = JSON.parse(readFileSync(COMMITTED, 'utf8'))
    expect(t.kinds.review).toEqual({ pick: 'sonnet', fallbacks: ['opus', 'sol', 'flash38'] })
  })

  test('a codex review row resolves to sol', async () => {
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'codex' }, COMMITTED)),
      { provider: 'codex', model: 'gpt-6.1-sol', kind: 'review', candidate: 'sol' })
  })

  test('a gemini review row resolves to flash38', async () => {
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'gemini' }, COMMITTED)),
      { provider: 'gemini', model: 'gemini-3.8-flash-high', kind: 'review', candidate: 'flash38' })
  })

  test('a claude review row resolves to sonnet', async () => {
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'claude' }, COMMITTED)),
      { provider: 'claude', model: 'claude-sonnet-5-5', kind: 'review', candidate: 'sonnet' })
  })

  test('an unconstrained review row still picks sonnet', async () => {
    const d = parseDecision(await decide({ kind: 'review' }, COMMITTED))
    expect({ candidate: d.candidate, model: d.model, source: d.source })
      .toEqual({ candidate: 'sonnet', model: 'claude-sonnet-5-5', source: 'table' })
  })
})

// ----------------------------------------------------------------- (b) chain order and availability

describe('a provider-constrained row walks the chain in order', () => {
  test('an unavailable same-provider candidate is skipped for the next one (luna -> sol)', async () => {
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'codex' })),
      { provider: 'codex', model: 'gpt-6.1-sol', kind: 'review', candidate: 'sol' })
  })

  test('once luna is available it wins, being earlier in the chain', async () => {
    const table = fixtureCopy(t => { t.candidates.luna.available = true })
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'codex' }, table)),
      { provider: 'codex', model: 'gpt-5.6-luna', kind: 'review', candidate: 'luna' })
  })

  test('the pick being unavailable moves a claude row to the next claude fallback (sonnet -> opus)', async () => {
    const table = fixtureCopy(t => { t.candidates.sonnet.available = false })
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'claude' }, table)),
      { provider: 'claude', model: 'claude-opus-5-5', kind: 'review', candidate: 'opus' })
  })

  test('only candidates IN the chain count: gemini review takes flash38, never the off-chain flash', async () => {
    expectConstrained(parseDecision(await decide({ kind: 'review', provider: 'gemini' })),
      { provider: 'gemini', model: 'gemini-3.8-flash-high', kind: 'review', candidate: 'flash38' })
  })
})

describe('refusal when every candidate of the provider is unavailable', () => {
  test('exit 2, nothing on stdout, stderr names the kind and the provider', async () => {
    const table = fixtureCopy(t => { t.candidates.sol.available = false })
    const r = await decide({ kind: 'review', provider: 'codex' }, table)
    expect(r.code).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('review')
    expect(r.stderr).toContain('codex')
  })

  test('the refusal does not fall back to another provider, though claude candidates are available', async () => {
    const table = fixtureCopy(t => { t.candidates.flash38.available = false })
    const r = await decide({ kind: 'review', provider: 'gemini' }, table)
    expect({ code: r.code, stdout: r.stdout }).toEqual({ code: 2, stdout: '' })
    expect(r.stderr).toContain('review')
    expect(r.stderr).toContain('gemini')
  })
})

describe('a provider absent from the chain passes through exactly as today', () => {
  test('judgement has no codex candidate: explicit, model null, candidate null', async () => {
    const d = parseDecision(await decide({ kind: 'judgement', provider: 'codex' }))
    expect(d).toEqual({
      provider: 'codex', model: null, kind: 'judgement', candidate: null, source: 'explicit',
    })
  })

  test('a row with provider and model stays explicit even when the chain has that provider', async () => {
    const d = parseDecision(await decide({ kind: 'review', provider: 'codex', model: 'gpt-5.6-luna' }))
    expect(d).toEqual({
      provider: 'codex', model: 'gpt-5.6-luna', kind: 'review', candidate: null, source: 'explicit',
    })
  })
})

describe('no Decisions call on any row', () => {
  test('a live stub sees zero requests for a constrained row and for a kind-only row', async () => {
    const jev = stubJev()
    try {
      const env = { WORK_HOLD_DECISIONS_URL: jev.url }
      const d = parseDecision(await decide({ kind: 'review', provider: 'gemini', prompt: 'p' }, FIXTURE, env))
      expectConstrained(d, { provider: 'gemini', model: 'gemini-3.8-flash-high', kind: 'review', candidate: 'flash38' })
      const k = await decide({ kind: 'review', prompt: 'p' }, FIXTURE, env)
      expect(k.code).toBe(0)
      expect(jev.bodies).toHaveLength(0)
    } finally { jev.stop() }
  }, 30_000)
})
