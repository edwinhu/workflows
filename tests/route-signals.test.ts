import { test, expect } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

/**
 * The spec for the signals `route.ts --refresh` records (usageRank from OpenRouter's rankings
 * dataset, intelligenceIndex from Artificial Analysis), the runtime-only key lookup, and the
 * read-only `route.ts --propose`.
 *
 * Every endpoint is an in-test Bun.serve and `op` is a PATH stub: nothing reaches the network or
 * 1Password, and the table is always a temp copy.
 */

const ROUTE = join(import.meta.dir, '..', 'scripts', 'lib', 'route.ts')
const FIXTURE = join(import.meta.dir, 'fixtures', 'routing', 'table.json')
const DEAD = 'http://127.0.0.1:1'
const OR_KEY = 'sk-or-SENTINEL-4f1c9a'
const AA_KEY = 'aa-SENTINEL-77d0e2'

const CATALOG = [
  { id: 'claude-sonnet-5-5', owned_by: 'anthropic' },
  { id: 'claude-opus-5-5', owned_by: 'anthropic' },
  { id: 'gemini-3.7-flash-high', owned_by: 'antigravity' },
  { id: 'gpt-5.6-luna', owned_by: 'openai' },
]
const RANKINGS = {
  data: [
    { date: '2026-09-30', model_permaslug: 'google/gemini-3.7-flash-20260801', total_tokens: '900' },
    { date: '2026-09-30', model_permaslug: 'anthropic/claude-5.5-sonnet-20260715', total_tokens: '500' },
    { date: '2026-10-01', model_permaslug: 'anthropic/claude-sonnet-5.5:thinking', total_tokens: '600' },
    { date: '2026-10-01', model_permaslug: 'other', total_tokens: '99999' },
  ],
  meta: { as_of: '2026-10-01T00:00:00Z', start_date: '2026-09-02', end_date: '2026-10-01', version: 'v1' },
}
const AA = {
  status: 200,
  data: [
    { id: 'a', name: 'Claude Sonnet 5.5', slug: 'claude-sonnet-5-5', model_creator: { slug: 'anthropic' }, evaluations: { artificial_analysis_intelligence_index: 70 } },
    { id: 'b', name: 'Claude Opus 5.5', slug: 'claude-5-5-opus', model_creator: { slug: 'anthropic' }, evaluations: { artificial_analysis_intelligence_index: 74 } },
    { id: 'c', name: 'Gemini 3.7 Flash', slug: 'gemini-3-7-flash', model_creator: { slug: 'google' }, evaluations: { artificial_analysis_intelligence_index: 61 } },
    { id: 'd', name: 'Not ours', slug: 'claude-sonnet-5-5', model_creator: { slug: 'someone-else' }, evaluations: { artificial_analysis_intelligence_index: 99 } },
  ],
}

function tableCopy(edit: (t: any) => void = () => {}): string {
  const t = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  edit(t)
  const p = join(mkTmp('route-signals-'), 'table.json')
  writeFileSync(p, JSON.stringify(t, null, 2) + '\n')
  return p
}

type Seen = { path: string; auth: string | null; apiKey: string | null }

function stubAll(opts: { aaStatus?: number; rankingsStatus?: number } = {}) {
  const seen: Seen[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      seen.push({ path, auth: req.headers.get('authorization'), apiKey: req.headers.get('x-api-key') })
      if (path === '/v1/models') return Response.json({ data: CATALOG })
      if (path === '/prices') return Response.json({ data: [] })
      if (path === '/rankings')
        return opts.rankingsStatus ? new Response('no', { status: opts.rankingsStatus }) : Response.json(RANKINGS)
      if (path === '/aa') return opts.aaStatus ? new Response('no', { status: opts.aaStatus }) : Response.json(AA)
      return new Response('not found', { status: 404 })
    },
  })
  const base = `http://127.0.0.1:${server.port}`
  return {
    env: {
      ROUTE_PROXY_URL: `${base}/v1/models`, ROUTE_PRICES_URL: `${base}/prices`,
      ROUTE_RANKINGS_URL: `${base}/rankings`, ROUTE_AA_URL: `${base}/aa`,
    },
    seen,
    stop: () => server.stop(true),
  }
}

