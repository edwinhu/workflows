/**
 * route — the one place a farm-out row's provider and model are chosen.
 *
 * Reads `routing.json` beside this module, the way gemini-models.ts reads its table: a row names a
 * KIND, never a model, and the table maps each kind to a pinned candidate plus fallbacks. Pinned
 * ids matter because an unpinned wrapper slot is wrapper-local and can name another family.
 *
 * Table path, highest wins:
 *   1. `--table <path>` (CLI) or loadTable(path)
 *   2. $ROUTING_TABLE
 *   3. routing.json beside this file
 *
 * A row resolves in this order:
 *   model (with or without  passed through, source 'explicit'; Jev is not consulted
 *   a provider)
 *   kind and provider       provider-constrained: the first AVAILABLE candidate of that provider in
 *                           the kind's chain (pick, then fallbacks, in order); source 'table'; Jev is
 *                           not consulted. REFUSED (exit 2, stderr names the kind and the provider)
 *                           when the chain has candidates of that provider but none is available.
 *                           A chain with no candidate of that provider, or an unknown kind, falls
 *                           to the provider rung below.
 *   provider                passed through with a null model, source 'explicit'; Jev not consulted
 *   kind                    the kind's pick, else its first AVAILABLE fallback; source 'table'
 *   neither, unknown kind,  REFUSED: exit 2, nothing on stdout, stderr names every kind.
 *   or nothing available    A refusal never falls through to a default.
 *
 * Jev (the Decisions API, through hooks/work-hold.ts `decisionsCall` — the one transport) scores
 * the kind's chain (pick, then fallbacks) in ONE call per kind-only row, capped at
 * jev.timeoutSeconds; a candidate outside the chain is never asked about and never chosen. In
 * 'shadow' mode the scores are recorded and never change the pick. In 'decide' mode the cheapest
 * available chain candidate scoring at least jev.threshold wins (source 'jev'); otherwise the
 * table pick stands.
 * Any Jev failure leaves the table pick and sets shadow.unavailable — Jev never blocks a row.
 * The state sent to Jev summarises the row; it never carries the prompt text.
 *
 *   bun scripts/lib/route.ts --row '<json>' [--table <path>]   # one decision as one JSON line
 *   bun scripts/lib/route.ts --refresh [--table <path>]        # re-derive availability, prices, signals
 *   bun scripts/lib/route.ts --propose [--table <path>] [--json]  # advisory kinds diff; never writes
 *
 * --refresh is the only sanctioned writer of `available`, `price`, `signals` and `asOf`; it never
 * touches `kinds` or `jev`. Availability comes from the proxy catalog ($ROUTE_PROXY_URL), prices from
 * OpenRouter ($ROUTE_PRICES_URL), each fetched once. Exit 0; exit 1 when some kind's pick is now
 * unavailable (the table is still written); exit 2 when the proxy or the table cannot be read, with
 * the file left byte-identical. An unreachable price list leaves prices as they were.
 *
 * Signals, for candidates with an `openrouter` slug only, one request per source per refresh:
 *   usageRank          1 = most tokens summed over OpenRouter's rankings dataset window
 *                      ($ROUTE_RANKINGS_URL, default GET /api/v1/datasets/rankings-daily: last 30
 *                      days, top 50 per day). A permaslug's `:variant` and trailing date suffix are
 *                      folded into its base slug before summing; the `other` row is never ranked.
 *   intelligenceIndex  evaluations.artificial_analysis_intelligence_index from Artificial Analysis
 *                      ($ROUTE_AA_URL, default GET /api/v2/data/llms/models). Matched when the AA
 *                      creator slug equals the slug's prefix and the AA model slug has the same
 *                      tokens (lowercase, split on - . _ /) as the slug's model part, in any order;
 *                      the highest index wins when several AA entries match.
 *   asOf               the date of the last refresh in which either source answered.
 * No match is null. A source with no key, or one that fails, leaves that field as it was and says so
 * on stderr; it never fails the refresh. Keys are read at RUNTIME and never written anywhere:
 * $OPENROUTER_API_KEY / $ARTIFICIAL_ANALYSIS_API_KEY; for OpenRouter only, then the agenix secret
 * $ROUTE_OPENROUTER_KEY_FILE (default $XDG_RUNTIME_DIR/agenix/openrouter-api-key); else `op read` of
 * $ROUTE_OPENROUTER_KEY_REF / $ROUTE_AA_KEY_REF (defaults below), with the agenix service-account
 * token loaded when unset.
 *
 * --propose reads signals, prices and availability and prints suggested `kinds` changes; the user
 * decides and hand-edits the table. Its rule, per kind, exactly:
 *   pick       PROTECTED when it is the user's Claude default for the kind (judgement:
 *              claude-opus-5-5; script and review: claude-sonnet-5-5) — never proposed away.
 *              Otherwise replaced by the AVAILABLE candidate of the SAME provider whose
 *              intelligenceIndex is strictly higher than the pick's and whose price.prompt is <=
 *              the pick's (both indexes and both prices known); highest index wins, then the lower
 *              price, then table order. A replaced pick becomes a fallback.
 *   fallbacks  the same members (never added, never dropped), available ones ordered by
 *              intelligenceIndex descending (null last, ties keep table order), unavailable ones
 *              after them in table order.
 * Exit 0 always ('no change proposed' when nothing differs); exit 2 when the table cannot be read.
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { decisionsCall } from '../../hooks/work-hold.ts'

export type Provider = 'claude' | 'codex' | 'gemini' | 'gemini-batch'
export type Kind = 'script' | 'judgement' | 'review' | 'bulk'

export interface Candidate {
  provider: Provider
  model: string
  owner: 'anthropic' | 'openai' | 'antigravity' | 'google'
  openrouter: string | null
  available: boolean
  price: { prompt: number; completion: number } | null
  signals?: Signals
}

export interface Signals {
  usageRank: number | null
  intelligenceIndex: number | null
  asOf: string
}

export interface Table {
  _comment?: string
  asOf: string
  jev: { mode: 'shadow' | 'decide'; model: string; threshold: number; timeoutSeconds: number }
  candidates: Record<string, Candidate>
  kinds: Record<Kind, { pick: string; fallbacks: string[] }>
}

export interface Row {
  label?: string
  prompt?: string
  kind?: string
  provider?: string
  model?: string
  agent?: string
  expect?: string | string[]
}

export type Shadow = { scores: Record<string, number> } | { unavailable: string }

export interface Decision {
  provider: string
  model: string | null
  kind: string | null
  candidate: string | null
  source: 'explicit' | 'table' | 'jev'
  shadow: Shadow
}

/** A row that cannot be routed. The CLI maps it to exit 2: the caller asked wrongly. */
export class RouteRefusal extends Error {
  readonly exitCode = 2
}

