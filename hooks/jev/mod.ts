// The per-edit Jev mod: after an Edit/Write/MultiEdit lands, score the file against its rule set's
// WIRED Jev rules and add one line of context per rule at p(VIOLATED) >= 0.85. Advisory only.
//
//   rule set   hooks/jev/rules.ts ruleSetFor: exam question .typ -> exams, skill/agent/command
//              files, manifests and .planning/ -> authoring, lecture notes -> notes and a lecture
//              deck -> slides (all three from the
//              teaching plugin, $TEACHING_PLUGIN_ROOT or ~/.claude/skills/teaching; writing when it
//              is absent), a talk's slides/notes .typ (or any .typ under a `workflow: workshop`
//              cursor) -> typst, other prose -> writing, tests and shell -> dev, .py under a
//              `workflow: ds` ACTIVE_WORKFLOW.md -> ds; anything else is left alone
//   scoring    ONE $.process.run of skills/work/scripts/rule-check.ts --batch: the set's own
//              evidence.py (uncalibrated/ is below its glob), then ONE Decisions call for all its
//              rules through work-hold.ts decisionsCall, the plugin's one Jev transport
//   debounce   at most one evaluation per file per 10 s. An edit inside the window is deferred to
//              its end, and the deferred lines ride the NEXT tool result of any tool; a newer edit
//              to the file supersedes a pending, in-flight or undelivered one
//   where      interactive sessions; headless only with JEV_EDIT_MOD=1 (work-round.sh sets it for
//              the implementers); JEV_EDIT_MOD=0 turns it off everywhere
//
// NEVER A DECISION. It calls next(e) with the input unchanged and returns what that settled to,
// with context added or not; it never denies. Any failure adds nothing and goes to the debug log.
import type { EngineInterface, On, ToolCallResult } from 'claude-code'
import {
  RULE_DIRS, TEACHING_PROBE, TEACHING_SETS, ancestors, changedFromInput, contextLines, enabled, merge, rangesFromDiff, ruleSetFor,
  workflowOf, dirname, type Range, type RuleSet, type Verdict,
} from './rules.ts'

type $ = EngineInterface

export const WINDOW_MS = 10_000
const RUN_TIMEOUT_MS = 20_000
const JEV_MAX_SECONDS = '15'

interface FileState {
  lastStart: number
  gen: number
  pending: Range[]
  timer?: { cancel: () => void }
}

// Debounce state per file, and deferred lines per file awaiting the next tool result. Module state,
// lost on reload by design: a reload forgets the windows and the undelivered lines.
const files = new Map<string, FileState>()
const deferred = new Map<string, string[]>()

const log = ($: $, text: string) => $.ui.log(`jev-edit: ${text}`, { to: 'debug' })

function absolute(cwd: string, p: string): string {
  return p.startsWith('/') ? p : `${cwd.replace(/\/+$/, '')}/${p}`
}

function shown(cwd: string, file: string): string {
  const root = cwd.replace(/\/+$/, '') + '/'
  return file.startsWith(root) ? file.slice(root.length) : file
}

async function workflowAt($: $, dir: string): Promise<string | null> {
  const home = (await $.env.get('HOME')) || '/'
  for (const d of ancestors(dir, home)) {
    let text: string
    try {
      text = await $.fs.read(`${d === '/' ? '' : d}/.planning/ACTIVE_WORKFLOW.md`)
    } catch {
      continue
    }
    return workflowOf(text)
  }
  return null
}

/** The teaching plugin's root when the set's rules are there to run, else null. */
async function teachingRoot($: $, set: RuleSet): Promise<string | null> {
  const root = (await $.env.get('TEACHING_PLUGIN_ROOT')) || `${(await $.env.get('HOME')) || ''}/.claude/skills/teaching`
  try {
    await $.fs.read(`${root}/${TEACHING_PROBE[set]}`)
    return root
  } catch {
    return null
  }
}

/** The set and the rules directory an edit is scored against. */
interface Target {
  set: RuleSet
  dir: string
}

async function targetFor($: $, set: RuleSet): Promise<Target> {
  if (!TEACHING_SETS.has(set)) return { set, dir: `${$.plugin.root}/${RULE_DIRS[set]}` }
  const root = await teachingRoot($, set)
  if (root) return { set, dir: `${root}/${RULE_DIRS[set]}` }
  log($, `no teaching plugin with constraints/jev: teaching ${set} scored as writing`)
  return { set: 'writing', dir: `${$.plugin.root}/${RULE_DIRS.writing}` }
}

async function changedLines($: $, tool: string, input: Record<string, unknown>, file: string): Promise<Range[]> {
  let text = ''
  try {
    text = await $.fs.read(file)
  } catch {}
  const fromInput = changedFromInput(tool, input, text)
  if (fromInput) return fromInput
  const d = await $.process.run(['git', '-C', dirname(file), 'diff', '--no-color', '-U0', 'HEAD', '--', file], { timeoutMs: 5000 })
  const fromGit = d.exitCode === 0 ? rangesFromDiff(d.stdout) : []
  return fromGit.length ? fromGit : [[1, Math.max(1, text.split('\n').length)]]
}