/** An `op` on PATH that logs its argv and token, and answers `op read` per ref (or fails). */
function stubOp(answers: Record<string, string> | 'fail') {
  const dir = mkTmp('route-op-')
  const log = join(dir, 'op.log')
  const xdg = join(dir, 'xdg')
  mkdirSync(join(xdg, 'agenix'), { recursive: true })
  writeFileSync(join(xdg, 'agenix', 'op-service-account-token'), 'ops_FAKE_TOKEN\n')
  const cases = answers === 'fail' ? '' : Object.entries(answers).map(([ref, v]) => `  "${ref}") printf '%s' '${v}'; exit 0;;`).join('\n')
  writeFileSync(join(dir, 'op'), `#!/bin/sh
printf 'argv=%s|token=%s\\n' "$*" "$OP_SERVICE_ACCOUNT_TOKEN" >> '${log}'
case "$3" in
${cases}
esac
echo '[ERROR] could not read secret: item not found' >&2
exit 1
`)
  chmodSync(join(dir, 'op'), 0o755)
  return { dir, log, xdg, calls: () => { try { return readFileSync(log, 'utf8') } catch { return '' } } }
}

async function run(args: string[], env: Record<string, string>) {
  const { ROUTING_TABLE: _t, OPENROUTER_API_KEY: _o, ARTIFICIAL_ANALYSIS_API_KEY: _a, OP_SERVICE_ACCOUNT_TOKEN: _s, ...base } =
    HERMETIC_ENV as Record<string, string>
  const p = Bun.spawn(['bun', ROUTE, ...args], {
    env: {
      ...base, ROUTE_PROXY_URL: `${DEAD}/v1/models`, ROUTE_PRICES_URL: `${DEAD}/prices`,
      ROUTE_RANKINGS_URL: `${DEAD}/rankings`, ROUTE_AA_URL: `${DEAD}/aa`, ROUTE_SLOP_URL: `${DEAD}/`,
      WORK_HOLD_DECISIONS_URL: `${DEAD}/`, WORK_HOLD_JUDGE_TOKEN: 'test-token', ...env,
    },
    stdout: 'pipe', stderr: 'pipe',
  })
  const killer = setTimeout(() => p.kill(), 20_000)
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  clearTimeout(killer)
  return { code, stdout, stderr }
}

const KEYS = { OPENROUTER_API_KEY: OR_KEY, ARTIFICIAL_ANALYSIS_API_KEY: AA_KEY }
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

function noKeyLeaks(r: { stdout: string; stderr: string }, table: string) {
  const raw = readFileSync(table, 'utf8')
  for (const k of [OR_KEY, AA_KEY]) {
    expect(raw).not.toContain(k)
    expect(r.stdout).not.toContain(k)
    expect(r.stderr).not.toContain(k)
  }
}

// ---------------------------------------------------------------------------------- refresh

test('refresh records usageRank and intelligenceIndex, one request per source, keys sent as headers', async () => {
  const s = stubAll()
  const table = tableCopy()
  try {
    const r = await run(['--refresh', '--table', table], { ...s.env, ...KEYS })
    expect(r.code).toBe(0)
    const rank = s.seen.filter(x => x.path === '/rankings')
    const aa = s.seen.filter(x => x.path === '/aa')
    expect(rank).toHaveLength(1)
    expect(aa).toHaveLength(1)
    expect(rank[0].auth).toBe(`Bearer ${OR_KEY}`)
    expect(aa[0].apiKey).toBe(AA_KEY)
    const t = read(table)
    // sonnet: 500 + 600 tokens across a dated permaslug and a :variant, outranking flash's 900; `other` is never ranked.
    expect(t.candidates.sonnet.signals).toMatchObject({ usageRank: 1, intelligenceIndex: 70 })
    expect(t.candidates.flash.signals).toMatchObject({ usageRank: 2, intelligenceIndex: 61 })
    // opus matches AA's reordered slug but is absent from the rankings.
    expect(t.candidates.opus.signals).toMatchObject({ usageRank: null, intelligenceIndex: 74 })
    expect(typeof t.candidates.sonnet.signals.asOf).toBe('string')
    // luna has no openrouter slug, so it gets no signals at all.
    expect(t.candidates.luna.signals).toBeUndefined()
    expect(r.stdout).toContain('Source: OpenRouter (openrouter.ai/rankings), as of 2026-10-01T00:00:00Z.')
    noKeyLeaks(r, table)
  } finally { s.stop() }
}, 30_000)

