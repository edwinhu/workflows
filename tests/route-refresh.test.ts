import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

/**
 * The spec for `route.ts --refresh`: re-derive each candidate's `available` from the proxy catalog
 * and its `price` from OpenRouter, without ever touching `kinds` or `jev`.
 *
 * Both endpoints are an in-test Bun.serve, reached through ROUTE_PROXY_URL / ROUTE_PRICES_URL, and
 * the table is always a temp copy -- the committed routing.json is never the target.
 */

const ROUTE = join(import.meta.dir, '..', 'scripts', 'lib', 'route.ts')
const FIXTURE = join(import.meta.dir, 'fixtures', 'routing', 'table.json')
const DEAD = 'http://127.0.0.1:1/v1/models'

type Model = { id: string; owned_by: string }
type Price = { id: string; pricing: { prompt: string; completion: string } }

const FULL_CATALOG: Model[] = [
  { id: 'claude-sonnet-5-5', owned_by: 'anthropic' },
  { id: 'claude-opus-5-5', owned_by: 'anthropic' },
  { id: 'gemini-3.7-flash-high', owned_by: 'antigravity' },
  { id: 'gpt-5.6-luna', owned_by: 'openai' },
]
const PRICES: Price[] = [
  { id: 'anthropic/claude-sonnet-5.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'anthropic/claude-opus-5.5', pricing: { prompt: '0.000004', completion: '0.00002' } },
  { id: 'some/other-model', pricing: { prompt: '0.000001', completion: '0.000002' } },
]

function tableCopy(edit: (t: any) => void = () => {}): string {
  const t = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  edit(t)
  const p = join(mkTmp('route-refresh-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2) + '\n')
  return p
}

/** One server answering both the proxy catalog and the OpenRouter price list. */
function stubEndpoints(catalog: Model[], prices: Price[] = PRICES) {
  const hits = { proxy: 0, prices: 0 }
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/v1/models') { hits.proxy++; return Response.json({ data: catalog }) }
      if (path === '/prices') { hits.prices++; return Response.json({ data: prices }) }
      return new Response('not found', { status: 404 })
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  return {
    env: { ROUTE_PROXY_URL: `${base}/v1/models`, ROUTE_PRICES_URL: `${base}/prices` },
    hits,
    stop: () => server.stop(true),
  }
}

async function refresh(args: string[], env: Record<string, string>) {
  const { ROUTING_TABLE: _t, ...base } = HERMETIC_ENV
  const p = Bun.spawn(['bun', ROUTE, '--refresh', ...args], {
    // The dead defaults make a refresh that ignores its env fail locally rather than reach the network.
    // Dummy keys keep the signal sources off `op`; their dead URLs keep them off the network.
    env: { ...base, ROUTE_PROXY_URL: DEAD, ROUTE_PRICES_URL: 'http://127.0.0.1:1/prices',
      ROUTE_RANKINGS_URL: 'http://127.0.0.1:1/rankings', ROUTE_AA_URL: 'http://127.0.0.1:1/aa',
      ROUTE_SLOP_URL: 'http://127.0.0.1:1/',
      OPENROUTER_API_KEY: 'test-or-key', ARTIFICIAL_ANALYSIS_API_KEY: 'test-aa-key',
      WORK_HOLD_DECISIONS_URL: 'http://127.0.0.1:1/', WORK_HOLD_JUDGE_TOKEN: 'test-token',
      // `bun test` runs in UTC while a bare `bun` child runs in the system zone, so from 20:00 to
      // midnight EDT the child's asOf was a day behind today() here. One zone for both.
      TZ: Intl.DateTimeFormat().resolvedOptions().timeZone, ...env },
    stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 20_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr }
}

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

test('a full catalog marks every candidate available and exits 0', async () => {
  const table = tableCopy(t => { t.candidates.opus.available = false })
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.stderr).not.toContain('not implemented')
    expect(r.code).toBe(0)
    const t = read(table)
    for (const id of ['sonnet', 'opus', 'flash', 'luna']) expect(t.candidates[id].available).toBe(true)
    expect(s.hits.proxy).toBeGreaterThan(0)
  } finally { s.stop() }
}, 30_000)

test('asOf becomes today; kinds are untouched', async () => {
  const table = tableCopy()
  const before = read(table)
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(0)
    const after = read(table)
    expect(after.asOf).toBe(today())
    expect(after.kinds).toEqual(before.kinds)
  } finally { s.stop() }
}, 30_000)

test('kinds survive even when every pick goes unavailable', async () => {
  const table = tableCopy()
  const before = read(table)
  const s = stubEndpoints([])
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(1)
    const after = read(table)
    expect(after.kinds).toEqual(before.kinds)
  } finally { s.stop() }
}, 30_000)

