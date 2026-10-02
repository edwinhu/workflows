// The per-edit Jev mod's pure half: which rule set a file belongs to, which lines an edit changed,
// and the one line a violation becomes. No `$` and no Node, so bun tests and the mod kit share it.

export type RuleSet = 'writing' | 'dev' | 'ds' | 'authoring' | 'typst'

/** Each set's rules directory under the plugin root. Only the directory itself is globbed by
 *  evidence.py, so its `uncalibrated/` subdirectory is never read: the layout is the wiring. */
export const RULE_DIRS: Record<RuleSet, string> = {
  writing: 'constraints/jev/writing',
  dev: 'constraints/jev/dev',
  ds: 'constraints/jev',
  authoring: 'constraints/jev/authoring',
  typst: 'constraints/jev/typst',
}

export const BLOCK_AT = 0.85

const PROSE = /\.(md|typ|tex)$/i
// what the harness loads as a skill, agent or command, a plugin's manifests, and .planning/ files
const AUTHORING = /(^|\/)(SKILL\.md|CLAUDE\.md|AGENTS\.md|plugin\.json|marketplace\.json|hooks\.json)$|\/(agents|commands)\/[^/]+\.md$|\/\.planning\//
// A talk's deck and speaker notes: slides*.typ / notes*.typ, or any .typ in a presentation/ directory.
const DECK = /(^|\/)(slides|notes)[^/]*\.typ$|(^|\/)presentation\/[^/]*\.typ$/i
const SHELL = /\.(sh|bash)$/i
// constraints/jev/dev/_dev.py TEST_PATH, so the mod and the dev rules agree on what a test is.
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[A-Za-z]+$|(^|\/)test_[^/]*\.py$|_test\.(go|py)$/

/** `workflow:` from an ACTIVE_WORKFLOW.md's text, as constraints/run-constraints.py reads it. */
export function workflowOf(text: string): string | null {
  return /^workflow:\s*([\w-]+)/m.exec(text)?.[1] ?? null
}

/**
 * The rule set for `path`, or null for none. A SKILL.md, agent or command .md, CLAUDE.md/AGENTS.md,
 * plugin.json, marketplace.json, hooks.json or a .planning/ file is authoring, ahead of the .md rule.
 * A talk's .typ deck or notes (by name, by a presentation/ directory, or under a `workflow: workshop`
 * cursor) is typst. Other prose (.md .typ .tex) is writing; a test file or a
 * shell script is dev; any other .py is ds when the nearest `.planning/ACTIVE_WORKFLOW.md` above it
 * (the workflow cursor; `workflowAt` walks up and answers its `workflow:`) says `ds`. A test file
 * inside a ds project is still dev: the dev rules are the ones written about tests.
 */
export async function ruleSetFor(path: string, workflowAt: (dir: string) => Promise<string | null>): Promise<RuleSet | null> {
  if (AUTHORING.test(path)) return 'authoring'
  if (DECK.test(path)) return 'typst'
  if (/\.typ$/i.test(path)) return (await workflowAt(dirname(path))) === 'workshop' ? 'typst' : 'writing'
  if (PROSE.test(path)) return 'writing'
  if (SHELL.test(path) || TEST_PATH.test(path)) return 'dev'
  if (/\.py$/i.test(path)) return (await workflowAt(dirname(path))) === 'ds' ? 'ds' : null
  return null
}

export function dirname(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/** Directories from `dir` up to and including `stop` (or `/`): the ACTIVE_WORKFLOW.md walk. */
export function ancestors(dir: string, stop: string): string[] {
  const out: string[] = []
  let d = dir.replace(/(.)\/+$/, '$1')
  for (;;) {
    out.push(d)
    if (d === stop || d === '/') return out
    d = dirname(d)
  }
}

export type Range = [number, number]

function linesOf(s: string): number {
  if (s === '') return 0
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0)
}

/** 1-based inclusive line spans where `needle` sits in `text`, every occurrence. */
function spansOf(text: string, needle: string): Range[] {
  const out: Range[] = []
  if (needle === '') return out
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
    const start = linesOf(text.slice(0, i) + 'x')
    out.push([start, start + Math.max(1, linesOf(needle)) - 1])
  }
  return out
}

/**
 * The lines an Edit/Write/MultiEdit changed, from the tool input and the file as it now reads:
 * a Write is the whole file, an edit the spans its new strings occupy (every occurrence, so a
 * string repeated elsewhere widens the span rather than misses it). Null when the input cannot say
 * (an edit that deleted, or a new string not found): the caller asks git for that one file.
 */
export function changedFromInput(tool: string, input: Record<string, unknown>, text: string): Range[] | null {
  if (tool === 'Write') return [[1, Math.max(1, linesOf(text))]]
  const news =
    tool === 'MultiEdit' && Array.isArray(input.edits)
      ? (input.edits as Record<string, unknown>[]).map(x => x?.new_string)
      : [input.new_string]
  const out: Range[] = []
  for (const n of news) {
    if (typeof n !== 'string' || n === '') return null
    const s = spansOf(text, n)
    if (!s.length) return null
    out.push(...s)
  }
  return merge([], out)
}

/** `git diff -U0` hunks of one file as new-side spans; a pure deletion is the line after it. */
export function rangesFromDiff(diff: string): Range[] {
  const out: Range[] = []
  for (const ln of diff.split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ln)
    if (!m) continue
    const start = Number(m[1])
    const n = m[2] === undefined ? 1 : Number(m[2])
    out.push(n === 0 ? [start + 1, start + 1] : [start, start + n - 1])
  }
  return merge([], out)
}

/** Union of two span lists, sorted, overlapping and adjacent spans joined. */
export function merge(a: Range[], b: Range[]): Range[] {
  const all = [...a, ...b].map(([lo, hi]) => [lo, hi] as Range).sort((x, y) => x[0] - y[0])
  const out: Range[] = []
  for (const r of all) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push(r)
  }
  return out
}

export function spanText(ranges: Range[]): string {
  return ranges.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}-${hi}`)).join(',')
}

export interface Verdict {
  rule: string
  p: number
  statement?: string
}

/** One line per rule at or above the bar; nothing for the rest. */
export function contextLines(verdicts: Verdict[], file: string, ranges: Range[]): string[] {
  return verdicts
    .filter(v => typeof v.p === 'number' && v.p >= BLOCK_AT)
    .sort((a, b) => b.p - a.p)
    .map(v => `Jev ${v.rule}: ${file}:${spanText(ranges)} — ${v.statement ?? 'see the rule'} (p=${v.p.toFixed(2)})`)
}

/**
 * Whether the mod runs: JEV_EDIT_MOD=0 turns it off everywhere, =1 on everywhere; otherwise it
 * runs in an interactive session only (a farm child, `claude -p` and the SDK are headless).
 */
export function enabled(flag: string | undefined, isInteractive: boolean): boolean {
  if (flag === '0') return false
  if (flag === '1') return true
  return isInteractive
}