/** The context lines for one evaluation; [] when nothing reaches the bar or anything failed. */
async function evaluate($: $, { set, dir }: Target, file: string, ranges: Range[], cwd: string): Promise<string[]> {
  const argv = [
    'bun', `${$.plugin.root}/skills/work/scripts/rule-check.ts`, '--batch',
    '--rules', dir, '--files', file,
    '--changed-lines', '-', '--max-time', JEV_MAX_SECONDS,
  ]
  const started = await $.clock.now()
  let run: Awaited<ReturnType<$['process']['run']>>
  try {
    run = await $.process.run(argv, { stdin: JSON.stringify({ [file]: ranges }), timeoutMs: RUN_TIMEOUT_MS, cwd: dirname(file) })
  } catch (err) {
    log($, `${file}: rule-check did not finish (${String(err)})`)
    return []
  }
  let out: { verdicts?: Verdict[]; unavailable?: { rule: string; reason: string }[] }
  try {
    out = JSON.parse(run.stdout)
  } catch {
    log($, `${file}: rule-check exit ${run.exitCode}, no JSON: ${run.stderr.slice(0, 300)}`)
    return []
  }
  const ms = (await $.clock.now()) - started
  if (out.unavailable?.length) log($, `${file}: unavailable ${out.unavailable.map(u => `${u.rule} (${u.reason})`).join('; ')}`)
  log($, `${file}: ${set} ${(out.verdicts ?? []).map(v => `${v.rule}=${v.p}`).join(' ')} in ${ms} ms`)
  return contextLines(out.verdicts ?? [], shown(cwd, file), ranges)
}

/** Deferred to the window's end: its lines wait in `deferred` for the next tool result. */
function defer($: $, file: string, st: FileState, target: Target, cwd: string, now: number) {
  st.timer?.cancel()
  st.timer = $.clock.after(Math.max(0, st.lastStart + WINDOW_MS - now), () => {
    st.timer = undefined
    void (async () => {
      const gen = st.gen
      const ranges = st.pending
      st.pending = []
      st.lastStart = await $.clock.now()
      const lines = await evaluate($, target, file, ranges, cwd)
      if (st.gen !== gen) {
        st.pending = merge(st.pending, ranges)
        return
      }
      if (lines.length) deferred.set(file, lines)
    })().catch(err => log($, `${file}: deferred evaluation failed (${String(err)})`))
  })
}

async function afterEdit($: $, e: Record<string, unknown>, result: ToolCallResult): Promise<ToolCallResult> {
  // Interactive = some surface draws (the terminal, the desktop app, a phone); `claude -p` has none.
  const isInteractive = (await $.session.surfaces()).length > 0
  if (!enabled(await $.env.get('JEV_EDIT_MOD'), isInteractive)) return result
  const raw = e.file_path
  if (typeof raw !== 'string' || raw === '') return result
  const cwd = await $.session.cwd()
  const file = absolute(cwd, raw)
  const set = await ruleSetFor(file, d => workflowAt($, d))
  if (!set) return result
  const target = await targetFor($, set)

  const tool = String(e.tool)
  const ranges = await changedLines($, tool, e, file)
  const now = await $.clock.now()
  const st = files.get(file) ?? { lastStart: -Infinity, gen: 0, pending: [] }
  files.set(file, st)
  const gen = ++st.gen
  st.pending = merge(st.pending, ranges)
  st.timer?.cancel()
  st.timer = undefined
  deferred.delete(file)

  if (now - st.lastStart < WINDOW_MS) {
    defer($, file, st, target, cwd, now)
    return result
  }
  st.lastStart = now
  const want = st.pending
  st.pending = []
  const lines = await evaluate($, target, file, want, cwd)
  if (st.gen !== gen) {
    // A newer edit to this file arrived while this one was scored: its evaluation covers these lines.
    st.pending = merge(st.pending, want)
    return result
  }
  return lines.length ? { ...result, context: [...(result.context ?? []), lines.join('\n')] } as ToolCallResult : result
}

export function registerJevEdit(on: On): void {
  // Every tool: an edit is scored, and any call carries the deferred lines that are ready.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    let out: ToolCallResult = result
    try {
      if (/^(Edit|Write|MultiEdit)$/.test(String(e.tool)) && !result.isError)
        out = await afterEdit($, e as unknown as Record<string, unknown>, result)
    } catch (err) {
      log($, `${String((e as { file_path?: unknown }).file_path)}: ${String(err)}`)
    }
    if (!deferred.size || out.deny !== undefined) return out
    const ready = [...deferred.values()].flat()
    deferred.clear()
    return { ...out, context: [...(out.context ?? []), ready.join('\n')] } as ToolCallResult
  }).catch(($, e, next) => {
    // Replay-safe: once called, next(e) resolves to what the tool already settled to.
    log($, `hook failed (${next.error.kind}: ${next.error.message})`)
    return next(e)
  })
}