const PROVIDERS: readonly Provider[] = ['claude', 'codex', 'gemini', 'gemini-batch']
/** A row naming a model the table does not know goes to the wrapper that runs most rows. */
const DEFAULT_PROVIDER = 'claude'

export const DEFAULT_TABLE = join(import.meta.dir, 'routing.json')

export function tablePath(explicit?: string): string {
  return explicit || process.env.ROUTING_TABLE || DEFAULT_TABLE
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Load and validate the routing table. Throws on a malformed table rather than routing from part of
 * one — a typo'd candidate id would otherwise send rows to whatever the code fell back to.
 */
export function loadTable(path?: string): Table {
  const p = tablePath(path)
  const t: unknown = JSON.parse(readFileSync(p, 'utf8'))
  validateTable(t, p)
  return t
}

function validateTable(t: unknown, p: string): asserts t is Table {
  const bad = (why: string): never => {
    throw new Error(`routing table ${p}: ${why}`)
  }
  if (!isObj(t)) bad('not a JSON object')
  const tt = t as Record<string, any>
  const j = tt.jev
  if (!isObj(j)) bad('jev is missing')
  if (j.mode !== 'shadow' && j.mode !== 'decide') bad(`jev.mode must be shadow or decide, not ${JSON.stringify(j.mode)}`)
  if (typeof j.model !== 'string' || !j.model) bad('jev.model must be a model id')
  if (typeof j.threshold !== 'number' || !(j.threshold >= 0 && j.threshold <= 1)) bad('jev.threshold must be a number in [0, 1]')
  if (typeof j.timeoutSeconds !== 'number' || !(j.timeoutSeconds > 0)) bad('jev.timeoutSeconds must be a positive number')

  if (!isObj(tt.candidates) || Object.keys(tt.candidates).length === 0) bad('candidates is missing or empty')
  for (const [id, c] of Object.entries(tt.candidates as Record<string, any>)) {
    if (!isObj(c)) bad(`candidate ${id} is not an object`)
    if (!PROVIDERS.includes(c.provider)) bad(`candidate ${id}: provider must be one of ${PROVIDERS.join(', ')}`)
    if (typeof c.model !== 'string' || !c.model) bad(`candidate ${id}: model must be a pinned model id`)
    if (typeof c.available !== 'boolean') bad(`candidate ${id}: available must be true or false`)
    if (c.price !== null && !(isObj(c.price) && typeof c.price.prompt === 'number' && typeof c.price.completion === 'number'))
      bad(`candidate ${id}: price must be null or {prompt, completion} numbers`)
    if (c.signals !== undefined) {
      const s = c.signals
      const numOrNull = (v: unknown) => v === null || typeof v === 'number'
      if (!isObj(s) || !numOrNull(s.usageRank) || !numOrNull(s.intelligenceIndex) || typeof s.asOf !== 'string')
        bad(`candidate ${id}: signals must be {usageRank, intelligenceIndex: number|null, asOf: string}`)
    }
  }

  if (!isObj(tt.kinds) || Object.keys(tt.kinds).length === 0) bad('kinds is missing or empty')
  for (const [kind, k] of Object.entries(tt.kinds as Record<string, any>)) {
    if (!isObj(k) || typeof k.pick !== 'string' || !Array.isArray(k.fallbacks)) bad(`kind ${kind} needs {pick, fallbacks[]}`)
    for (const id of [k.pick, ...k.fallbacks])
      if (typeof id !== 'string' || !own(tt.candidates, id)) bad(`kind ${kind} names unknown candidate ${JSON.stringify(id)}`)
  }
}

/** A string field, or undefined when absent or blank. A present non-string is the caller's error. */
function field(row: Record<string, unknown>, name: keyof Row): string | undefined {
  const v = row[name]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new RouteRefusal(`route: row field ${name} must be a string, not ${typeof v}`)
  return v.trim() ? v : undefined
}

/** Route one row. Throws RouteRefusal when the row cannot be routed. */
export function route(row: Row, opts: { table?: Table } = {}): Decision {
  if (!isObj(row)) throw new RouteRefusal('route: a row must be a JSON object')
  const table = opts.table ?? loadTable()
  const r = row as Record<string, unknown>
  const provider = field(r, 'provider')
  const model = field(r, 'model')
  const kind = field(r, 'kind')
  field(r, 'label')
  field(r, 'agent')
  field(r, 'prompt')
  const label = r.label === undefined ? '' : ` ${JSON.stringify(r.label)}`

  if (provider && !model && kind && own(table.kinds, kind)) {
    const constrained = providerConstrained(table, kind as Kind, provider, label)
    if (constrained) return constrained
  }

  if (provider || model) {
    const known = model ? Object.values(table.candidates).find(c => c.model === model) : undefined
    return {
      provider: provider ?? known?.provider ?? DEFAULT_PROVIDER,
      model: model ?? null,
      kind: kind ?? null,
      candidate: null,
      source: 'explicit',
      shadow: { unavailable: 'explicit row: Jev is not consulted' },
    }
  }

  const kinds = Object.keys(table.kinds)
  if (!kind)
    throw new RouteRefusal(
      `route: row${label} names no kind and no provider/model, so it cannot be routed. ` +
        `Set "kind" to one of: ${kinds.join(', ')} -- or name "provider"/"model" explicitly.`,
    )
  if (!own(table.kinds, kind))
    throw new RouteRefusal(
      `route: row${label} has unknown kind ${JSON.stringify(kind)}. Known kinds: ${kinds.join(', ')}.`,
    )

  const entry = table.kinds[kind as Kind]
  const chain = [entry.pick, ...entry.fallbacks]
  const pick = chain.find(id => table.candidates[id].available)
  if (!pick)
    throw new RouteRefusal(
      `route: kind ${kind} has no available candidate (tried ${chain.join(', ')}). ` +
        `Run route.ts --refresh, or name "provider"/"model" on the row.`,
    )

  const shadow = scoreCandidates(r, kind, chain, table)
  let chosen = pick
  let source: Decision['source'] = 'table'
  if (table.jev.mode === 'decide' && 'scores' in shadow) {
    const jevPick = cheapestConfident(table, chain, shadow.scores)
    if (jevPick) {
      chosen = jevPick
      source = 'jev'
    }
  }
  const c = table.candidates[chosen]
  return { provider: c.provider, model: c.model, kind, candidate: chosen, source, shadow }
}

/**
 * A kind+provider row: the first available candidate of `provider` in the kind's chain, never
 * scored by Jev. Undefined when the chain holds no candidate of that provider, so the row passes
 * through as an explicit provider; a refusal when it holds some but none is available, because
 * falling back to another provider would silently drop the constraint the row asked for.
 */
function providerConstrained(table: Table, kind: Kind, provider: string, label: string): Decision | undefined {
  const entry = table.kinds[kind]
  const ofProvider = [entry.pick, ...entry.fallbacks].filter(id => table.candidates[id].provider === provider)
  if (ofProvider.length === 0) return undefined
  const id = ofProvider.find(id => table.candidates[id].available)
  if (!id)
    throw new RouteRefusal(
      `route: row${label} asks for kind ${kind} on provider ${provider}, but no ${provider} candidate in ` +
        `kind ${kind}'s chain is available (tried ${ofProvider.join(', ')}). ` +
        `Run route.ts --refresh, or name "model" on the row.`,
    )
  const c = table.candidates[id]
  return {
    provider: c.provider,
    model: c.model,
    kind,
    candidate: id,
    source: 'table',
    shadow: { unavailable: `provider-constrained row (${provider} in kind ${kind}'s chain): Jev is not consulted` },
  }
}

/** The cheapest available chain candidate at or above threshold. A null price ranks last; ties keep chain order. */
function cheapestConfident(table: Table, chain: string[], scores: Record<string, number>): string | undefined {
  const cost = (id: string) => table.candidates[id].price?.prompt ?? Number.POSITIVE_INFINITY
  return chain
    .filter(id => table.candidates[id].available && (scores[id] ?? -1) >= table.jev.threshold)
    .sort((a, b) => (cost(a) === cost(b) ? 0 : cost(a) < cost(b) ? -1 : 1))[0]
}

/** What Jev sees of a row. A hash and a length stand in for the prompt, whose text never leaves. */
export function jevState(row: Record<string, unknown>, kind: string): string {
  const prompt = typeof row.prompt === 'string' ? row.prompt : ''
  const ex = row.expect
  return JSON.stringify({
    task: 'a delegated agent task (a farm-out row) about to run on one of several model candidates',
    kind,
    label: typeof row.label === 'string' ? row.label : null,
    promptLength: prompt.length,
    promptSha256: createHash('sha256').update(prompt).digest('hex'),
    hasExpect: Array.isArray(ex) ? ex.length > 0 : typeof ex === 'string' && ex.length > 0,
    agent: typeof row.agent === 'string' ? row.agent : null,
  })
}

/** One Decisions call scoring the kind's chain. Never throws: a failure is `{unavailable}`. */
function scoreCandidates(row: Record<string, unknown>, kind: string, chain: string[], table: Table): Shadow {
  const ids = [...new Set(chain)]
  const questions = Object.fromEntries(
    ids.map(id => {
      const c = table.candidates[id]
      return [
        `q_${id}`,
        {
          type: 'choice',
          instructions:
            `If the task summarised in the state is run on candidate "${id}" -- provider ${c.provider}, ` +
            `model ${c.model} -- will the result be CORRECT or WRONG?`,
          criteria: {
            CORRECT: 'the task is done as asked and its result survives independent verification',
            WRONG: 'the result is wrong, incomplete, or fails verification',
          },
        },
      ]
    }),
  )

  let r: ReturnType<typeof decisionsCall>
  try {
    r = decisionsCall(jevState(row, kind), questions, {
      maxTimeSeconds: table.jev.timeoutSeconds,
      model: table.jev.model,
    })
  } catch (e) {
    return { unavailable: `decisions call failed: ${(e as Error).message}` }
  }
  if (r.stdout === null) return { unavailable: r.unavailable }

  let reply: any
  try {
    reply = JSON.parse(r.stdout)
  } catch {
    return { unavailable: 'decision reply was not parsable json' }
  }
  const scores: Record<string, number> = {}
  for (const id of ids) {
    const p = reply?.answers?.[`q_${id}`]?.probabilities?.CORRECT
    if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
      const err = typeof reply?.error?.message === 'string' ? `: ${reply.error.message.slice(0, 200)}` : ''
      return { unavailable: `no CORRECT probability for q_${id} in the decision reply${err}` }
    }
    scores[id] = p
  }
  return { scores }
}

