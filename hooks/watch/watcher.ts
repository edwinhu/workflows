// The watcher mod, registered from hooks/watch/watcher.ts: the farm-out runs and work rounds THIS session launched, read from files only.
//
//   wake          $.prompt.submit ONCE per run that reaches DONE or GONE, remembered in $.store; a finished
//                 one carries its report heads or its work verdict
//   /farm         a table of this session's runs, printed at once, no turn
//   beacon        <TMPDIR>/farm-events/<session>/watcher.alive, rewritten by every tick that completes:
//                 the one thing outside this module that can tell a session whose mods never loaded
//
// It draws no status line: the running line is bin/farm-status, a statusLine segment that rebuilds it
// from the same farm-events through ./snapshot.ts.
//
// It replaces the farm-runs plugin monitor, which never re-armed once it stopped. A timer started
// in session.start comes back with every reload. A headless session (`claude -p`, the SDK, a farm
// child with FARM_OUT_CHILD=1) registers nothing: it has nobody to draw for, and a farm child
// waking itself about its own runs would loop.
import type { EngineInterface, On } from 'claude-code'
import {
  artifactsOf, BEACON, dirname, HEAD_FILES, table, TICK_MS, pastHorizon, wakeable, wakeText, waitText,
  type ArtifactHead, type Outcome, type View,
} from './runs.ts'
import { buildViews, psArgv, psPids, type Caches, type SnapshotIO } from './snapshot.ts'
import { setForecastCache } from '../jev/forecast-mod.ts'

// The Jev forecast band's sampling tick (hooks/jev/forecast-mod.ts): ten minutes, and the script's
// own hourly gate decides whether that reaches the network.
const FORECAST_TICK_MS = 10 * 60_000

// Notified keys older than this are pruned from the shared store.
const KEEP_NOTIFIED_MS = 7 * 24 * 3600_000

// Module state: lost on reload by design. The store holds what must survive one.
const sessions = new Set<string>()
const caches: Caches = { firstSeen: new Map(), parsed: new Map() }
const woke = new Set<string>()
let ticking = false

async function tmpRoot($: EngineInterface): Promise<string> {
  return ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')
}

async function eventDirs($: EngineInterface): Promise<string[]> {
  const sid = await $.session.id()
  if (sid) sessions.add(sid)
  const roots = [...new Set([await tmpRoot($), '/tmp'])]
  const dirs: string[] = []
  for (const root of roots) for (const s of sessions) dirs.push(`${root.replace(/\/+$/, '')}/farm-events/${s}`)
  return dirs
}

/** The snapshot's reads, through the engine. */
function engineIO($: EngineInterface): SnapshotIO {
  return {
    list: (dir) => $.fs.list(dir),
    read: (p) => $.fs.read(p),
    stat: (p) => $.fs.stat(p),
    alivePids: async (pids) => psPids((await $.process.run(psArgv(pids), { timeoutMs: 5000 })).stdout),
  }
}

async function readText($: EngineInterface, p: string): Promise<string | undefined> {
  try { return await $.fs.read(p) } catch { return undefined }
}

async function snapshot($: EngineInterface): Promise<{ views: View[]; nowMs: number }> {
  const nowMs = await $.clock.now()
  return { views: await buildViews(engineIO($), await eventDirs($), nowMs, caches), nowMs }
}

/** What a finished run delivered, read once, just before its wake: a work loop's result.json, or the
 *  first HEAD_FILES artifacts of a farm or grind run that are regular, non-empty, absolute files written
 *  at or after its START (classify's present-and-fresh rule). A dead run gets nothing. */
async function outcome($: EngineInterface, v: View): Promise<Outcome | undefined> {
  if (v.state !== 'done') return undefined
  if (v.kind === 'work-loop') return { resultJson: (await readText($, `${v.runDir ?? dirname(v.out)}/result.json`)) ?? null }
  if (v.kind !== 'farm' && v.kind !== 'grind') return undefined
  const heads: ArtifactHead[] = []
  for (const p of artifactsOf(v)) {
    if (heads.length >= HEAD_FILES) break
    if (!p.startsWith('/')) continue
    const s = await $.fs.stat(p).catch(() => undefined)
    if (!s || s.kind !== 'file' || s.size === 0 || s.mtimeMs < v.startedMs) continue
    const text = await readText($, p)
    if (text !== undefined) heads.push({ path: p, size: s.size, text })
  }
  return { heads }
}

async function wake($: EngineInterface, views: View[], nowMs: number) {
  for (const v of wakeable(views)) {
    // A live run's newest WAIT alert wakes once per waits value: the run stays running.
    if (v.state === 'running' && v.wait) {
      const wid = `${v.id}:wait:${v.wait.waits}`
      if (!woke.has(wid)) {
        woke.add(wid)
        const wkey = `notified:${wid}`
        if (!(await $.store.get(wkey)) && !pastHorizon(v, nowMs)) {
          await $.store.set(wkey, nowMs)
          void $.prompt.submit({ text: waitText(v) })
        }
      }
      continue
    }
    if (v.state === 'running' || woke.has(v.id)) continue
    woke.add(v.id)
    const key = `notified:${v.id}`
    if (await $.store.get(key)) continue
    if (pastHorizon(v, nowMs)) continue
    // Read before the record, so a reload mid-read retries the wake rather than losing it.
    const text = wakeText(v, nowMs, await outcome($, v))
    // Recorded BEFORE the submit: a reload between the two must not wake twice.
    await $.store.set(key, nowMs)
    // Never awaited: submit resolves when the turn starts, and this tick may run mid-turn.
    void $.prompt.submit({ text })
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
    await wake($, views, nowMs)
    // Last, so a tick that throws leaves the beacon to go stale. write() creates the directory, so
    // the beacon is there before this session's first run files itself.
    const sid = await $.session.id()
    if (sid) await $.fs.write(`${await tmpRoot($)}/farm-events/${sid}/${BEACON}`, String(Math.floor(nowMs / 1000)))
  } finally {
    ticking = false
  }
}

/** One forecast sample, under credit-warn's hourly gate, then the cache handed to the band. */
async function forecastTick($: EngineInterface): Promise<void> {
  try {
    await $.process.run(['bun', `${$.plugin.root}/scripts/lib/openrouter-credits.ts`, '--sample'], { timeoutMs: 20_000 })
  } catch { /* the read below still shows the last sample */ }
  let c: unknown = null
  try { c = JSON.parse(await $.fs.read(`${await tmpRoot($)}/openrouter-credits.json`)) } catch { /* no cache yet */ }
  setForecastCache(c)
  try { $.ui.invalidate('ui.render') } catch { /* headless */ }
}

export function registerWatcher(on: On) {
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive || (await $.env.get('FARM_OUT_CHILD')) === '1') return next(e)
    // The promise is returned so a test clock can settle on it; the engine does not wait on it.
    $.clock.every(TICK_MS, () => tick($))
    void tick($)
    void prune($, await $.clock.now())
    // The module's one session.start, so the Jev forecast band's tick starts here too.
    $.clock.every(FORECAST_TICK_MS, () => forecastTick($))
    void forecastTick($)
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
