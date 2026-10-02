// PreToolUse(CronDelete): refuse to cancel the loop that drives a work run still in flight.
// PostToolUse(CronCreate), `cronRecord`: file the new job id under the run(s) its prompt names.
//
// The refusal is TASK-SPECIFIC. The record half appends the new job id to `heartbeatCrons` in the
// args.json of every `.work/<run>` whose name the prompt names, so the guard denies only when a run
// CLAIMING this id is in flight; an id no run claims falls back to the old rule (deny while any run
// is in flight).
//
// In flight is decided as work-goal-resend.sh decides it -- a run directory holds args.json with no
// non-empty result.json beside it. That is a property of the filesystem, not of anyone's belief
// that the run is over, which is exactly where the judgement failed (measured 2026-09-14: a loop
// deleted at round 2 of 6 with the goal unmet, on the reasoning that the run had been halted).
import { joinPath, type Guard, type GuardIO } from './core.ts'
import { holdStateName, unevaluatedNote } from './hold.ts'

/** A cron job id as CronCreate mints them: 8 lowercase hex chars. */
const JOB_ID = /\b[0-9a-f]{8}\b/

/** Run directories under `<cwd>/.work` holding an args.json, with what that file says. */
interface Run {
  name: string
  /** The run root this one was found under. */
  base: string
  argsPath: string
  argsMtime: number
  inFlight: boolean
  crons: string[]
}

const RUN_ROOTS = ['.work']

async function runsUnder(io: GuardIO, cwd: string): Promise<Run[] | null> {
  const runs: Run[] = []
  let sawRoot = false
  for (const base of RUN_ROOTS) {
    const root = joinPath(cwd, base)
    const entries = await io.list(root)
    if (entries === null) continue // this root is absent
    sawRoot = true
    for (const name of entries) {
      const argsPath = joinPath(root, name, 'args.json')
      const args = await io.stat(argsPath)
      if (!args) continue // not a run directory
      const result = await io.stat(joinPath(root, name, 'result.json'))
      // An absent result.json IS the in-flight shape; a non-empty one is a verdict.
      const inFlight = !(result && result.size > 0)
      let crons: string[] = []
      try {
        const parsed = JSON.parse((await io.read(argsPath)) ?? '')
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.heartbeatCrons)) {
          crons = parsed.heartbeatCrons.filter((x: unknown) => typeof x === 'string')
        }
      } catch {
        // Unparseable args.json claims nothing; it is still a run directory for the fallback rule.
      }
      runs.push({ name, base, argsPath, argsMtime: args.mtimeMs, inFlight, crons })
    }
  }
  // Neither root exists: a determinate "no run here".
  return sawRoot ? runs : null
}

// grind runs OUTSIDE every session, so the hourly backstop a launching session keeps for it is
// claimed by no `.work` run and would fall to "nobody claims this id, and something is in flight ->
// deny". The record half marks such an id beside the hold ledger the guard already reads, so no
// project file and no per-workflow state is added. farm.sh --workflow prints the same backstop,
// naming its own run directory. The parenthesised nudge is matched, not the bare word: "farm out
// the review" is prose about delegating, not a heartbeat.
const NONRUN_PROMPT = /\bgrind\b|\(farm [^)\n]+\)/i

const tmp = (io: GuardIO): string => io.env('TMPDIR') || io.osTmpdir
const markedPath = (io: GuardIO, session: string): string => joinPath(tmp(io), `work-cron-nonrun-${session}.txt`)

async function isMarked(io: GuardIO, session: string, id: string): Promise<boolean> {
  if (!session) return false
  const text = await io.read(markedPath(io, session))
  return text !== null && text.split('\n').includes(id)
}

/**
 * NEVER blocks and NEVER answers: recording is best-effort, and a run whose id was never recorded
 * simply falls back to the old rule. Every failure is swallowed.
 */
export const cronRecord: Guard = async (payload, io) => {
  try {
    const toolInput = (payload?.tool_input ?? {}) as Record<string, unknown>
    const prompt = String(toolInput?.prompt ?? '')
    const response = payload?.tool_response as unknown

    // tool_response is an object for some tools and a bare string for others, so both are read.
    let id = ''
    if (response && typeof response === 'object' && typeof (response as Record<string, unknown>).id === 'string') {
      id = (response as Record<string, unknown>).id as string
    } else if (typeof response === 'string') {
      id = response.match(JOB_ID)?.[0] ?? ''
    }
    if (!JOB_ID.test(id)) return {}

    const cwd = String(payload?.cwd ?? '') || io.cwd
    const runs = (await runsUnder(io, cwd)) ?? []

    // A prompt that names a run belongs to that run, whatever else it says; only an id NO run claims
    // can be a grind or farm heartbeat.
    const session = String(payload?.session_id ?? '')
    if (session && NONRUN_PROMPT.test(prompt) && !runs.some(r => r.name && prompt.includes(r.name))) {
      if (!(await isMarked(io, session, id))) await io.append(markedPath(io, session), id + '\n')
    }

    for (const run of runs) {
      if (!run.name || !prompt.includes(run.name)) continue
      if (run.crons.includes(id)) continue // idempotent
      const raw = await io.read(run.argsPath)
      if (raw === null) throw new Error('args.json unreadable')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      parsed.heartbeatCrons = [...run.crons, id]
      // Keep the file's own formatting: the indent of its first nested line, and its trailing newline.
      const indent = raw.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? ''
      await io.write(run.argsPath, JSON.stringify(parsed, null, indent) + (raw.endsWith('\n') ? '\n' : ''))
    }
  } catch {
    // best-effort
  }
  return {}
}