// ------------------------------------------------------------------------------------- CLI

const USAGE =
  "usage: route.ts --row '<json>' [--table <path>]\n       route.ts --refresh [--table <path>]\n" +
  '       route.ts --propose [--table <path>] [--json]'

async function cli(argv: string[]): Promise<number> {
  let rowJson: string | undefined
  let tableArg: string | undefined
  let refresh = false
  let proposeMode = false
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--refresh') refresh = true
    else if (a === '--propose') proposeMode = true
    else if (a === '--json') json = true
    else if (a === '--row' || a === '--table') {
      const v = argv[i + 1]
      if (v === undefined) return refuse(`route: ${a} needs a value\n${USAGE}`)
      if (a === '--row') rowJson = v
      else tableArg = v
      i++
    } else return refuse(`route: unknown argument ${a}\n${USAGE}`)
  }
  if ([refresh, proposeMode, rowJson !== undefined].filter(Boolean).length > 1)
    return refuse(`route: --row, --refresh and --propose are separate modes\n${USAGE}`)
  if (json && !proposeMode) return refuse(`route: --json goes with --propose\n${USAGE}`)
  if (refresh) return refreshCli(tableArg)
  if (proposeMode) return proposeCli(tableArg, json)
  if (rowJson === undefined) return refuse(`route: --row is required\n${USAGE}`)

  let row: unknown
  try {
    row = JSON.parse(rowJson)
  } catch {
    return refuse('route: --row is not valid JSON')
  }

  let table: Table
  try {
    table = loadTable(tableArg)
  } catch (e) {
    process.stderr.write(`route: ${(e as Error).message}\n`)
    return 1
  }

  try {
    process.stdout.write(`${JSON.stringify(route(row as Row, { table }))}\n`)
    return 0
  } catch (e) {
    if (e instanceof RouteRefusal) return refuse(e.message)
    process.stderr.write(`route: ${(e as Error).message}\n`)
    return 1
  }
}

