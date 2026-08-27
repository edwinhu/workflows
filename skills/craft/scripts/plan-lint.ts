#!/usr/bin/env bun
/**
 * plan-lint.ts — TIER 1 of craft's plan review: the decidable part, computed.
 *
 *   bun ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/plan-lint.ts <plan.md | args.json> [--json]
 *
 * Exit 0 = no findings, 1 = findings reported, 2 = could not parse.
 *
 * Every rule here answers a question about the plan's own structured fields with no agent and no
 * repo access. A rule belongs here only if two readers must reach the same verdict from the plan
 * text alone; anything needing the tree is TIER 2 (pre-flight execution).
 *
 * Accepts a craft args object as well as a plan file so a round's dispatched arguments can be
 * linted directly — that is also what the rule corpus was validated against.
 */

type Task = {
  id: string
  name: string
  work: string
  writablePaths: string[]
  acceptance: string
  redCommand: string | null
  /** A human's filed reason this task carries no red gate. Recorded and echoed, never graded. */
  redDisposition: string | null
  dependsOn: string[]
  refs: string[]
}
type Lens = { key: string; text: string }
type Plan = {
  tasks: Task[]
  /** Paths the plan authors BEFORE dispatch; the guard lets the main thread write these. */
  scaffoldPaths?: string[]
  mechanicalChecks: { name: string; cmd: string }[]
  reviewLenses: Lens[]
  successCriteria: string[]
  verification: string[]
  testFirst: Record<string, string>
  source: 'md' | 'json'
  /** Verbatim `## Run sizing` section of the plan. */
  runSizingText?: string
  /** The whole plan markdown, when one is reachable: the file itself, or `planPath` from the args. */
  planText?: string
  /** Rows whose cell count differs from their header's, recorded at parse where the count exists. */
  tableArity?: { id: string; row: number; got: number; want: number; text: string }[]
}
/**
 * The shape IMPLEMENT will run. `waves`/`criticalPath`/`widestWave` are null exactly when `cycle`
 * is not: a partial layering of an unschedulable graph would read as a plan that runs.
 */
type TaskGraph = {
  tasks: number
  waves: string[][] | null
  criticalPath: number | null
  widestWave: number | null
  cycle: string[] | null
}
type Finding = {
  rule: string
  severity: 'critical' | 'major' | 'minor'
  where: string
  message: string
  evidence?: string
}

// ---------------------------------------------------------------- parsing

/** Split on unescaped pipes, edges included — cells legitimately carry `\|` in code spans. */
const splitCells = (line: string): string[] => {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
    } else if (line[i] === '|') {
      cells.push(cur)
      cur = ''
    } else cur += line[i]
  }
  cells.push(cur)
  return cells
}

/** A markdown table row's content cells: the leading and trailing pipe edges dropped. */
const splitRow = (line: string): string[] => splitCells(line).slice(1, -1).map(c => c.trim())

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')

/** Numbered/bulleted list items under a `## <heading>` section, joined per item. */
const sectionItems = (md: string, heading: RegExp): string[] => {
  const lines = md.split('\n')
  const start = lines.findIndex(l => /^##\s/.test(l) && heading.test(l))
  if (start < 0) return []
  const items: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^##\s/.test(l)) break
    if (/^\s*(\d+\.|-)\s+/.test(l)) items.push(l.replace(/^\s*(\d+\.|-)\s+/, ''))
    else if (items.length && l.trim()) items[items.length - 1] += ' ' + l.trim()
  }
  return items
}