test('a failing source leaves its field untouched, warns on stderr, and the refresh still succeeds', async () => {
  const s = stubAll({ aaStatus: 500 })
  const prior = { usageRank: 9, intelligenceIndex: 42, asOf: '2026-01-01' }
  const table = tableCopy(t => { t.candidates.sonnet.signals = prior })
  try {
    const r = await run(['--refresh', '--table', table], { ...s.env, ...KEYS })
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/intelligenceIndex left unchanged: .*HTTP 500/)
    expect(r.stdout).not.toContain('intelligenceIndex null -> null')
    const sig = read(table).candidates.sonnet.signals
    expect(sig.intelligenceIndex).toBe(42)
    expect(sig.usageRank).toBe(1)
    noKeyLeaks(r, table)
  } finally { s.stop() }
}, 30_000)

test('both sources failing leaves every signal byte-identical and still writes availability', async () => {
  const s = stubAll({ aaStatus: 503, rankingsStatus: 429 })
  const prior = { usageRank: 3, intelligenceIndex: 50, asOf: '2026-01-01' }
  const table = tableCopy(t => { t.candidates.sonnet.signals = prior })
  try {
    const r = await run(['--refresh', '--table', table], { ...s.env, ...KEYS })
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/usageRank left unchanged/)
    expect(r.stderr).toMatch(/intelligenceIndex left unchanged/)
    const t = read(table)
    expect(t.candidates.sonnet.signals).toEqual(prior)
    expect(t.candidates.opus.signals).toBeUndefined()
  } finally { s.stop() }
}, 30_000)

test('with no env keys, keys come from `op read` of the overridable refs with the agenix token, never leaking', async () => {
  const s = stubAll()
  const op = stubOp({ 'op://Test Vault/OR/credential': OR_KEY, 'op://Test Vault/AA/credential': AA_KEY })
  const table = tableCopy()
  try {
    const r = await run(['--refresh', '--table', table], {
      ...s.env, PATH: `${op.dir}:${process.env.PATH}`, XDG_RUNTIME_DIR: op.xdg,
      ROUTE_OPENROUTER_KEY_REF: 'op://Test Vault/OR/credential', ROUTE_AA_KEY_REF: 'op://Test Vault/AA/credential',
    })
    expect(r.code).toBe(0)
    const calls = op.calls()
    expect(calls).toContain('argv=read --no-newline op://Test Vault/OR/credential|token=ops_FAKE_TOKEN')
    expect(calls).toContain('argv=read --no-newline op://Test Vault/AA/credential|token=ops_FAKE_TOKEN')
    expect(s.seen.find(x => x.path === '/rankings')?.auth).toBe(`Bearer ${OR_KEY}`)
    expect(s.seen.find(x => x.path === '/aa')?.apiKey).toBe(AA_KEY)
    expect(read(table).candidates.sonnet.signals).toMatchObject({ usageRank: 1, intelligenceIndex: 70 })
    noKeyLeaks(r, table)
  } finally { s.stop() }
}, 30_000)