function refuse(msg: string): number {
  process.stderr.write(`${msg}\n`)
  return 2
}

// --------------------------------------------------------------------------------- refresh

const DEFAULT_PROXY_URL = 'http://127.0.0.1:8317/v1/models'
const DEFAULT_PRICES_URL = 'https://openrouter.ai/api/v1/models'
/** The local proxy key every wrapper (claude-code, codex-code, gemini-code) defaults to. */
const PROXY_TOKEN = process.env.CLAUDE_PROXY_TOKEN || 'sk-local-claude-proxy'

type CatalogEntry = { id: string; owned_by: string }
type PriceEntry = { id: string; pricing: { prompt: number; completion: number } }

/** GET a `{data: [...]}` body. Throws on a network error, a timeout, a non-2xx, or another shape. */
async function fetchBody(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body: any = await res.json()
  if (!Array.isArray(body?.data)) throw new Error('reply has no data array')
  return body
}

async function fetchListing(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown[]> {
  return (await fetchBody(url, timeoutMs, headers)).data
}

function toCatalog(data: unknown[]): CatalogEntry[] {
  return data.filter((m): m is CatalogEntry => isObj(m) && typeof m.id === 'string' && typeof m.owned_by === 'string')
}

/**
 * OpenRouter quotes prices as decimal strings. An entry whose two prices are not both numbers >= 0
 * is skipped (its "-1" means variable pricing), so the table keeps the price it had.
 */
function toPrices(data: unknown[]): Map<string, PriceEntry['pricing']> {
  const num = (v: unknown) =>
    (typeof v === 'string' && v.trim() !== '') || typeof v === 'number' ? Number(v) : Number.NaN
  const usable = (n: number) => Number.isFinite(n) && n >= 0
  const out = new Map<string, PriceEntry['pricing']>()
  for (const e of data) {
    if (!isObj(e) || typeof e.id !== 'string' || !isObj(e.pricing)) continue
    const prompt = num(e.pricing.prompt)
    const completion = num(e.pricing.completion)
    if (usable(prompt) && usable(completion)) out.set(e.id, { prompt, completion })
  }
  return out
}

function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Re-derive every candidate's `available` (except gemini-batch, which the proxy does not serve) and,
 * when `prices` is known, its `price`. Mutates only candidates and asOf. Returns the kinds whose
 * pick is now unavailable.
 */
function applyRefresh(
  table: Table,
  catalog: CatalogEntry[],
  prices: Map<string, PriceEntry['pricing']> | null,
  asOf: string,
): string[] {
  for (const c of Object.values(table.candidates)) {
    if (c.provider !== 'gemini-batch') c.available = catalog.some(m => m.id === c.model && m.owned_by === c.owner)
    const p = prices && c.openrouter ? prices.get(c.openrouter) : undefined
    if (p) c.price = { prompt: p.prompt, completion: p.completion }
  }
  table.asOf = asOf
  return Object.keys(table.kinds).filter(k => !table.candidates[table.kinds[k as Kind].pick].available)
}

// --------------------------------------------------------------------------------- signals

// Docs, verified 2026-10-02:
//   https://openrouter.ai/docs/api/api-reference/datasets/get-rankings-daily.md (30 req/min, 500/day)
//   https://artificialanalysis.ai/documentation (1000 req/day)
const DEFAULT_RANKINGS_URL = 'https://openrouter.ai/api/v1/datasets/rankings-daily'
const DEFAULT_AA_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models'
const DEFAULT_OPENROUTER_KEY_REF = 'op://Shared with Agents/OpenRouter/credential'
const DEFAULT_AA_KEY_REF = 'op://Shared with Agents/Artificial Analysis/credential'

/**
 * An API key, read at runtime and never stored: the env var, else the secret file when one is
 * given and readable, else `op read <ref>`. Returns the reason on failure; the reason never carries
 * the key.
 */
function readKey(envVar: string, refVar: string, defaultRef: string, file?: string): { key: string } | { missing: string } {
  const direct = process.env[envVar]?.trim()
  if (direct) return { key: direct }
  if (file) {
    try {
      const key = readFileSync(file, 'utf8').trim()
      if (key) return { key }
    } catch {}
  }
  const ref = process.env[refVar] || defaultRef
  const env = { ...process.env }
  if (!env.OP_SERVICE_ACCOUNT_TOKEN && env.XDG_RUNTIME_DIR) {
    try {
      env.OP_SERVICE_ACCOUNT_TOKEN = readFileSync(join(env.XDG_RUNTIME_DIR, 'agenix/op-service-account-token'), 'utf8').replace(/\n/g, '')
    } catch {}
  }
  try {
    const r = Bun.spawnSync(['op', 'read', '--no-newline', ref], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 20_000 })
    const key = r.stdout.toString().trim()
    if (r.exitCode === 0 && key) return { key }
    const why = r.stderr.toString().trim().split('\n')[0]?.slice(0, 300) || `exit ${r.exitCode}`
    return { missing: `no $${envVar}, and op read ${ref} failed (${why})` }
  } catch (e) {
    return { missing: `no $${envVar}, and op could not run (${(e as Error).message})` }
  }
}