/** Everything under a `## <heading>` up to the next `## ` — prose and fences alike. */
const sectionText = (md: string, heading: RegExp): string => {
  const lines = md.split('\n')
  const start = lines.findIndex(l => /^##\s/.test(l) && heading.test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n')
}

/** The fenced block under `## Run sizing`, which carries lenses, mechanical checks and test-first. */
const runSizing = (md: string): string => {
  const m = md.match(/##\s*Run sizing[^\n]*\n+```[^\n]*\n([\s\S]*?)```/)
  return m ? m[1] : ''
}

/**
 * Entries in a `Label: key — description` block are continued by indentation, so an entry is
 * joined until the next line that starts a new key at the same or lesser indent.
 */
const blockEntries = (block: string, label: RegExp): string[] => {
  const lines = block.split('\n')
  const start = lines.findIndex(l => label.test(l))
  if (start < 0) return []
  const first = lines[start].replace(label, '').trim()
  const out: string[] = first ? [first] : []
  const baseIndent = lines[start].search(/\S/)
  const keyIndent = lines[start].indexOf(first) >= 0 ? lines[start].indexOf(first) : baseIndent
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    const ind = l.search(/\S/)
    if (ind <= baseIndent) break
    if (ind === keyIndent) out.push(l.trim())
    else if (out.length) out[out.length - 1] += ' ' + l.trim()
  }
  return out
}

const parseMarkdown = (md: string): Plan => {
  const lines = md.split('\n')
  const tasks: Task[] = []
  const tableArity: NonNullable<Plan['tableArity']> = []
  let header: string[] | null = null
  let headerWidth = 0
  for (const [n, line] of lines.entries()) {
    if (!line.trim().startsWith('|')) {
      if (header) header = null
      continue
    }
    const cells = splitRow(line)
    if (!header) {
      const h = cells.map(norm)
      if (h.includes('id') && h.some(c => c.includes('acceptance'))) {
        header = h
        headerWidth = splitCells(line).length
      }
      continue
    }
    if (cells.every(c => /^:?-+:?$/.test(c) || !c)) continue
    // Recorded before the id check: a misaligned row can shift the id column out of existence, and
    // that row is exactly the one worth naming.
    const width = splitCells(line).length
    if (width !== headerWidth)
      tableArity.push({ id: cells[header.indexOf('id')] ?? '', row: n + 1, got: width - 2, want: headerWidth - 2, text: line.trim() })
    // `skip` keeps the loose `red` alias from claiming a `redDisposition` column that precedes it.
    const col = (skip: RegExp | null, ...names: string[]) => {
      const i = header!.findIndex(
        h => (!skip || !skip.test(h)) && names.some(n => h === n || h.includes(n)),
      )
      return i < 0 ? '' : (cells[i] ?? '')
    }
    const at = (...names: string[]) => col(null, ...names)
    const id = at('id')
    if (!id || id === '—') continue
    const dep = at('dependson')
    tasks.push({
      id,
      name: at('name'),
      work: at('work'),
      writablePaths: splitList(at('writablepaths', 'writable')),
      acceptance: at('acceptance'),
      redCommand: cleanCmd(col(/disposition/, 'redcommand', 'red')),
      redDisposition: cellText(at('reddisposition', 'disposition')),
      dependsOn: dep && dep !== '—' && dep !== '-' ? splitList(dep) : [],
      refs: splitList(at('refs')),
    })
  }

  const rs = runSizing(md)
  const testFirst: Record<string, string> = {}
  for (const e of blockEntries(rs, /^\s*Test-first:\s*/)) {
    const m = e.match(/^([A-Za-z]\w*)\s*[—-]\s*(.*)$/)
    if (m) testFirst[m[1]] = cleanCmd(m[2]) ?? ''
  }
  const mech = blockEntries(rs, /^\s*Mechanical checks:\s*/).map(e => {
    const m = e.match(/^(\S+)\s*[—-]\s*(.*)$/)
    return { name: m ? m[1] : e, cmd: m ? (cleanCmd(m[2]) ?? '') : '' }
  })
  const lensesOf = (label: RegExp): Lens[] =>
    blockEntries(rs, label).flatMap(e => {
      // A bare comma list names keys and states no condition; the normal form is `key — description`.
      if (!/[—-]\s/.test(e) && e.includes(','))
        return e.split(',').map(k => ({ key: k.trim(), text: '' }))
      const m = e.match(/^(\S+)\s*[—-]\s*([\s\S]*)$/)
      return [m ? { key: m[1], text: m[2] } : { key: e.trim(), text: '' }]
    }).filter(l => l.key && !/\s/.test(l.key))

  return {
    tasks,
    mechanicalChecks: mech,
    reviewLenses: lensesOf(/^\s*Review lenses:\s*/),
    successCriteria: sectionItems(md, /Success criteria/i),
    verification: sectionItems(md, /Verification/i),
    testFirst,
    // Declared in the dispatch block, not the prose; a markdown-only lint sees none.
    scaffoldPaths: [],
    source: 'md',
    runSizingText: sectionText(md, /Run sizing/i),
    planText: md,
    tableArity,
  }
}

const splitList = (s: string): string[] =>
  s
    .split(/[,\n]/)
    .map(x => x.replace(/`/g, '').trim())
    .filter(x => x && x !== '—' && x !== '-' && x !== '[]')

/** A prose cell: backticks stripped, an em-dash placeholder read as empty. */
const cellText = (s: string): string | null => {
  const v = (s ?? '').replace(/`/g, '').trim()
  return !v || v === '—' || v === '-' ? null : v
}

/** Strip a markdown code span and a trailing parenthetical gloss from a command cell. */
const cleanCmd = (s: string): string | null => {
  if (!s) return null
  const span = s.match(/`([^`]+)`/)
  const v = (span ? span[1] : s).trim()
  return !v || v === '—' || v === '-' ? null : v
}

const parseArgs = (j: any): Plan => ({
  scaffoldPaths: Array.isArray(j.scaffoldPaths) ? j.scaffoldPaths.filter((x: any) => typeof x === 'string') : [],
  tasks: (j.tasks ?? []).map((t: any) => ({
    id: t.id ?? '',
    name: t.name ?? '',
    work: t.work ?? '',
    writablePaths: t.writablePaths ?? [],
    acceptance: t.acceptance ?? '',
    redCommand: t.redCommand ?? null,
    redDisposition: typeof t.redDisposition === 'string' ? t.redDisposition : null,
    dependsOn: t.dependsOn == null ? [] : Array.isArray(t.dependsOn) ? t.dependsOn : [t.dependsOn],
    refs: t.refs ?? [],
  })),
  mechanicalChecks: (j.mechanicalChecks ?? []).map((m: any) => ({
    name: m.name ?? m.key ?? '',
    cmd: m.cmd ?? '',
  })),
  reviewLenses: (j.reviewLenses ?? []).map((l: any) => ({ key: l.key ?? '', text: l.prompt ?? '' })),
  successCriteria: [],
  verification: [],
  testFirst: Object.fromEntries(
    (j.tasks ?? []).filter((t: any) => t.redCommand).map((t: any) => [t.id, t.redCommand]),
  ),
  source: 'json',
})

// ---------------------------------------------------------------- helpers

// A path, not a prose token: no interior extension, so `bridge.ts/server.ts` is two names, not one.
const ARTIFACT = /(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:ts|tsx|js|mjs|sh|json|md|toml|sql|py)\b/g
const artifactsIn = (s: string): string[] => [...new Set((s ?? '').match(ARTIFACT) ?? [])]

/** An assertion script — the class that must not be authored by the task it gates. */
const isAssertionScript = (a: string) => /(^|\/)(assert|verify|check)[\w-]*\.(sh|ts)$/.test(a)

/** A clause counts as commanded when it names something a shell could run. */
const RUNNABLE =
  /(^|[\s`(])(bash|sh|ls|test|stat|bun|bunx|npm|npx|node|deno|cargo|go|make|git|rg|grep|jq|systemctl|curl|python3?|pytest|\.\/)\s/
