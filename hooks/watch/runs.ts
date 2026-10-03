// Pure state for the watcher mod (hooks/watch/watcher.ts): parse the farm-events stream, classify each
// run, and render the status line, the /farm table and the wake text. No `$`, no I/O, so plain
// `bun test` covers it (tests/farm-watch-runs.test.ts) as well as the mod kit.
//
// THE STREAM is $TMPDIR/farm-events/<session id>/<pid>.ndjson, written by farm.sh, work-round.sh,
// work-loop.sh and grind.sh: `<prefix>: START <label> k=v ...`, `CLAIM <label> path=<p> `,
// `DONE <label> <status> ...`, values percent-encoded by enc(). The directory's session key IS the
// ownership marker; the filename is the pid that lives for the whole run.

/** A run that finishes later than this after its start is history, not news: the watcher does not wake for it. */
export const WAKE_HORIZON_MS = 24 * 3600_000

export type Run = {
  id: string
  file: string
  pid: number
  prefix: string
  label: string
  cwd: string
  out: string
  claims: string[]
  /** Epoch seconds from the START line's t=, absent on lines written before it existed. */
  t?: number
  done?: { status: string; detail: string }
}

export type Kind = 'farm' | 'work-round' | 'work-loop' | 'grind'

export type View = Run & {
  kind: Kind
  /** The work run directory for work-round / work-loop, and for a farm row nested inside one. */
  runDir?: string
  nested: boolean
  alive: boolean
  artifactsPresent: boolean
  state: 'running' | 'done' | 'gone'
  startedMs: number
  /** For a work-loop: loop.exit's content when present. */
  loopExit?: string
  /** For work: round number and phase, read from loop.log / run*.log. */
  round?: string
  phase?: string
}

export function dec(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

const LINE = /^(\w[\w-]*): (START|CLAIM|DONE) (\S+)(?: (.*))?$/

function fields(rest: string): Record<string, string> {
  const f: Record<string, string> = {}
  for (const tok of rest.split(' ')) {
    const i = tok.indexOf('=')
    if (i > 0) f[tok.slice(0, i)] = dec(tok.slice(i + 1))
  }
  return f
}

/** One event file's runs, in START order. `sid` and `pid` make the id; `fallbackStartMs` stands in
 *  for a START with no t=. A DONE pairs with the oldest open START of its label; a DONE whose label
 *  matches none (grind writes its terminal STATE there) closes the file's only open run. */
export function parseEvents(text: string, file: string, pid: number, sid: string): Run[] {
  const runs: Run[] = []
  let n = 0
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw.trimEnd())
    if (!m) continue
    const [, prefix = '', verb, encLabel = '', rest = ''] = m
    const label = dec(encLabel)
    if (verb === 'START') {
      const f = fields(rest)
      const t = f.t !== undefined && /^\d+$/.test(f.t) ? Number(f.t) : undefined
      runs.push({
        id: `${sid}:${pid}:${n++}:${label}${t ? ':' + t : ''}`,
        file, pid, prefix, label, cwd: f.cwd ?? '', out: f.out ?? f.journal ?? '', claims: [], t,
      })
    } else if (verb === 'CLAIM') {
      const r = runs.find(x => x.label === label && !x.done)
      const p = fields(rest).path
      if (r && p && !r.claims.includes(p)) r.claims.push(p)
    } else {
      const open = runs.filter(x => !x.done)
      const byLabel = open.find(x => x.label === label)
      const r = byLabel ?? (open.length === 1 ? open[0] : undefined)
      if (r) {
        // Unpaired by label (grind): the label slot holds the terminal state, so it is the status.
        const words = byLabel ? rest.split(' ') : [label, ...rest.split(' ')]
        r.done = { status: words[0] ?? '', detail: words.join(' ').trim() }
      }
    }
  }
  return runs
}

export function dirname(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

export function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() ?? p
}

export function kindOf(r: Run): Kind {
  if (r.label === 'work-round') return 'work-round'
  if (r.label === 'work-loop') return 'work-loop'
  if (r.prefix === 'grind') return 'grind'
  return 'farm'
}