/**
 * The matching key of an OpenRouter slug, a rankings permaslug, or an AA creator/model pair: the
 * creator, then the model part's tokens sorted. `:variant` and a trailing date suffix are dropped,
 * so `anthropic/claude-4.5-sonnet-20250929` and `anthropic/claude-sonnet-4.5` share a key.
 */
export function slugKey(slug: string): string {
  const s = slug.toLowerCase().replace(/:.*$/, '').replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '')
  const cut = s.indexOf('/')
  const creator = cut < 0 ? '' : s.slice(0, cut)
  const tokens = s.slice(cut + 1).split(/[-._/]+/).filter(Boolean).sort()
  return `${creator}/${tokens.join(' ')}`
}

/** Rank 1 = most tokens over the window. The `other` row is not a model and is never ranked. */
function toUsageRanks(data: unknown[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of data) {
    if (!isObj(e) || typeof e.model_permaslug !== 'string' || e.model_permaslug === 'other') continue
    const n = Number(e.total_tokens)
    if (!Number.isFinite(n)) continue
    const k = slugKey(e.model_permaslug)
    totals.set(k, (totals.get(k) ?? 0) + n)
  }
  const ranks = new Map<string, number>()
  ;[...totals.entries()].sort((a, b) => b[1] - a[1]).forEach(([k], i) => ranks.set(k, i + 1))
  return ranks
}