// A bare executable path is as runnable as one with an explicit interpreter.
const isRunnable = (v: string): boolean =>
  RUNNABLE.test(' ' + v + ' ') || /^(?:[\w.-]+\/)*[\w-]+\.(?:sh|ts|js|py)\b/.test(v)

// Stricter than `isRunnable` for prose: a bare filename in a sentence is a noun, not a claim, so an
// executable path only counts as a stated command when it carries at least one argument.
const isProseCommand = (v: string): boolean =>
  RUNNABLE.test(' ' + v + ' ') ||
  /^(?:[\w.-]+\/)*[\w-]+\.(?:sh|ts|js|py)\b\s+\S/.test(v.trim())

/** Code spans in a clause, backticks stripped. */
const spansIn = (clause: string): string[] =>
  (clause.match(/`[^`]+`/g) ?? []).map(s => s.replace(/`/g, '').trim())

const hasCommand = (clause: string): boolean => spansIn(clause).some(isRunnable)

/** Runnable code spans, whitespace-collapsed so two spellings of one command compare equal. */
const commandsIn = (s: string): string[] =>
  spansIn(s ?? '').filter(isRunnable).map(v => v.replace(/\s+/g, ' ').trim())

/** Suite-level words whose presence in a clause is answered by a mechanical check that runs them. */
const SUITE = /\b(tests?|typecheck|tsc|build|lint|dependenc\w+)\b/gi

/**
 * "all pre-existing tests pass" states no command and needs none: the run's `tests` mechanical check
 * executes it. A clause is unchecked only when NOTHING — inline command, named artifact, or
 * mechanical check — can evaluate it.
 */
const coveredByMechanical = (clause: string, mech: { cmd: string }[]): boolean => {
  const tokens = [
    ...artifactsIn(clause),
    ...(clause.match(SUITE) ?? []).map(t => t.toLowerCase().replace(/s$/, '')),
  ]
  return tokens.some(t => mech.some(m => m.cmd.toLowerCase().includes(t.toLowerCase())))
}