/** The paths that say a run delivered: its claims, else its out=. A grind's journal is not one. */
export function artifactsOf(r: Run): string[] {
  if (kindOf(r) === 'grind') return []
  if (kindOf(r) === 'work-loop') return r.out ? [r.out] : []
  const c = r.claims.length ? r.claims : r.out ? [r.out] : []
  // farm.sh claims the caller's spelling AND its canonical form; a relative one is relative to the
  // run's cwd=, so resolve it there and let the two spellings collapse into one.
  const abs = c.map(p => (p.startsWith('/') || !r.cwd ? p : `${r.cwd.replace(/\/+$/, '')}/${p.replace(/^\.\//, '')}`))
  return [...new Set(abs)]
}

/** The phase of a work round from its run log: the last `work-round: N/5 <word>` step line. */
export function workPhase(log: string): string | undefined {
  let phase: string | undefined
  for (const m of log.matchAll(/^work-round: (\d)\/5 (\w+)/gm)) phase = `${m[1]}/5 ${m[2]}`
  return phase
}

/** The round of a work loop from loop.log: the last `work-loop: round N of M`. */
export function workRound(log: string): string | undefined {
  let round: string | undefined
  for (const m of log.matchAll(/^work-loop: round (\d+) of (\d+)/gm)) round = `${m[1]}/${m[2]}`
  return round
}

export type Facts = {
  alive: Set<number>
  /** Paths that exist non-empty. */
  present: Set<string>
  /** file -> fallback start time (ms), the first time the watcher saw the file. */
  firstSeen: Map<string, number>
  loopExit: Map<string, string>
  round: Map<string, string>
  phase: Map<string, string>
}

export function classify(runs: Run[], facts: Facts): View[] {
  const workDirs = new Set<string>()
  for (const r of runs) {
    const k = kindOf(r)
    if ((k === 'work-round' || k === 'work-loop') && r.out) workDirs.add(dirname(r.out))
  }
  return runs.map(r => {
    const kind = kindOf(r)
    const arts = artifactsOf(r)
    const artifactsPresent = arts.length > 0 && arts.every(p => facts.present.has(p))
    let runDir: string | undefined
    if (kind === 'work-round' || kind === 'work-loop') runDir = r.out ? dirname(r.out) : undefined
    else if (kind === 'farm') runDir = [r.out, ...r.claims].map(p => p && dirname(p)).find(d => d && workDirs.has(d))
    const nested = kind === 'farm' && runDir !== undefined
    const alive = facts.alive.has(r.pid)
    const loopExit = kind === 'work-loop' && r.out ? facts.loopExit.get(r.out) : undefined
    let state: View['state']
    if (r.done || loopExit !== undefined) state = 'done'
    else if (alive) state = 'running'
    // Killed after its artifact landed: the deliverable is there, so it finished rather than died.
    else if (artifactsPresent) state = 'done'
    else state = 'gone'
    const startedMs = r.t ? r.t * 1000 : facts.firstSeen.get(r.file) ?? 0
    return {
      ...r, kind, runDir, nested, alive, artifactsPresent, state, startedMs, loopExit,
      round: runDir ? facts.round.get(runDir) : undefined,
      phase: runDir ? facts.phase.get(runDir) : undefined,
    }
  })
}

/** Which views wake the session. Nested farm rows report through their work run; a work round
 *  whose run has a loop reports through the loop, which outlives every round. */