test('with no $OPENROUTER_API_KEY, the agenix secret file supplies it and op is never asked for OpenRouter', async () => {
  const s = stubAll()
  const op = stubOp({ 'op://Test Vault/AA/credential': AA_KEY })
  const keyFile = join(op.xdg, 'agenix', 'openrouter-api-key')
  writeFileSync(keyFile, `${OR_KEY}\n`)
  const table = tableCopy()
  try {
    for (const where of [{ XDG_RUNTIME_DIR: op.xdg }, { XDG_RUNTIME_DIR: join(op.dir, 'elsewhere'), ROUTE_OPENROUTER_KEY_FILE: keyFile }]) {
      s.seen.length = 0
      const r = await run(['--refresh', '--table', table], {
        ...s.env, PATH: `${op.dir}:${process.env.PATH}`, ...where,
        ROUTE_OPENROUTER_KEY_REF: 'op://Test Vault/OR/credential', ROUTE_AA_KEY_REF: 'op://Test Vault/AA/credential',
      })
      expect(r.code).toBe(0)
      expect(s.seen.find(x => x.path === '/rankings')?.auth).toBe(`Bearer ${OR_KEY}`)
      expect(s.seen.filter(x => x.path !== '/rankings').every(x => !String(x.auth).includes(OR_KEY) && !String(x.apiKey).includes(OR_KEY))).toBe(true)
      expect(read(table).candidates.sonnet.signals).toMatchObject({ usageRank: 1, intelligenceIndex: 70 })
      noKeyLeaks(r, table)
    }
    expect(op.calls()).not.toContain('op://Test Vault/OR/credential')
    // No AA key file here, so AA still came from op.
    expect(op.calls()).toContain('op://Test Vault/AA/credential')
  } finally { s.stop() }
}, 60_000)

test('with no $ARTIFICIAL_ANALYSIS_API_KEY, the agenix secret file supplies it and op is never asked for AA', async () => {
  const s = stubAll()
  const op = stubOp({ 'op://Test Vault/OR/credential': OR_KEY })
  const keyFile = join(op.xdg, 'agenix', 'artificial-analysis-api-key')
  writeFileSync(keyFile, `${AA_KEY}\n`)
  const table = tableCopy()
  try {
    for (const where of [{ XDG_RUNTIME_DIR: op.xdg }, { XDG_RUNTIME_DIR: join(op.dir, 'elsewhere'), ROUTE_AA_KEY_FILE: keyFile }]) {
      s.seen.length = 0
      const r = await run(['--refresh', '--table', table], {
        ...s.env, PATH: `${op.dir}:${process.env.PATH}`, ...where,
        ROUTE_OPENROUTER_KEY_REF: 'op://Test Vault/OR/credential', ROUTE_AA_KEY_REF: 'op://Test Vault/AA/credential',
      })
      expect(r.code).toBe(0)
      expect(s.seen.find(x => x.path === '/aa')?.apiKey).toBe(AA_KEY)
      expect(s.seen.filter(x => x.path !== '/aa').every(x => !String(x.auth).includes(AA_KEY) && !String(x.apiKey).includes(AA_KEY))).toBe(true)
      expect(read(table).candidates.sonnet.signals).toMatchObject({ usageRank: 1, intelligenceIndex: 70 })
      noKeyLeaks(r, table)
    }
    expect(op.calls()).not.toContain('op://Test Vault/AA/credential')
    // No OpenRouter key file here, so OpenRouter still came from op.
    expect(op.calls()).toContain('op://Test Vault/OR/credential')
  } finally { s.stop() }
}, 60_000)

test('no key anywhere: both sources say so on stderr, no request is made, the refresh succeeds', async () => {
  const s = stubAll()
  const op = stubOp('fail')
  const table = tableCopy()
  try {
    const r = await run(['--refresh', '--table', table], {
      ...s.env, PATH: `${op.dir}:${process.env.PATH}`, XDG_RUNTIME_DIR: op.xdg,
      ROUTE_OPENROUTER_KEY_REF: 'op://Test Vault/OR/credential', ROUTE_AA_KEY_REF: 'op://Test Vault/AA/credential',
    })
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/usageRank left unchanged: no \$OPENROUTER_API_KEY, and op read op:\/\/Test Vault\/OR\/credential failed/)
    expect(r.stderr).toMatch(/intelligenceIndex left unchanged: no \$ARTIFICIAL_ANALYSIS_API_KEY/)
    expect(s.seen.filter(x => x.path === '/rankings' || x.path === '/aa')).toHaveLength(0)
    expect(read(table).candidates.sonnet.signals).toBeUndefined()
  } finally { s.stop() }
}, 30_000)