/** Acceptance cells are semicolon-delimited by craft's own plan convention. */
const clausesOf = (acceptance: string): string[] => {
  const text = acceptance ?? ''
  const sentences = text.split(/(?<=\.)\s+(?=[A-Z`])/).filter(s => s.trim())
  // Multi-sentence acceptance is prose: split on sentences, where `;` is punctuation, not structure.
  if (sentences.length > 1) return sentences.map(c => c.trim()).filter(Boolean)
  const out: string[] = []
  let cur = ''
  let inSpan = false
  for (const ch of text) {
    if (ch === '`') inSpan = !inSpan
    if (ch === ';' && !inSpan) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map(c => c.trim()).filter(Boolean)
}

const pathOverlap = (a: string, b: string): boolean => {
  const na = a.replace(/\/+$/, '')
  const nb = b.replace(/\/+$/, '')
  return na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/')
}

const coveredBy = (path: string, globs: string[]): boolean =>
  globs.some(g => pathOverlap(path, g.replace(/\*+$/, '').replace(/\/+$/, '')))

/**
 * Layered the way `workflow.js implementWaves` layers: Kahn rounds, tasks[] order within a wave,
 * edges to ids not in the list dropped (workflow.js treats those as already satisfied). Deriving it
 * a second way would print a shape that is not the one dispatched. A self-edge is left in, so it
 * surfaces as the cycle it is.
 */
const taskGraph = (tasks: Task[]): TaskGraph => {
  const ids = new Set(tasks.map(t => t.id))
  const pending = new Map(tasks.map(t => [t.id, t.dependsOn.filter(d => ids.has(d))]))
  const waves: string[][] = []
  const done = new Set<string>()
  while (pending.size) {
    const ready = [...pending].filter(([, ds]) => ds.every(d => done.has(d))).map(([id]) => id)
    if (!ready.length)
      return { tasks: tasks.length, waves: null, criticalPath: null, widestWave: null, cycle: [...pending.keys()] }
    waves.push(tasks.filter(t => ready.includes(t.id)).map(t => t.id))
    for (const id of ready) {
      done.add(id)
      pending.delete(id)
    }
  }
  return {
    tasks: tasks.length,
    waves,
    criticalPath: waves.length,
    widestWave: waves.reduce((m, w) => Math.max(m, w.length), 0),
    cycle: null,
  }
}

/** The two lines craft-dispatch.sh prints; `null` when there is nothing to lay out. */
const formatGraph = (g: TaskGraph): string | null => {
  if (!g.tasks) return null
  if (g.cycle)
    return `  waves: NONE — dependsOn cycle among ${g.cycle.join(', ')}; IMPLEMENT cannot be ordered`
  return (
    `  waves ${g.waves!.length}: ${g.waves!.map(w => w.join(',')).join(' | ')}\n` +
    `  critical path ${g.criticalPath} of ${g.tasks} tasks — widest wave ${g.widestWave}`
  )
}

/** Case-insensitive: LENS_SCHEMA's enum is lowercase, so a lens instructing ``major`` is naming
 *  the exact string the gate compares — the most correct form, not a near miss. */
const SEVERITY = /\b(CRITICAL|MAJOR|MINOR)\b/i
/** The two forms a round amendment is written in. The mixed-case one needs its dash: `round 3` in
 *  ordinary prose is not a marker. */
const ROUND_MARKER = /\bROUND \d+\b|\bRound \d+\s*[—–-]/g
const SHELL_META = /(\|\||&&|[;|><])/
/** Verbatim workflow.js RED_COMMAND_OPERATORS — the two must not disagree about what a gate may contain. */
const RED_COMMAND_OPERATORS = /[;&|`$><(){}\n\r]/

// ---------------------------------------------------------------- rules

const lint = (p: Plan): Finding[] => {
  const f: Finding[] = []
  const add = (
    rule: string,
    severity: Finding['severity'],
    where: string,
    message: string,
    evidence?: string,
  ) => f.push({ rule, severity, where, message, evidence })

  const byId = new Map(p.tasks.map(t => [t.id, t]))
  const mechCmds = new Set(p.mechanicalChecks.map(m => m.cmd.replace(/\s+/g, ' ').trim()))
  // Which task delivers a given artifact: it is named in the task's work and lands in its
  // writablePaths. Used by both the dependsOn rule and the self-gating rule.
  // A work cell routinely names a deliverable by bare filename ("three scripts under scripts/:
  // assert-x.sh") — resolve those against the task's own writable dirs, and register both spellings
  // so a gate that writes the full path still matches.
  const deliverer = new Map<string, string>()
  for (const t of p.tasks)
    for (const a of artifactsIn(t.work)) {
      const forms = new Set([a])
      if (!a.includes('/'))
        for (const w of t.writablePaths)
          if (w.endsWith('/')) forms.add(w + a)
      for (const form of forms)
        if (coveredBy(form, t.writablePaths) && !deliverer.has(form)) deliverer.set(form, t.id)
    }

  // R0 — scaffoldPaths is a hole in the write guard, so a scaffold that swallows a whole task's
  // writable surface is a blanket disarm wearing a declaration. The legitimate shape is narrow: the
  // one stub a redCommand needs in order to fail behaviourally instead of failing to import.
  // Callers construct Plan objects directly (the tests, and craft's own round linting), so this
  // key is not guaranteed present even though the type declares it.
  const scaffold = p.scaffoldPaths ?? []
  // Containment, not overlap: `coveredBy` is symmetric, so a stub `src/stub.py` would read as
  // "covering" the directory `src/` and flag the very shape this rule is meant to permit.
  const trim = (x: string) => x.replace(/\*+$/, '').replace(/\/+$/, '')
  const inside = (child: string, parent: string) =>
    trim(child) === trim(parent) || trim(child).startsWith(trim(parent) + '/')
  for (const t of p.tasks) {
    if (!t.writablePaths.length || !scaffold.length) continue
    if (t.writablePaths.every(w => scaffold.some(sp => inside(w, sp))))
      add(
        'scaffold-swallows-task',
        'major',
        `task ${t.id}`,
        `every writablePath of this task is inside scaffoldPaths, so the main thread may write the task's entire surface before it is ever dispatched — name the specific stub, not the task's directory`,
        `${t.writablePaths.join(', ')} ⊆ ${scaffold.join(', ')}`,
      )
  }

  for (const t of p.tasks) {
    const where = `task ${t.id}`

    // R1 — an acceptance clause no command checks. The single largest class in the corpus.
    for (const c of clausesOf(t.acceptance)) {
      if (!hasCommand(c) && !coveredByMechanical(c, p.mechanicalChecks))
        add(
          'acceptance-clause-uncommanded',
          'minor',
          where,
          'acceptance clause names no runnable command, so nothing at the gate can evaluate it',
          c.length > 160 ? c.slice(0, 157) + '…' : c,
        )
    }

    // R18 — `$?` after a pipeline is the LAST stage's status, so the command being asserted is not
    // the one whose exit code is read. `||` is not a pipeline.
    for (const c of clausesOf(t.acceptance)) {
      const piped = /\|/.test(c.replace(/\|\|/g, ''))
      const readsStatus = /\$\?/.test(c) || /PIPESTATUS/.test(c)
      const guarded = /set\s+-[a-zA-Z]*o\s+pipefail/.test(c) || /\$\{PIPESTATUS\[0\]\}/.test(c)
      if (piped && readsStatus && !guarded)
        add(
          'pipeline-exit-code',
          'major',
          where,
          'clause pipes and then reads `$?`, which is the last stage\'s status — the command being asserted is not the one whose exit code is read; use `set -o pipefail`, `${PIPESTATUS[0]}`, or redirect to a file',
          c.length > 160 ? c.slice(0, 157) + '…' : c,
        )
    }

    // R19 — a mechanical check runs whether or not this task did anything, so an acceptance made
    // only of them is true before the work starts.
    const acceptCmds = commandsIn(t.acceptance)
    if (acceptCmds.length && acceptCmds.every(c => mechCmds.has(c))) {
      const ev = acceptCmds.join(' ; ')
      add(
        'acceptance-is-the-mechanical-check',
        'major',
        where,
        'every command in the acceptance is also a mechanicalCheck, which runs whether or not this task did anything — the acceptance needs one clause that is false before the work and true after it',
        ev.length > 160 ? ev.slice(0, 157) + '…' : ev,
      )
    }

    // R2 — a red gate, or the filed reason there is none. A task whose work is already complete
    // can satisfy no executable gate (red-at-dispatch refuses a command that exits 0), so
    // `redDisposition` records the human's claim instead; dispatch echoes it. Its CONTENT is
    // judgement and is deliberately not graded — non-empty is the whole check.
    const disposition = (t.redDisposition ?? '').trim()
    if (t.redCommand && disposition)
      add(
        'red-both-declared',
        'major',
        where,
        'task declares both redCommand and redDisposition — it cannot be both red-gated and dispositioned; pick one',
        disposition,
      )
    else if (!t.redCommand && !disposition)
      add(
        'redcommand-missing',
        'major',
        where,
        'task declares no redCommand and no redDisposition, so it is neither red-gated nor accounted for',
      )

    if (t.redCommand) {
      const rc = t.redCommand

      // R3 — a gate satisfiable by `touch` + `chmod +x` probes existence, never behaviour.
      if (/^\s*(ls|stat|test\s+-[fxer]+)\b/.test(rc) && !SHELL_META.test(rc))
        add(
          'redcommand-existence-only',
          'major',
          where,
          'redCommand tests only that files exist — satisfiable by `touch`, so no behaviour is gated',
          rc,
        )

      // R5 — the same character class workflow.js refuses (RED_COMMAND_OPERATORS). A `bash -c`
      // wrapper is NOT an exemption there: the probe runs the string verbatim, so any operator is
      // arbitrary code with the probe's authority. A gate this rule passes must be one invocation.
      if (RED_COMMAND_OPERATORS.test(rc))
        add(
          'gate-shell-operator',
          'major',
          where,
          'redCommand contains a shell operator; craft rejects every one of `; & | ` $ > < ( ) { }` and newline at arg-validation, wrapper or not — the gate must be a single invocation',
          rc,
        )

      // R4 — a relative gate path is only safe if every other gate agrees about cwd.
      const rel = rc.match(/(?:^|\s)((?!\/)[\w.-]+\/[\w./-]+)/)
      if (rel && p.mechanicalChecks.some(m => /\bcd\s+\//.test(m.cmd)))
        add(
          'redcommand-relative-path',
          'minor',
          where,
          'redCommand uses a repo-relative path while mechanical checks `cd` to an absolute root first — the two disagree about cwd',
          rc,
        )
    }

    // R8 — a gate the task itself writes is circular: the task grades its own homework.
    const gateArtifacts = [
      ...artifactsIn(t.redCommand ?? ''),
      ...artifactsIn(t.acceptance),
    ]
    // Running code you just wrote is the point of a red gate; authoring the ASSERTION that grades
    // you is not — that is the circular case, so this fires only on assertion scripts.
    const selfGated = [...new Set(gateArtifacts)].filter(
      a => deliverer.get(a) === t.id && isAssertionScript(a),
    )
    if (selfGated.length)
      add(
        'self-gating-task',
        'major',
        where,
        `gate runs ${selfGated.length} assertion script(s) this same task delivers — the task grades itself`,
        selfGated.join(', '),
      )

    // R7 — a gate that depends on another task's artifact without declaring the edge.
    for (const a of new Set(gateArtifacts)) {
      const d = deliverer.get(a)
      if (d && d !== t.id && !t.dependsOn.includes(d))
        add(
          'dependson-missing',
          'major',
          where,
          `gate runs \`${a}\`, delivered by ${d}, but dependsOn does not include ${d}`,
          a,
        )
    }

    // R15 — an acceptance clause that names a file the task must produce, outside its writable set.
    // NOTE: "acceptance names a file no task may create" is deliberately NOT a rule here. Tier 1
    // cannot tell a missing artifact from one that already exists in the tree; that is TIER 2.

    // R14 — a deliverable the plan mandates but no gate anywhere runs or inspects.
    const gateSurface = [
      t.acceptance,
      t.redCommand ?? '',
      ...p.mechanicalChecks.map(m => m.cmd),
      ...p.tasks.map(x => x.acceptance),
    ].join(' ')
    // Scoped to artifacts that exist in order to be RUN — assertion scripts and tests. A source
    // file named in `work` is gated through behaviour, not by name.
    for (const a of artifactsIn(t.work))
      if (
        (isAssertionScript(a) || /\.test\.[jt]s$/.test(a)) &&
        coveredBy(a, t.writablePaths) &&
        !gateSurface.includes(a)
      )
        add(
          'work-artifact-unasserted',
          'major',
          where,
          `work delivers \`${a}\` but no acceptance clause, redCommand or mechanical check names it`,
          a,
        )

    // R15 — accreted rounds. A round's amendment REPLACES the work cell. Appending leaves the
    // implementer holding every superseded instruction beside the live one, and the two runs in the
    // corpus that never converged are exactly the two that did this (21 and 17 markers, against 0
    // everywhere else).
    const markers = t.work.match(ROUND_MARKER) ?? []
    if (markers.length > 1)
      add(
        'work-accretion',
        'major',
        where,
        `work carries ${markers.length} round markers (${markers.join(', ')}) — a round amendment REPLACES this cell, it does not append to it; the implementer is being handed superseded instructions`,
        markers.join(' / '),
      )
  }

  // R20 — the parser reads cells POSITIONALLY, so a misaligned row silently binds a cell under the
  // wrong column name, and markdown renders it wrong too.
  for (const r of p.tableArity ?? [])
    add(
      'plan-table-column-arity',
      'major',
      r.id ? `task ${r.id}` : `row ${r.row}`,
      `table row has ${r.got} cells against the header's ${r.want} — cells are read positionally, so every column after the gap binds the wrong value`,
      r.text.length > 120 ? r.text.slice(0, 117) + '…' : r.text,
    )

  // R21 — only `acceptance`, `redCommand` and `mechanicalChecks` are ever executed; a command
  // stated anywhere else reads as part of the gate and runs nowhere. Containment is one-directional
  // on purpose: prose that ADDS a stage to a command an acceptance runs is the defect, not a match.
  if (p.planText) {
    const collapse = (s: string) => (s ?? '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
    const executed = [
      ...p.tasks.map(t => t.acceptance),
      ...p.tasks.map(t => t.redCommand ?? ''),
      ...p.mechanicalChecks.map(m => m.cmd),
    ].map(collapse)
    const candidates = new Map<string, number>()
    let inFence = false
    let inRunSizing = false
    let inComment = false
    for (const [i, line] of p.planText.split('\n').entries()) {
      const t = line.trim()
      if (inComment) {
        if (t.includes('-->')) inComment = false
        continue
      }
      if (/<!--\s*craft:dispatch/.test(t)) {
        inComment = !t.includes('-->')
        continue
      }
      if (/^##\s/.test(t)) inRunSizing = /run sizing/i.test(t)
      if (inRunSizing) continue
      if (t.startsWith('```')) {
        inFence = !inFence
        continue
      }
      if (t.startsWith('|')) continue
      for (const c of inFence ? (t ? [t] : []) : spansIn(line))
        if (isProseCommand(c) && !candidates.has(collapse(c))) candidates.set(collapse(c), i + 1)
    }
    for (const [cmd, line] of candidates)
      if (!executed.some(e => e.includes(cmd)))
        add(
          'prose-command',
          'major',
          `plan:${line}`,
          'the prose states a command that no acceptance, redCommand or mechanicalCheck runs — it reads as part of the gate and is executed by nothing',
          cmd.length > 140 ? cmd.slice(0, 137) + '…' : cmd,
        )
  }

  // R17 — a cycle is unschedulable: workflow.js throws on it after the run is already dispatched,
  // so it is worth refusing here, where the run is still armed.
  const cycle = taskGraph(p.tasks).cycle
  if (cycle)
    add(
      'dependson-cycle',
      'critical',
      `tasks ${cycle.join(' + ')}`,
      'dependsOn contains a cycle, so IMPLEMENT cannot be ordered — a dependency is a read ordering, and a cycle means two tasks each need the other\'s output',
      cycle.join(' → '),
    )

  // R6 — two tasks that may run concurrently must not write the same paths.
  /** Does `from` transitively depend on `target`? Cycles terminate via the visited set. */
  const reaches = (from: Task | undefined, target: string, seen = new Set<string>()): boolean => {
    if (!from || seen.has(from.id)) return false
    seen.add(from.id)
    return from.dependsOn.some(d => d === target || reaches(byId.get(d), target, seen))
  }
  const related = (a: Task, b: Task): boolean => reaches(a, b.id) || reaches(b, a.id)
  for (let i = 0; i < p.tasks.length; i++)
    for (let j = i + 1; j < p.tasks.length; j++) {
      const a = p.tasks[i]
      const b = p.tasks[j]
      if (related(a, b)) continue
      for (const pa of a.writablePaths)
        for (const pb of b.writablePaths)
          if (pathOverlap(pa, pb))
            add(
              'writable-paths-overlap',
              'major',
              `tasks ${a.id} + ${b.id}`,
              `writablePaths overlap (\`${pa}\` vs \`${pb}\`) with no dependsOn ordering between them, so they may run in the same wave`,
              `${pa} | ${pb}`,
            )
    }

  // R9/R10 — a lens with no severity cannot block, and one with no condition cannot fire.
  for (const l of p.reviewLenses) {
    if (!l.text.trim())
      add(
        'lens-missing-condition',
        'major',
        `review lens ${l.key}`,
        'lens is named with no finding condition, so what it reports is undefined',
      )
    else if (!SEVERITY.test(l.text))
      add(
        'lens-missing-severity',
        'major',
        `review lens ${l.key}`,
        'lens states no severity; craft blocks only on critical|major, so a lens without one is decorative',
      )
  }

  // R11 — the task table and the Test-first block are two statements of the same gate.
  for (const [id, cmd] of Object.entries(p.testFirst)) {
    const t = byId.get(id)
    if (!t || !cmd || !t.redCommand) continue
    if (/[…]|\.\.\./.test(cmd)) continue // elided in the block; nothing to compare
    const head = (s: string) => s.replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ')
    if (head(cmd) !== head(t.redCommand))
      add(
        'redcommand-disagreement',
        'major',
        `task ${id}`,
        'the task table and the Run-sizing Test-first block declare different redCommands',
        `table: ${t.redCommand}  ||  test-first: ${cmd}`,
      )
  }

  // R13 — a success criterion naming an artifact no task row touches.
  const taskSurface = p.tasks.map(t => `${t.work} ${t.acceptance} ${t.writablePaths.join(' ')} ${t.redCommand ?? ''}`).join(' ')
  p.successCriteria.forEach((c, i) => {
    for (const a of artifactsIn(c))
      if (!taskSurface.includes(a) && !p.mechanicalChecks.some(m => m.cmd.includes(a)))
        add(
          'criterion-unmapped',
          'major',
          `success criterion ${i + 1}`,
          `criterion names \`${a}\`, which appears in no task row and no mechanical check`,
          a,
        )
  })

  // R12 — a stated count against an enumerated list. A plan that miscounts its own deliverables
  // has two different plans in it.
  const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  for (const [label, items] of [
    ['verification step', p.verification],
    ['success criterion', p.successCriteria],
  ] as const)
    items.forEach((item, i) => {
      const m = item.match(/\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([A-Za-z][\w-]*)\s+(?:scripts?|checks?|files?|tests?|tasks?|commands?)\b/i)
      const n = m ? (WORDS[m[1].toLowerCase()] ?? Number(m[1])) : null
      if (!n) return
      const listed = artifactsIn(item.split(/\bplus\b|\balong with\b|\bas well as\b/)[0]).length
      if (listed > 0 && listed !== n)
        add(
          'count-mismatch',
          'major',
          `${label} ${i + 1}`,
          `states ${n} but enumerates ${listed}`,
          item.length > 160 ? item.slice(0, 157) + '…' : item,
        )
    })

  return f
}

// ---------------------------------------------------------------- run context

/**
 * The facts that are not in the args object itself, read from the plan the args name: the dispatch
 * gate lints the ARGS, so without this the rules that need the DOCUMENT — `prose-command` and
 * `plan-table-column-arity` — never run there.
 */
const runContext = (_argsPath: string, j: any): Partial<Plan> => {
  const fs = require('node:fs')
  const out: Partial<Plan> = {}

  if (typeof j.planPath === 'string' && fs.existsSync(j.planPath)) {
    const md = fs.readFileSync(j.planPath, 'utf8')
    out.runSizingText = sectionText(md, /Run sizing/i)
    out.planText = md
    out.tableArity = parseMarkdown(md).tableArity
  }
  return out
}

// ---------------------------------------------------------------- main

const main = () => {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  // --graph prints the shape and nothing else, and always exits 0: it is information, not a gate.
  const asGraph = args.includes('--graph')
  const path = args.find(a => !a.startsWith('--'))
  if (!path) {
    console.error('usage: plan-lint.ts <plan.md | args.json> [--json] [--graph]')
    process.exit(2)
  }
  let plan: Plan
  try {
    const raw = require('node:fs').readFileSync(path, 'utf8')
    if (path.endsWith('.json')) {
      const j = JSON.parse(raw)
      plan = { ...parseArgs(j), ...runContext(path, j) }
    } else plan = parseMarkdown(raw)
  } catch (e) {
    console.error(`plan-lint: cannot read or parse ${path}: ${(e as Error).message}`)
    process.exit(2)
  }
  if (asGraph) {
    const line = formatGraph(taskGraph(plan.tasks))
    if (line) console.log(line)
    process.exit(0)
  }
  // A readOnly run declares `tasks: []` BY DEFINITION and carries its whole gate in
  // mechanicalChecks. Refusing on an empty task table alone made TIER 1 block exactly that run
  // shape, so nothing downstream of it — including the mechanical baseline probe — ever ran.
  if (!plan.tasks.length && !plan.mechanicalChecks.length) {
    console.error(`plan-lint: ${path} has no task table and no mechanicalChecks — nothing to lint`)
    process.exit(2)
  }

  const findings = lint(plan)
  if (asJson) {
    console.log(
      JSON.stringify({ path, tasks: plan.tasks.length, graph: taskGraph(plan.tasks), findings }, null, 2),
    )
  } else {
    const order = { critical: 0, major: 1, minor: 2 }
    for (const x of [...findings].sort((a, b) => order[a.severity] - order[b.severity])) {
      console.log(`${x.severity.toUpperCase().padEnd(8)} ${x.rule}  [${x.where}]`)
      console.log(`         ${x.message}`)
      if (x.evidence) console.log(`         > ${x.evidence}`)
    }
    console.log(
      `\n${findings.length} finding(s) over ${plan.tasks.length} task(s) — ` +
        `${new Set(findings.map(x => x.rule)).size} distinct rule(s)`,
    )
  }
  process.exit(findings.length ? 1 : 0)
}

if (import.meta.main) main()

export { lint, parseMarkdown, parseArgs, runContext, taskGraph, formatGraph, commandsIn, coveredBy, type Plan, type Finding, type TaskGraph }