export function wakeable(views: View[]): View[] {
  const looped = new Set(views.filter(v => v.kind === 'work-loop' && v.runDir).map(v => v.runDir))
  return views.filter(v => !v.nested && !(v.kind === 'work-round' && looped.has(v.runDir)))
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

function name(v: View): string {
  if (v.kind === 'work-round' || v.kind === 'work-loop') return `work ${v.runDir ? basename(v.runDir) : v.label}`
  return v.label
}

/** One line, or undefined when nothing is running. */
export function statusLine(views: View[], nowMs: number): string | undefined {
  const live = wakeable(views).filter(v => v.state === 'running')
  const parts: string[] = []
  const farms = live.filter(v => v.kind === 'farm' || v.kind === 'grind')
  if (farms.length) {
    const each = farms.map(v => `${v.label} ${elapsed(nowMs - v.startedMs)}`).join(', ')
    parts.push(`farm: ${farms.length} running (${each})`)
  }
  for (const v of live.filter(v => v.kind === 'work-round' || v.kind === 'work-loop')) {
    const bits = [name(v)]
    if (v.round) bits.push(`round ${v.round}`)
    if (v.phase) bits.push(v.phase)
    bits.push(elapsed(nowMs - v.startedMs))
    parts.push(bits.join(' '))
  }
  return parts.length ? parts.join(' · ') : undefined
}

function report(v: View): string {
  if (v.kind === 'work-loop' || v.kind === 'work-round') return v.runDir ? `${v.runDir}/result.json` : v.out
  return artifactsOf(v)[0] ?? (v.out || '-')
}

function stateWord(v: View): string {
  if (v.state === 'running') return v.phase ? `running ${v.phase}` : 'running'
  if (v.state === 'gone') return 'GONE'
  if (v.loopExit !== undefined) return `done exit ${v.loopExit}`
  return v.done ? `done ${v.done.status}` : 'done (artifact, no DONE line)'
}

/** The /farm table: every run this session launched, nested rows included and marked. */
export function table(views: View[], nowMs: number): string {
  if (!views.length) return 'No farm or work runs in this session.'
  const rows = views.map(v => [
    (v.nested ? '  ↳ ' : '') + name(v),
    stateWord(v),
    elapsed(nowMs - v.startedMs),
    artifactsOf(v).length ? (v.artifactsPresent ? 'present' : 'missing') : '-',
    report(v),
  ])
  const head = ['run', 'state', 'elapsed', 'artifact', 'report']
  const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const fmt = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i] ?? 0))).join('  ')
  return [fmt(head), ...rows.map(fmt)].join('\n')
}

const LOOP_EXITS: Record<string, string> = {
  '0': 'gate passed', '1': 'dispatch died with no verdict', '2': 'bad arguments or result refused',
  '3': 'redispatch refused at Tier 1', '5': 'NOT CONVERGING', '6': 'loop cap reached, gate failing',
  '7': 'plan defect escalates to a human', '8': 'read-only run reached its verdict',
}

/** The prompt that wakes the session for a finished or dead run. */
export function wakeText(v: View, nowMs: number): string {
  const took = elapsed(nowMs - v.startedMs)
  const ev = `events: ${v.file}`
  if (v.kind === 'work-loop' || v.kind === 'work-round') {
    const dir = v.runDir ?? dirname(v.out)
    if (v.state === 'gone') {
      return `work run ${basename(dir)} is GONE: pid ${v.pid} (${v.kind}) exited with no DONE line after ${took}. ` +
        `No verdict at ${dir}/result.json. Read ${dir}/run.log${v.kind === 'work-loop' ? ` and ${dir}/loop.log` : ''}. ${ev}`
    }
    if (v.kind === 'work-loop') {
      const code = v.loopExit ?? v.done?.detail.match(/rc=(\d+)/)?.[1] ?? '?'
      return `work run ${basename(dir)} loop finished: exit ${code} (${LOOP_EXITS[code] ?? 'see loop.log'}) after ${took}. ` +
        `Result: ${dir}/result.json; loop log: ${dir}/loop.log. ${ev}`
    }
    return `work run ${basename(dir)} round finished: ${v.done?.detail || 'result present'} after ${took}. ` +
      `Result: ${dir}/result.json; run log: ${dir}/run.log. ${ev}`
  }
  const what = v.kind === 'grind' ? 'grind loop' : 'farm run'
  const arts = artifactsOf(v)
  if (v.state === 'gone') {
    return `${what} ${v.label} is GONE: pid ${v.pid} exited with no DONE line after ${took}` +
      (arts.length ? `; expected artifact missing: ${arts.join(', ')}` : '') + `. ${ev}`
  }
  return `${what} ${v.label} finished: ${v.done?.detail || 'artifact present, no DONE line'} after ${took}.` +
    (arts.length ? ` Report: ${arts.join(', ')} (${v.artifactsPresent ? 'present' : 'MISSING'}).` : '') + ` ${ev}`
}