function toIntelligence(data: unknown[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of data) {
    if (!isObj(e) || typeof e.slug !== 'string' || !isObj(e.model_creator) || typeof e.model_creator.slug !== 'string')
      continue
    const v = isObj(e.evaluations) ? e.evaluations.artificial_analysis_intelligence_index : undefined
    if (typeof v !== 'number') continue
    const k = slugKey(`${e.model_creator.slug}/${e.slug}`)
    if (!out.has(k) || v > out.get(k)!) out.set(k, v)
  }
  return out
}

/** A null source leaves that field as it was; asOf moves only when some source answered. */
function applySignals(
  table: Table,
  ranks: Map<string, number> | null,
  intelligence: Map<string, number> | null,
  asOf: string,
): void {
  if (!ranks && !intelligence) return
  for (const c of Object.values(table.candidates)) {
    if (!c.openrouter) continue
    const k = slugKey(c.openrouter)
    const prev = c.signals ?? { usageRank: null, intelligenceIndex: null, asOf }
    c.signals = {
      usageRank: ranks ? (ranks.get(k) ?? null) : prev.usageRank,
      intelligenceIndex: intelligence ? (intelligence.get(k) ?? null) : prev.intelligenceIndex,
      asOf,
    }
  }
}

/** One request per source. Never throws: a source that cannot answer is null, with the reason on stderr. */
async function fetchSignals(): Promise<{ ranks: Map<string, number> | null; intelligence: Map<string, number> | null }> {
  const warn = (msg: string) => process.stderr.write(`route --refresh: ${msg}\n`)
  let ranks: Map<string, number> | null = null
  const orFile = process.env.ROUTE_OPENROUTER_KEY_FILE ||
    (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, 'agenix/openrouter-api-key') : undefined)
  const orKey = readKey('OPENROUTER_API_KEY', 'ROUTE_OPENROUTER_KEY_REF', DEFAULT_OPENROUTER_KEY_REF, orFile)
  const rankingsUrl = process.env.ROUTE_RANKINGS_URL || DEFAULT_RANKINGS_URL
  if ('missing' in orKey) warn(`usageRank left unchanged: ${orKey.missing}`)
  else {
    try {
      const body = await fetchBody(rankingsUrl, 30_000, { Authorization: `Bearer ${orKey.key}` })
      ranks = toUsageRanks(body.data)
      process.stdout.write(`Source: OpenRouter (openrouter.ai/rankings), as of ${body.meta?.as_of ?? 'unknown'}.\n`)
    } catch (e) {
      warn(`usageRank left unchanged: rankings ${rankingsUrl} failed (${(e as Error).message})`)
    }
  }
  let intelligence: Map<string, number> | null = null
  const aaKey = readKey('ARTIFICIAL_ANALYSIS_API_KEY', 'ROUTE_AA_KEY_REF', DEFAULT_AA_KEY_REF)
  const aaUrl = process.env.ROUTE_AA_URL || DEFAULT_AA_URL
  if ('missing' in aaKey) warn(`intelligenceIndex left unchanged: ${aaKey.missing}`)
  else {
    try {
      intelligence = toIntelligence(await fetchListing(aaUrl, 30_000, { 'x-api-key': aaKey.key }))
      process.stdout.write('Source: Artificial Analysis (https://artificialanalysis.ai/).\n')
    } catch (e) {
      warn(`intelligenceIndex left unchanged: ${aaUrl} failed (${(e as Error).message})`)
    }
  }
  return { ranks, intelligence }
}

