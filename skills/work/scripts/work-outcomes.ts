#!/usr/bin/env bun
/**
 * work-outcomes — appends one farm-outcomes row line per task of a finished work round, plus an
 * automatic verdict line where the round's verifier reached the task.
 *
 *   bun work-outcomes.ts <run-dir>
 *
 * Reads <run-dir>/args.json and <run-dir>/result.json; appends to $FARM_OUTCOMES, default
 * ~/.local/state/workflows/farm-outcomes.jsonl (the file farm.sh writes; docs/DESIGN-routing.md).
 *
 *   row     {type, rowId:"work:<runId>:r<round>:<taskId>", ts, cwd, label:"<runId>/<taskId>", kind,
 *            route:{source,provider,model,candidate}, shadow, source:"work", red, verified}
 *   verdict {type, rowId, verdict:"correct"|"wrong", why, ts, auto:true}
 *
 * The label comes only from exit-code gates: correct iff the verifier passed AND (the task is not
 * red-gated OR its red probe pair was red-green). runId is the run directory's basename; round is
 * the result-round*.json count plus one, because work-loop.sh calls this before work-redispatch.sh
 * rotates result.json. Idempotent per (type, rowId): a row and its verdict share a rowId by design.
 * When args.onlyTasks is an array, a task outside it was carried and gets no lines this round.
 * No task `work` text, goal or prompt is ever written.
 *
 * exit 0  appended (or nothing was due)
 * exit 1  args.json/result.json unreadable, or a line could not be written in full
 * exit 2  bad arguments
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const FLAG_SHADOW = { unavailable: '--provider flag: route.ts was not consulted' }

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
if (!Array.isArray(args?.tasks)) die(`${join(runDir, 'args.json')} has no tasks[]`)

const runId = basename(runDir)
const round = readdirSync(runDir).filter(f => f.startsWith('result-round') && f.endsWith('.json')).length + 1
const prefix = `work:${runId}:r${round}:`

/** id -> entry; a later entry wins, because workflow.js appends the live record after carried ones. */
const byId = (list: unknown): Map<string, any> =>
  new Map((Array.isArray(list) ? list : []).filter(x => x && typeof x.id === 'string').map(x => [x.id, x]))
const verifiedById = byId(result.verified)
const redById = byId(result.red)
// A carried task is one outside args.onlyTasks, exactly as workflow.js defines it: its records ride
// into result.verified/red via carryForward, and its lines were written in the round that judged it.
// args.json still holds the judged round's onlyTasks here, since redispatch rewrites it only later.
// result.json `carried` is carried review FINDINGS, never task ids, so it is not read.
const onlyTasks: Set<string> | null = Array.isArray(args.onlyTasks)
  ? new Set(args.onlyTasks.filter((id: unknown): id is string => typeof id === 'string'))
  : null

const routing = args.routing && typeof args.routing === 'object' ? args.routing : null
const decisions = routing?.decisions && typeof routing.decisions === 'object' ? routing.decisions : null

function routeFor(kind: string): { route: object; shadow: unknown } {
  if (decisions) {
    const d = decisions[kind] ?? {}
    return {
      route: { source: d.source ?? null, provider: d.provider ?? null, model: d.model ?? null, candidate: d.candidate ?? null },
      shadow: d.shadow ?? null,
    }
  }
  const model = typeof args.implementerModel === 'string' && args.implementerModel ? args.implementerModel : null
  return {
    route: { source: 'flag', provider: routing?.provider ?? null, model, candidate: null },
    shadow: FLAG_SHADOW,
  }
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
  const v = verifiedById.get(t.id)
  const r = redById.get(t.id)
  const red = typeof r?.verdict === 'string' ? r.verdict : null
  const { route, shadow } = routeFor(kind)

  if (present.has(`row\t${rowId}`)) skippedPresent++
  else pending.push({
    type: 'row', rowId, ts, cwd: args.projectDir ?? null, label: `${runId}/${t.id}`, kind, route, shadow,
    source: 'work', red, verified: v ? v.pass === true : null,
  })

  if (!v) continue
  if (present.has(`verdict\t${rowId}`)) { skippedPresent++; continue }
  const redGreen = red === 'red-green'
  const correct = v.pass === true && (typeof t.redCommand !== 'string' || redGreen)
  pending.push({
    type: 'verdict', rowId, verdict: correct ? 'correct' : 'wrong',
    why: redGreen ? 'work verifier + red-green' : 'work verifier', ts, auto: true,
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
