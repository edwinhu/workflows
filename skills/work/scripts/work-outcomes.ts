#!/usr/bin/env bun
/**
 * work-outcomes — appends one farm-outcomes row line AND one automatic verdict line per task of a
 * finished work round, every round, pass or fail.
 *
 *   bun work-outcomes.ts <run-dir>
 *
 * Reads <run-dir>/args.json, <run-dir>/result.json and, when present, <run-dir>/digest.json (the
 * round's check failures with the owner work-stage.mjs attributed). Appends to $FARM_OUTCOMES,
 * default ~/.local/state/workflows/farm-outcomes.jsonl (the file farm.sh writes; docs/DESIGN-routing.md).
 *
 *   row     {type, rowId:"work:<runId>:r<round>:<taskId>", ts, cwd, label:"<runId>/<taskId>", kind,
 *            route:{source,provider,model,candidate}, source:"work", red, verified}
 *   verdict {type, rowId, verdict:"correct"|"wrong", why, checks:[...], findings:[...], kind, model, ts, auto:true}
 *
 * wrong iff THIS round's checks failed for the task OR a critical/major finding owned by the task
 * stands; correct otherwise. A task's failing checks: a verified record with pass false (verify, or
 * acceptance when by command), no verified record outside readOnly (verify-missing), a red gate not
 * red-green, an implementer not done, and every digest failure or lens route owned by the task.
 * Findings are named by id, or <lens>#<index in result.findings> when the lens gave none.
 *
 * runId is the run directory's basename; round is the result-round*.json count plus one, because
 * work-loop.sh calls this before work-redispatch.sh rotates result.json. Idempotent per (type, rowId).
 * When args.onlyTasks is an array, a task outside it was carried, ran no model this round, and gets
 * no lines. No task `work` text, goal, prompt or finding prose is ever written.
 *
 * exit 0  appended (or nothing was due)
 * exit 1  args.json/result.json unreadable, or a line could not be written in full
 * exit 2  bad arguments
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

function die(msg: string, code = 1): never {
  process.stderr.write(`work-outcomes: ${msg}\n`)
  process.exit(code)
}

if (process.argv.length !== 3 || !process.argv[2]) die('usage: bun work-outcomes.ts <run-dir>', 2)
const runDir = resolve(process.argv[2])

function readJson(name: string): any {
  const p = join(runDir, name)
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    die(`cannot read ${p}: ${(e as Error).message}`)
  }
}

const args = readJson('args.json')
const result = readJson('result.json')
// Optional: a run from before work-round.sh wrote one has no digest, and routes still attribute.
const digest = (() => {
  try {
    return JSON.parse(readFileSync(join(runDir, 'digest.json'), 'utf8'))
  } catch {
    return null
  }
})()
if (!Array.isArray(args?.tasks)) die(`${join(runDir, 'args.json')} has no tasks[]`)

const runId = basename(runDir)
const round = readdirSync(runDir).filter(f => f.startsWith('result-round') && f.endsWith('.json')).length + 1
const prefix = `work:${runId}:r${round}:`

/** id -> entry; a later entry wins, because workflow.js appends the live record after carried ones. */
const byId = (list: unknown): Map<string, any> =>
  new Map((Array.isArray(list) ? list : []).filter(x => x && typeof x.id === 'string').map(x => [x.id, x]))
/** id -> every entry: an agent verifier and an acceptanceCmd can both judge one task. */
const allById = (list: unknown): Map<string, any[]> => {
  const m = new Map<string, any[]>()
  for (const x of Array.isArray(list) ? list : []) if (x && typeof x.id === 'string') m.set(x.id, [...(m.get(x.id) ?? []), x])
  return m
}
const verifiedById = allById(result.verified)
const redById = byId(result.red)
const implementedById = byId(result.implemented)
const owner = (x: any): string => (x && typeof x.ownerTask === 'string' ? x.ownerTask.trim() : '')
const routes: any[] = Array.isArray(result.routes) ? result.routes : []
const findings: any[] = Array.isArray(result.findings) ? result.findings : []
const digestFailures: any[] = Array.isArray(digest?.failures) ? digest.failures : []
/** A check name without the task id it is about: `verify:T3` -> `verify`, `mechanical:ds` stays. */
const checkName = (c: string) => c.replace(/^(red|acceptance|verify|implement):.*$/, '$1')
// A carried task is one outside args.onlyTasks, exactly as workflow.js defines it: its records ride
// into result.verified/red via carryForward, and its lines were written in the round that judged it.
// args.json still holds the judged round's onlyTasks here, since redispatch rewrites it only later.
// result.json `carried` is carried review FINDINGS, never task ids, so it is not read.
const onlyTasks: Set<string> | null = Array.isArray(args.onlyTasks)
  ? new Set(args.onlyTasks.filter((id: unknown): id is string => typeof id === 'string'))
  : null

const routing = args.routing && typeof args.routing === 'object' ? args.routing : null
const decisions = routing?.decisions && typeof routing.decisions === 'object' ? routing.decisions : null

