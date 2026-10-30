// One snapshot of the farm-events stream, shared by the watcher mod (hooks/watch/watcher.ts, over $.fs
// and $.process) and bin/farm-status (scripts/lib/farm-status.ts, over node fs and ps): read every
// <pid>.ndjson under the given event directories, gather the facts classify() needs, classify.
//
// It is loaded inside the hooks module, so it imports nothing but ./runs.ts, and it holds no module
// state: the caches are the caller's, passed in.
import { classify, parseEvents, workPhase, workRound, type Facts, type Run, type View } from './runs.ts'

export type Entry = { name: string; kind: string; size: number; mtimeMs: number }

/** The file and process reads a snapshot makes. Every method may throw; a throw means "unknown". */
export type SnapshotIO = {
  list(dir: string): Promise<Entry[]>
  read(path: string): Promise<string>
  stat(path: string): Promise<{ size: number; mtimeMs: number }>
  /** Which of `pids` are running. Throws when it cannot tell (ps unavailable). */
  alivePids(pids: number[]): Promise<Set<number>>
}

export type Caches = {
  /** event file -> fallback start time (ms), the first time it was seen. */
  firstSeen: Map<string, number>
  /** event file -> its parsed runs, reused while its mtime and size hold. */
  parsed: Map<string, { mtimeMs: number; size: number; runs: Run[] }>
}

/** The ps call both adapters make: one, over every open run's pid. */
export function psArgv(pids: number[]): string[] {
  return ['ps', '-o', 'pid=', '-p', pids.join(',')]
}

/** The pids `ps -o pid=` printed. */
export function psPids(stdout: string): Set<number> {
  const alive = new Set<number>()
  for (const tok of stdout.split(/\s+/)) if (/^\d+$/.test(tok)) alive.add(Number(tok))
  return alive
}

async function readRuns(io: SnapshotIO, dirs: string[], nowMs: number, caches: Caches): Promise<Run[]> {
  const runs: Run[] = []
  for (const dir of dirs) {
    let entries: Entry[]
    try { entries = await io.list(dir) } catch { continue }
    const sid = dir.split('/').pop() ?? ''
    for (const ent of entries) {
      const m = /^(\d+)\.ndjson$/.exec(ent.name)
      if (!m || ent.kind !== 'file') continue
      const file = `${dir}/${ent.name}`
      if (!caches.firstSeen.has(file)) caches.firstSeen.set(file, Math.min(nowMs, ent.mtimeMs || nowMs))
      const hit = caches.parsed.get(file)
      if (hit && hit.mtimeMs === ent.mtimeMs && hit.size === ent.size) { runs.push(...hit.runs); continue }
      let text = ''
      try { text = await io.read(file) } catch { continue }
      const parsed = parseEvents(text, file, Number(m[1]), sid)
      for (const r of parsed) r.fileMtimeMs = ent.mtimeMs
      caches.parsed.set(file, { mtimeMs: ent.mtimeMs, size: ent.size, runs: parsed })
      runs.push(...parsed)
    }
  }
  return runs
}

/** mtime (ms) of a non-empty file, else undefined. */
async function nonEmptyAt(io: SnapshotIO, p: string): Promise<number | undefined> {
  try { const s = await io.stat(p); return s.size > 0 ? s.mtimeMs : undefined } catch { return undefined }
}

async function readText(io: SnapshotIO, p: string): Promise<string | undefined> {
  try { return await io.read(p) } catch { return undefined }
}

/** Everything classify() needs, gathered with one ps call and a stat per artifact. */
async function gather(io: SnapshotIO, runs: Run[], firstSeen: Map<string, number>): Promise<Facts> {
  const facts: Facts = {
    alive: new Set(), present: new Set(), presentAt: new Map(), firstSeen, loopExit: new Map(), loopExitAt: new Map(), round: new Map(), phase: new Map(),
  }
  const open = [...new Set(runs.filter(r => !r.done).map(r => r.pid))]
  if (open.length) {
    try {
      for (const p of await io.alivePids(open)) facts.alive.add(p)
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
  for (const p of paths) {
    const at = await nonEmptyAt(io, p)
    if (at !== undefined) { facts.present.add(p); facts.presentAt!.set(p, at) }
  }
  for (const d of workDirs) {
    const exit = await readText(io, `${d}/loop.exit`)
    if (exit !== undefined && exit.trim() !== '') {
      facts.loopExit.set(`${d}/loop.exit`, exit.trim())
      try { facts.loopExitAt!.set(`${d}/loop.exit`, (await io.stat(`${d}/loop.exit`)).mtimeMs) } catch {}
    }
    const loopLog = await readText(io, `${d}/loop.log`)
    const round = loopLog && workRound(loopLog)
    if (round) facts.round.set(d, round)
    // Round N>1 logs to run-<HHMMSS>.log; the newest run*.log is the live round's.
    let log = `${d}/run.log`
    try {
      const logs = (await io.list(d)).filter((e) => /^run.*\.log$/.test(e.name))
      logs.sort((a, b) => b.mtimeMs - a.mtimeMs)
      if (logs[0]) log = `${d}/${logs[0].name}`
    } catch {}
    const runLog = await readText(io, log)
    const phase = runLog && workPhase(runLog)
    if (phase) facts.phase.set(d, phase)
  }
  return facts
}

/** Every run under `eventDirs`, classified at `nowMs`. */
export async function buildViews(io: SnapshotIO, eventDirs: string[], nowMs: number, caches: Caches): Promise<View[]> {
  const runs = await readRuns(io, eventDirs, nowMs, caches)
  return classify(runs, await gather(io, runs, caches.firstSeen))
}