// ---------------------------------------------------------------------------------- propose

const sig = (intelligenceIndex: number | null, usageRank: number | null = null) => ({ usageRank, intelligenceIndex, asOf: '2026-10-02' })

/** The fixture plus a second gemini candidate, with signals on every candidate. */
function proposeTable(edit: (t: any) => void = () => {}): string {
  return tableCopy(t => {
    t.candidates.flash38 = {
      provider: 'gemini', model: 'gemini-3.8-flash-high', owner: 'antigravity', openrouter: 'google/gemini-3.8-flash',
      available: true, price: { prompt: 7.5e-7, completion: 3.75e-6 },
    }
    for (const [id, v] of Object.entries({ sonnet: 70, opus: 74, flash: 61, flash38: 60 }))
      t.candidates[id].signals = sig(v)
    edit(t)
  })
}

test('propose: nothing to change prints no change proposed, exits 0, and never writes', async () => {
  const table = proposeTable()
  const before = readFileSync(table, 'utf8')
  const r = await run(['--propose', '--table', table], {})
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('no change proposed')
  expect(readFileSync(table, 'utf8')).toBe(before)
}, 30_000)

test('propose: a same-provider candidate with a higher index at <= price replaces a non-default pick', async () => {
  const table = proposeTable(t => { t.candidates.flash38.signals = sig(66) })
  const before = readFileSync(table, 'utf8')
  const r = await run(['--propose', '--table', table], {})
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/^kind bulk: flash \[sonnet\] -> flash38 \[sonnet, flash\] — flash38 is gemini like flash, intelligenceIndex 66 > 61/m)
  expect(readFileSync(table, 'utf8')).toBe(before)
}, 30_000)

test('propose: never a dearer, unavailable, or other-provider candidate', async () => {
  for (const edit of [
    (t: any) => { t.candidates.flash38.signals = sig(66); t.candidates.flash38.price.prompt = 1e-6 },
    (t: any) => { t.candidates.flash38.signals = sig(66); t.candidates.flash38.available = false },
    // Only sonnet (claude) beats flash; flash38 is pushed below so the other-provider case is isolated.
    (t: any) => { t.candidates.flash.signals = sig(10); t.candidates.flash38.signals = sig(5) },
  ]) {
    const r = await run(['--propose', '--json', '--table', proposeTable(edit)], {})
    expect(r.code).toBe(0)
    const bulk = JSON.parse(r.stdout).proposals.find((p: any) => p.kind === 'bulk')
    expect(bulk?.to.pick ?? 'flash').toBe('flash')
  }
}, 30_000)

test('propose: the Claude default picks are never proposed away', async () => {
  // Each default has a same-provider rival at <= price with a higher index; none moves.
  const table = proposeTable(t => {
    t.candidates.sonnet.signals = sig(90)
    t.candidates.opus.signals = sig(95)
    t.candidates.opus.price.prompt = 1e-6
  })
  const r = await run(['--propose', '--json', '--table', table], {})
  expect(r.code).toBe(0)
  const byKind = Object.fromEntries(JSON.parse(r.stdout).proposals.map((p: any) => [p.kind, p]))
  expect(byKind.judgement?.to.pick ?? 'opus').toBe('opus')
  expect(byKind.script?.to.pick ?? 'sonnet').toBe('sonnet')
  expect(byKind.review?.to.pick ?? 'sonnet').toBe('sonnet')
}, 30_000)

test('propose --json: fallbacks reorder by index, usage, price among available, unavailable last, none dropped', async () => {
  const table = proposeTable(t => {
    t.kinds.review = { pick: 'sonnet', fallbacks: ['flash', 'luna', 'opus', 'flash38'] }
    t.candidates.flash38.available = false
    t.candidates.flash38.signals = sig(99)
  })
  const r = await run(['--propose', '--json', '--table', table], {})
  expect(r.code).toBe(0)
  const out = JSON.parse(r.stdout)
  expect(out.proposals).toEqual([
    {
      kind: 'review',
      from: { pick: 'sonnet', fallbacks: ['flash', 'luna', 'opus', 'flash38'] },
      to: { pick: 'sonnet', fallbacks: ['opus', 'flash', 'luna', 'flash38'] },
      reason: 'fallbacks by index, usage, price among available: opus 74, flash 61, luna null',
    },
  ])
}, 30_000)