function routeFor(kind: string): { source: unknown; provider: unknown; model: string | null; candidate: unknown } {
  if (decisions) {
    const d = decisions[kind] ?? {}
    return { source: d.source ?? null, provider: d.provider ?? null, model: d.model ?? null, candidate: d.candidate ?? null }
  }
  const model = typeof args.implementerModel === 'string' && args.implementerModel ? args.implementerModel : null
  return { source: 'flag', provider: routing?.provider ?? null, model, candidate: null }
}

/** This round's failing checks and standing blocking findings for one task. */
function judge(t: any): { checks: string[]; findingIds: string[] } {
  const checks = new Set<string>()
  const vs = verifiedById.get(t.id) ?? []
  for (const v of vs) if (v.pass !== true) checks.add(v.byCommand ? 'acceptance' : 'verify')
  if (!vs.length && args.readOnly !== true) checks.add('verify-missing')
  if (typeof t.redCommand === 'string' && redById.get(t.id)?.verdict !== 'red-green') checks.add('red')
  if (implementedById.get(t.id)?.done === false) checks.add('implement')
  for (const f of digestFailures) if (f && f.owner === t.id && typeof f.check === 'string') checks.add(checkName(f.check))
  for (const r of routes) if (owner(r) === t.id && typeof r.failure === 'string') checks.add(checkName(r.failure.trim()))
  const findingIds: string[] = []
  findings.forEach((f, i) => {
    if (!f || owner(f) !== t.id || f.defect === false) return
    if (f.severity !== 'critical' && f.severity !== 'major') return
    findingIds.push(`${typeof f.id === 'string' && f.id ? f.id : `${f.lens || 'lens'}#${i}`} (${f.severity})`)
    checks.add(`lens:${f.severity}`)
  })
  return { checks: [...checks], findingIds }
}

const OUT = process.env.FARM_OUTCOMES || join(process.env.HOME || homedir(), '.local/state/workflows/farm-outcomes.jsonl')

// Keys already present for THIS round. The substring test runs before JSON.parse so a large shared
// file costs one read and a scan, not a parse per line.
const present = new Set<string>()
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, 'utf8').split('\n')) {
    if (!l.includes(prefix)) continue
    try {
      const o = JSON.parse(l)
      if (o && typeof o.rowId === 'string') present.add(`${o.type}\t${o.rowId}`)
    } catch { /* a torn or foreign line is not ours to judge */ }
  }
}

const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const pending: object[] = []
let skippedCarried = 0
let skippedPresent = 0

for (const t of args.tasks) {
  if (!t || typeof t.id !== 'string') die(`a task in ${join(runDir, 'args.json')} has no string id`)
  if (onlyTasks && !onlyTasks.has(t.id)) { skippedCarried++; continue }
  const rowId = `${prefix}${t.id}`
  const kind = t.kind ?? 'judgement'
  const vs = verifiedById.get(t.id) ?? []
  const r = redById.get(t.id)
  const red = typeof r?.verdict === 'string' ? r.verdict : null
  const route = routeFor(kind)

  if (present.has(`row\t${rowId}`)) skippedPresent++
  else pending.push({
    type: 'row', rowId, ts, cwd: args.projectDir ?? null, label: `${runId}/${t.id}`, kind, route,
    source: 'work', red, verified: vs.length ? vs.every(v => v.pass === true) : null,
  })

  if (present.has(`verdict\t${rowId}`)) { skippedPresent++; continue }
  const { checks, findingIds } = judge(t)
  const wrong = checks.length > 0
  const ran = `[${kind}/${route.model ?? 'unpinned'}]`
  const why = wrong
    ? `${ran} failed: ${checks.join(', ')}${findingIds.length ? `; findings ${findingIds.join(', ')}` : ''}`
    : `${ran} checks passed${red === 'red-green' ? ' + red-green' : ''}; no owned critical/major finding`
  pending.push({
    type: 'verdict', rowId, verdict: wrong ? 'wrong' : 'correct', why, checks, findings: findingIds,
    kind, model: route.model, ts, auto: true,
  })
}

// One write(2) per line on an O_APPEND descriptor, as farm.sh's append_outcome does: concurrent
// writers share this file, and a buffered stream can split a long line into interleavable writes.
if (pending.length) {
  try {
    mkdirSync(dirname(OUT), { recursive: true })
  } catch (e) {
    die(`cannot create ${dirname(OUT)}: ${(e as Error).message}`)
  }
  const fd = openSync(OUT, 'a', 0o600)
  try {
    for (const line of pending) {
      const buf = Buffer.from(JSON.stringify(line) + '\n')
      if (writeSync(fd, buf) !== buf.length) die(`short write to ${OUT}`)
    }
  } finally {
    closeSync(fd)
  }
}

console.log(
  `work-outcomes: ${runId} round ${round}: appended ${pending.length} line(s) to ${OUT}` +
    (skippedPresent ? `; ${skippedPresent} already present` : '') +
    (skippedCarried ? `; ${skippedCarried} carried task(s) skipped` : ''),
)