/** Replace the file in one rename, so a reader never sees half a table. A symlinked path keeps its link. */
function writeTable(path: string, table: Table): void {
  const real = realpathSync(path)
  const tmp = join(dirname(real), `.${process.pid}.routing.tmp`)
  try {
    writeFileSync(tmp, `${JSON.stringify(table, null, 2)}\n`)
    renameSync(tmp, real)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

async function refreshCli(tableArg?: string): Promise<number> {
  const path = tablePath(tableArg)
  let table: Table
  try {
    table = loadTable(path)
  } catch (e) {
    return refuse(`route --refresh: ${(e as Error).message}; nothing written`)
  }

  const proxyUrl = process.env.ROUTE_PROXY_URL || DEFAULT_PROXY_URL
  let catalog: CatalogEntry[]
  try {
    catalog = toCatalog(await fetchListing(proxyUrl, 10_000, { Authorization: `Bearer ${PROXY_TOKEN}` }))
  } catch (e) {
    return refuse(`route --refresh: proxy catalog ${proxyUrl} unreachable (${(e as Error).message}); ${path} left unchanged`)
  }

  const pricesUrl = process.env.ROUTE_PRICES_URL || DEFAULT_PRICES_URL
  let prices: Map<string, PriceEntry['pricing']> | null
  try {
    prices = toPrices(await fetchListing(pricesUrl, 30_000))
  } catch (e) {
    prices = null
    process.stderr.write(`route --refresh: price list ${pricesUrl} unreachable (${(e as Error).message}); prices left unchanged\n`)
  }

  const { ranks, intelligence } = await fetchSignals()

  const before = JSON.parse(JSON.stringify(table.candidates)) as Table['candidates']
  const lost = applyRefresh(table, catalog, prices, localDate())
  applySignals(table, ranks, intelligence, localDate())
  try {
    writeTable(path, table)
  } catch (e) {
    return refuse(`route --refresh: could not write ${path} (${(e as Error).message}); left unchanged`)
  }

  for (const [id, c] of Object.entries(table.candidates)) {
    const b = before[id]
    if (b.available !== c.available) process.stdout.write(`${id}: available ${b.available} -> ${c.available}\n`)
    if (JSON.stringify(b.price) !== JSON.stringify(c.price))
      process.stdout.write(`${id}: price ${JSON.stringify(b.price)} -> ${JSON.stringify(c.price)}\n`)
    for (const f of ['usageRank', 'intelligenceIndex'] as const)
      if (c.signals && (b.signals?.[f] ?? null) !== c.signals[f])
        process.stdout.write(`${id}: ${f} ${JSON.stringify(b.signals?.[f] ?? null)} -> ${JSON.stringify(c.signals[f])}\n`)
  }
  process.stdout.write(`route --refresh: wrote ${path} (asOf ${table.asOf})\n`)

  for (const kind of lost) {
    const { pick, fallbacks } = table.kinds[kind as Kind]
    const c = table.candidates[pick]
    const next = fallbacks.find(id => table.candidates[id].available)
    process.stderr.write(
      `route --refresh: kind ${kind}: pick ${pick} (${c.model}, owner ${c.owner}) is not in the proxy catalog; ` +
        (next ? `rows of this kind fall back to ${next}\n` : 'no candidate is available, so rows of this kind are refused\n'),
    )
  }
  return lost.length ? 1 : 0
}

// --------------------------------------------------------------------------------- propose

/** The user's Claude defaults (decided 2026-10-02): --propose never moves these picks. */
const PROTECTED_PICKS: Partial<Record<Kind, string>> = {
  judgement: 'claude-opus-5-5',
  script: 'claude-sonnet-5-5',
  review: 'claude-sonnet-5-5',
}

export interface Proposal {
  kind: string
  from: { pick: string; fallbacks: string[] }
  to: { pick: string; fallbacks: string[] }
  reason: string
}

/** The rule in the header, applied to every kind. Pure: never writes the table. */
export function propose(table: Table): Proposal[] {
  const cand = (id: string) => table.candidates[id]
  const idx = (id: string) => cand(id).signals?.intelligenceIndex ?? null
  const fmt = (v: number | null) => (v === null ? 'null' : String(v))
  const out: Proposal[] = []
  for (const [kind, entry] of Object.entries(table.kinds)) {
    const { pick, fallbacks } = entry
    const pc = cand(pick)
    const reasons: string[] = []
    let newPick = pick
    const pi = idx(pick)
    const pp = pc.price?.prompt
    if (PROTECTED_PICKS[kind as Kind] !== pc.model && pi !== null && pp !== undefined) {
      const better = Object.keys(table.candidates)
        .filter(id => {
          const c = cand(id)
          const ci = idx(id)
          return id !== pick && c.available && c.provider === pc.provider && ci !== null && ci > pi && !!c.price && c.price.prompt <= pp
        })
        .sort((a, b) => idx(b)! - idx(a)! || cand(a).price!.prompt - cand(b).price!.prompt)
      if (better.length) {
        newPick = better[0]
        reasons.push(
          `${newPick} is ${pc.provider} like ${pick}, intelligenceIndex ${fmt(idx(newPick))} > ${fmt(pi)}, ` +
            `price.prompt ${cand(newPick).price!.prompt} <= ${pp}`,
        )
      }
    }
    const members = [...fallbacks.filter(id => id !== newPick), ...(newPick !== pick ? [pick] : [])]
    const avail = members
      .filter(id => cand(id).available)
      .sort((a, b) => (idx(b) ?? Number.NEGATIVE_INFINITY) - (idx(a) ?? Number.NEGATIVE_INFINITY))
    const newFallbacks = [...avail, ...members.filter(id => !cand(id).available)]
    if (newPick === pick && JSON.stringify(newFallbacks) === JSON.stringify(fallbacks)) continue
    if (JSON.stringify(newFallbacks) !== JSON.stringify(fallbacks))
      reasons.push(`fallbacks by intelligenceIndex among available: ${avail.map(id => `${id} ${fmt(idx(id))}`).join(', ')}`)
    out.push({ kind, from: { pick, fallbacks }, to: { pick: newPick, fallbacks: newFallbacks }, reason: reasons.join('; ') })
  }
  return out
}

function proposeCli(tableArg: string | undefined, json: boolean): number {
  const path = tablePath(tableArg)
  let table: Table
  try {
    table = loadTable(path)
  } catch (e) {
    return refuse(`route --propose: ${(e as Error).message}`)
  }
  const proposals = propose(table)
  if (json) {
    process.stdout.write(`${JSON.stringify({ proposals })}\n`)
    return 0
  }
  if (!proposals.length) {
    process.stdout.write('route --propose: no change proposed\n')
    return 0
  }
  const chain = (e: { pick: string; fallbacks: string[] }) => `${e.pick} [${e.fallbacks.join(', ')}]`
  for (const p of proposals) process.stdout.write(`kind ${p.kind}: ${chain(p.from)} -> ${chain(p.to)} — ${p.reason}\n`)
  process.stdout.write(`route --propose: advisory only; ${path} not written. Accept by editing its kinds by hand.\n`)
  return 0
}

if (import.meta.main)
  cli(process.argv.slice(2)).then(code => {
    process.exitCode = code
  })