const HOLD_ARMED =
  'A hold is ARMED for this session, so its objective has not closed yet. The heartbeat ' +
  'is what re-enters the session while the hold is working; deleting it now leaves the hold ' +
  'with nothing to wake it. Let the hold release itself (the check goes green AND the ' +
  'classifier judges the goal met), or have the USER confirm `work-hold.sh --disarm` at a ' +
  'terminal. If the USER has abandoned this run, retire it with ' +
  "`work-abandon.sh <run-dir> --why '<reason>'`: it writes the run's verdict, releases the " +
  'hold, and this delete is then allowed.'

export const cronDeleteGuard: Guard = async (payload, io) => {
  if (String(payload?.tool_name ?? '') !== 'CronDelete') return {}

  // The deliberate override, for genuinely abandoning a run.
  if (io.env('WORK_ALLOW_CRON_DELETE') === '1') return {}

  const cwd = String(payload?.cwd ?? '') || io.cwd
  const deleteId = String(((payload?.tool_input ?? {}) as Record<string, unknown>)?.id ?? '')

  // THE HOLD GATE: DONE MEANS GOAL MET. The authority on "closed" is the hold's own release, read
  // from the per-session ledger work-hold.ts writes -- not this guard's opinion and not the
  // session's. ONLY the payload's session_id: an ambient CLAUDE_CODE_SESSION_ID leaking in from the
  // session that launched the process once made this gate answer about the wrong hold (2026-09-27).
  // An ARMED hold only; a RELEASED one is not this gate's business. An UNEVALUATED hold still
  // denies, and names the skew, which is the only thing that ends that deadlock.
  const session = String(payload?.session_id ?? '')
  const statePath = joinPath(tmp(io), holdStateName(session))
  if (session && (await io.stat(statePath))) {
    let skew: string | null = null
    try {
      skew = unevaluatedNote(JSON.parse((await io.read(statePath)) ?? ''), Math.floor(io.nowMs() / 1000))
    } catch {
      // An unreadable state file says nothing about the hook's liveness; the deny is unchanged.
    }
    return {
      deny:
        (skew ? `The hold for this session was ${skew}. Until that is fixed the hold cannot release itself, so this delete stays refused — reload, then let the hold run. ` : '') +
        HOLD_ARMED,
    }
  }

  // No .work at all is a determinate "no run here", not a failure to decide, so it passes.
  const runs = await runsUnder(io, cwd)
  if (runs === null) return {}

  // A run that CLAIMS this id answers the question by itself: a heartbeat recorded for run A says
  // nothing about run B, so an unrelated in-flight run must not hold A's finished loop open.
  const claiming = deleteId ? runs.filter(r => r.crons.includes(deleteId)) : []

  // A heartbeat recorded as belonging to no run -- a grind or farm backstop -- is not a work run's
  // loop. A run that CLAIMS the id still wins.
  if (!claiming.length && (await isMarked(io, session, deleteId))) return {}

  const candidates = claiming.length ? claiming : runs

  // The newest in-flight run among the candidates, by args.json mtime -- the file the dispatch writes.
  let newest = ''
  let newestBase = '.work'
  let newestMtime = 0
  for (const run of candidates) {
    if (!run.inFlight) continue
    if (run.argsMtime > newestMtime) {
      newestMtime = run.argsMtime
      newest = run.name
      newestBase = run.base
    }
  }
  if (!newest) return {}

  // A run-directory name that is not a plain slug is withheld rather than repeated: .work can be
  // repo-shipped, so the name is untrusted text inside a message the reader acts on.
  const run = /^[A-Za-z0-9._-]+$/.test(newest) ? newest : `(a run under ${newestBase}/)`

  return {
    deny:
      (claiming.length
        ? `The loop you are deleting drives a work run that is still in flight: ${newestBase}/${run}/args.json ` +
          'records this cron in heartbeatCrons and has no verdict beside it. '
        : `A work run is still in flight: ${newestBase}/${run}/args.json has no verdict beside it, and no run ` +
          "claims this cron, so it cannot be told apart from that run's heartbeat. ") +
      'The loop is usually what drives that run to completion -- it is what re-enters the session to ' +
      'read the verdict, fix what failed and redispatch. Deleting it now strands the run: the ' +
      'dispatch keeps going detached and nothing comes back for it. Let the run finish ' +
      '(work-result.sh exits 0, or the round cap or time ceiling is reached), then delete the loop. ' +
      'If you genuinely mean to abandon the run, set WORK_ALLOW_CRON_DELETE=1 for the call and say ' +
      'so out loud.',
  }
}