test('propose on a malformed table exits 2 and writes nothing', async () => {
  const table = tableCopy(t => { t.candidates.sonnet.signals = { usageRank: 'x' } })
  const before = readFileSync(table, 'utf8')
  const r = await run(['--propose', '--table', table], {})
  expect(r.code).toBe(2)
  expect(r.stderr).toContain('signals must be')
  expect(readFileSync(table, 'utf8')).toBe(before)
}, 30_000)

test('--json without --propose, and --propose with --refresh, are refused', async () => {
  const table = proposeTable()
  expect((await run(['--refresh', '--json', '--table', table], {})).code).toBe(2)
  expect((await run(['--propose', '--refresh', '--table', table], {})).code).toBe(2)
}, 30_000)

/** bulk's pick is flash (61, 7.5e-7); flash38 and flash39 are two more gemini candidates, both at index 66. */
function rankTable(edit: (t: any) => void) {
  return proposeTable(t => {
    t.candidates.flash39 = {
      provider: 'gemini', model: 'gemini-3.9-flash-high', owner: 'antigravity', openrouter: 'google/gemini-3.9-flash',
      available: true, price: { prompt: 5e-7, completion: 2.5e-6 },
    }
    t.candidates.flash38.signals = sig(66)
    t.candidates.flash39.signals = sig(66)
    edit(t)
  })
}
async function bulkTo(table: string) {
  const r = await run(['--propose', '--json', '--table', table], {})
  expect(r.code).toBe(0)
  return JSON.parse(r.stdout).proposals.find((p: any) => p.kind === 'bulk').to.pick
}

test('propose rank: on an index tie the more-used candidate wins even when pricier (within the price filter)', async () => {
  const table = rankTable(t => {
    t.candidates.flash38.signals = sig(66, 3)
    t.candidates.flash39.signals = sig(66, 9)
  })
  expect(await bulkTo(table)).toBe('flash38')
}, 30_000)

test('propose rank: a null usageRank loses an index tie to any ranked candidate, then price decides between nulls', async () => {
  expect(await bulkTo(rankTable(t => { t.candidates.flash38.signals = sig(66, null); t.candidates.flash39.signals = sig(66, 40) }))).toBe('flash39')
  expect(await bulkTo(rankTable(() => {}))).toBe('flash39')
}, 30_000)

test('propose rank: on an index and usage tie the lower price wins', async () => {
  const table = rankTable(t => {
    t.candidates.flash38.signals = sig(66, 5)
    t.candidates.flash39.signals = sig(66, 5)
  })
  expect(await bulkTo(table)).toBe('flash39')
}, 30_000)

test('propose rank: a higher index beats better usage', async () => {
  const table = rankTable(t => {
    t.candidates.flash38.signals = sig(70, 9)
    t.candidates.flash39.signals = sig(66, 1)
  })
  expect(await bulkTo(table)).toBe('flash38')
}, 30_000)

test('propose rank: fallbacks on an index tie order by usage, then price, then table order', async () => {
  const table = rankTable(t => {
    t.kinds.review = { pick: 'sonnet', fallbacks: ['flash', 'flash38', 'flash39', 'opus'] }
    t.candidates.opus.signals = sig(80, 7)
    t.candidates.flash.signals = sig(66, 9)
    t.candidates.flash38.signals = sig(66, 2)
    t.candidates.flash39.signals = sig(66, 2)
  })
  const r = await run(['--propose', '--json', '--table', table], {})
  expect(r.code).toBe(0)
  const review = JSON.parse(r.stdout).proposals.find((p: any) => p.kind === 'review')
  expect(review.to.fallbacks).toEqual(['opus', 'flash39', 'flash38', 'flash'])
}, 30_000)
