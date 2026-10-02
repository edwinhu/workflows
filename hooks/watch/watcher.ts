// The watcher mod, registered from hooks/watch/watcher.ts: the farm-out runs and work rounds THIS session launched, read from files only.
//
//   status line   one compact line while anything runs; cleared when nothing does
//   wake          $.prompt.submit ONCE per run that reaches DONE or GONE, remembered in $.store
//   /farm         a table of this session's runs, printed at once, no turn
//
// It replaces the `farm-runs` plugin monitor, which never re-armed once it stopped. A timer started
// in session.start comes back with every reload. A headless session (`claude -p`, the SDK, a farm
// child with FARM_OUT_CHILD=1) registers nothing: it has nobody to draw for, and a farm child
// waking itself about its own runs would loop.
import type { EngineInterface, On } from 'claude-code'
import {
  classify, parseEvents, statusLine, table, wakeable, wakeText, workPhase, workRound, WAKE_HORIZON_MS,
  type Facts, type Run, type View,
} from './runs.ts'

const TICK_MS = 15_000
// Notified keys older than this are pruned from the shared store.
const KEEP_NOTIFIED_MS = 7 * 24 * 3600_000

// Module state: lost on reload by design. The store holds what must survive one.
const sessions = new Set<string>()
const firstSeen = new Map<string, number>()
const cache = new Map<string, { mtimeMs: number; size: number; runs: Run[] }>()
const woke = new Set<string>()
let lastStatus: string | undefined
let ticking = false

async function eventDirs($: EngineInterface): Promise<string[]> {
  const sid = await $.session.id()
  if (sid) sessions.add(sid)
  const roots = [...new Set([(await $.env.get('TMPDIR')) || '/tmp', '/tmp'])]
  const dirs: string[] = []
  for (const root of roots) for (const s of sessions) dirs.push(`${root.replace(/\/+$/, '')}/farm-events/${s}`)
  return dirs
}

async function readRuns($: EngineInterface, nowMs: number): Promise<Run[]> {
  const runs: Run[] = []
  for (const dir of await eventDirs($)) {
    let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>
    try { entries = await $.fs.list(dir) } catch { continue }
    const sid = dir.split('/').pop() ?? ''
    for (const ent of entries) {
      const m = /^(\d+)\.ndjson$/.exec(ent.name)
      if (!m || ent.kind !== 'file') continue
      const file = `${dir}/${ent.name}`
      if (!firstSeen.has(file)) firstSeen.set(file, Math.min(nowMs, ent.mtimeMs || nowMs))
      const hit = cache.get(file)
      if (hit && hit.mtimeMs === ent.mtimeMs && hit.size === ent.size) { runs.push(...hit.runs); continue }
      let text = ''
      try { text = await $.fs.read(file) } catch { continue }
      const parsed = parseEvents(text, file, Number(m[1]), sid)
      cache.set(file, { mtimeMs: ent.mtimeMs, size: ent.size, runs: parsed })
      runs.push(...parsed)
    }
  }
  return runs
}

async function nonEmpty($: EngineInterface, p: string): Promise<boolean> {
  try { return (await $.fs.stat(p)).size > 0 } catch { return false }
}

async function readText($: EngineInterface, p: string): Promise<string | undefined> {
  try { return await $.fs.read(p) } catch { return undefined }
}

/** Everything classify() needs, gathered with one ps call and a stat per artifact. */
async function gather($: EngineInterface, runs: Run[]): Promise<Facts> {
  const facts: Facts = {
    alive: new Set(), present: new Set(), firstSeen, loopExit: new Map(), round: new Map(), phase: new Map(),
  }
  const open = [...new Set(runs.filter(r => !r.done).map(r => r.pid))]
  if (open.length) {
    try {
      const ps = await $.process.run(['ps', '-o', 'pid=', '-p', open.join(',')], { timeoutMs: 5000 })
      for (const tok of ps.stdout.split(/\s+/)) if (/^\d+$/.test(tok)) facts.alive.add(Number(tok))
    } catch {
      // ps unavailable: claim every open run alive rather than wake the session with false GONEs.
      for (const p of open) facts.alive.add(p)
    }
  }
  const paths = new Set<string>()
  const workDirs = new Set<string>()
  for (const r of runs) {
    for (const p of [r.out, ...r.claims]) if (p && p.startsWith('/')) paths.add(p)
    if ((r.label === 'work-round' || r.label === 'work-loop') && r.out) workDirs.add(r.out.replace(/\/[^/]*$/, ''))
  }
  for (const p of paths) if (await nonEmpty($, p)) facts.present.add(p)
  for (const d of workDirs) {
    const exit = await readText($, `${d}/loop.exit`)
    if (exit !== undefined && exit.trim() !== '') facts.loopExit.set(`${d}/loop.exit`, exit.trim())
    const loopLog = await readText($, `${d}/loop.log`)
    const round = loopLog && workRound(loopLog)
    if (round) facts.round.set(d, round)
    // Round N>1 logs to run-<HHMMSS>.log; the newest run*.log is the live round's.
    let log = `${d}/run.log`
    try {
      const logs = (await $.fs.list(d)).filter((e) => /^run.*\.log$/.test(e.name))
      logs.sort((a, b) => b.mtimeMs - a.mtimeMs)
      if (logs[0]) log = `${d}/${logs[0].name}`
    } catch {}
    const runLog = await readText($, log)
    const phase = runLog && workPhase(runLog)
    if (phase) facts.phase.set(d, phase)
  }
  return facts
}

async function snapshot($: EngineInterface): Promise<{ views: View[]; nowMs: number }> {
  const nowMs = await $.clock.now()
  const runs = await readRuns($, nowMs)
  return { views: classify(runs, await gather($, runs)), nowMs }
}

async function wake($: EngineInterface, views: View[], nowMs: number) {
  for (const v of wakeable(views)) {
    if (v.state === 'running' || woke.has(v.id)) continue
    woke.add(v.id)
    const key = `notified:${v.id}`
    if (await $.store.get(key)) continue
    if (v.startedMs && nowMs - v.startedMs > WAKE_HORIZON_MS) continue
    // Recorded BEFORE the submit: a reload between the two must not wake twice.
    await $.store.set(key, nowMs)
    // Never awaited: submit resolves when the turn starts, and this tick may run mid-turn.
    void $.prompt.submit({ text: wakeText(v, nowMs) })
  }
}

async function prune($: EngineInterface, nowMs: number) {
  for (const k of await $.store.keys()) {
    if (!k.startsWith('notified:')) continue
    const at = Number(await $.store.get(k))
    if (!(nowMs - at < KEEP_NOTIFIED_MS)) await $.store.delete(k)
  }
}

async function tick($: EngineInterface) {
  if (ticking) return
  ticking = true
  try {
    const { views, nowMs } = await snapshot($)
    const line = statusLine(views, nowMs)
    if (line !== lastStatus) {
      lastStatus = line
      $.ui.status(line)
    }
    await wake($, views, nowMs)
  } finally {
    ticking = false
  }
}

export function registerWatcher(on: On) {
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive || (await $.env.get('FARM_OUT_CHILD')) === '1') return next(e)
    // The promise is returned so a test clock can settle on it; the engine does not wait on it.
    $.clock.every(TICK_MS, () => tick($))
    void tick($)
    void prune($, await $.clock.now())
    await $.command.register({
      name: 'farm',
      description: "This session's farm-out runs and work rounds: state, elapsed, artifact, report",
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'farm' }, async ($) => {
    const { views, nowMs } = await snapshot($)
    return { text: table(views, nowMs) }
  })
}