test('prices come from the matching OpenRouter entry, as numbers', async () => {
  const table = tableCopy()
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(0)
    const t = read(table)
    expect(t.candidates.sonnet.price).toEqual({ prompt: 0.000003, completion: 0.000015 })
    expect(t.candidates.opus.price).toEqual({ prompt: 0.000004, completion: 0.00002 })
    expect(typeof t.candidates.sonnet.price.prompt).toBe('number')
  } finally { s.stop() }
}, 30_000)

test('a price is unchanged when openrouter is null or not listed', async () => {
  const table = tableCopy()
  const before = read(table)
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(0)
    const t = read(table)
    expect(t.candidates.flash.price).toEqual(before.candidates.flash.price)   // google/gemini-3.7-flash not listed
    expect(t.candidates.luna.price).toBeNull()                                // openrouter null
  } finally { s.stop() }
}, 30_000)

test('an owned_by mismatch makes a candidate unavailable; its kind is named and exit is 1', async () => {
  const table = tableCopy()
  const catalog = FULL_CATALOG.map(m => m.id === 'gemini-3.7-flash-high' ? { ...m, owned_by: 'google' } : m)
  const s = stubEndpoints(catalog)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('bulk')
    const t = read(table)
    expect(t.candidates.flash.available).toBe(false)     // written despite the exit 1
    expect(t.candidates.sonnet.available).toBe(true)
    expect(t.asOf).toBe(today())
  } finally { s.stop() }
}, 30_000)

test('a model missing from the catalog names every kind it was the pick of', async () => {
  const table = tableCopy()
  const s = stubEndpoints(FULL_CATALOG.filter(m => m.id !== 'claude-sonnet-5-5'))
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('script')
    expect(r.stderr).toContain('review')
    expect(read(table).candidates.sonnet.available).toBe(false)
  } finally { s.stop() }
}, 30_000)

test('an unavailable fallback alone does not fail the refresh', async () => {
  const table = tableCopy()
  // luna is no kind's pick, so losing it changes availability but leaves every pick standing.
  const s = stubEndpoints(FULL_CATALOG.filter(m => m.id !== 'gpt-5.6-luna'))
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(0)
    expect(read(table).candidates.luna.available).toBe(false)
  } finally { s.stop() }
}, 30_000)

test('a gemini-vertex candidate is never re-derived from the proxy catalog', async () => {
  const table = tableCopy(t => {
    t.candidates.batch = { provider: 'gemini-vertex', model: 'gemini-3.1-flash-lite', owner: 'google',
      openrouter: null, available: true, price: null }
  })
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(0)
    expect(read(table).candidates.batch.available).toBe(true)
  } finally { s.stop() }
}, 30_000)

test('the table is rewritten as pretty JSON', async () => {
  const table = tableCopy()
  writeFileSync(table, JSON.stringify(read(table)))                // minified going in
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], s.env)
    expect(r.code).toBe(0)
    const text = readFileSync(table, 'utf8')
    expect(text).toContain('\n  "')
    expect(read(table).asOf).toBe(today())
  } finally { s.stop() }
}, 30_000)

test('ROUTING_TABLE names the table when --table is absent', async () => {
  const table = tableCopy()
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh([], { ...s.env, ROUTING_TABLE: table })
    expect(r.code).toBe(0)
    expect(read(table).asOf).toBe(today())
  } finally { s.stop() }
}, 30_000)

test('an unreachable proxy exits 2 and leaves the file byte-identical', async () => {
  const table = tableCopy()
  const before = readFileSync(table)
  const s = stubEndpoints(FULL_CATALOG)
  try {
    const r = await refresh(['--table', table], { ...s.env, ROUTE_PROXY_URL: DEAD })
    expect(r.code).toBe(2)
    expect(readFileSync(table).equals(before)).toBe(true)
  } finally { s.stop() }
}, 30_000)
