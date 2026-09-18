#!/usr/bin/env bun
/**
 * pc-probe.ts — deterministic CHECKER-SHAPE probe.
 *
 * Usage:  bun pc-probe.ts --target <plugin-dir> [--corpus <tics.yaml>] [--json]
 * Exit:   0 = no findings (or --help), 1 = findings, 2 = argument error, 3 = the probe crashed.
 *
 * 2 and 3 are separate because a caller must be able to tell "you invoked me wrong" from "I could
 * not do my job": the second is a gate that did not run, and a gate that did not run must not be
 * read as a gate that passed. An explicit --help is a successful invocation, so it exits 0.
 *
 * Every check is a named exported predicate, so a hook can import it rather than re-implement it.
 *
 * Node stdlib + bun only. No dependencies.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT COMPUTES, AND WHY IT DOES NOT ASK
 *
 * `skills/plugin-creator/SKILL.md` states the rule this probe enforces: if a constraint is
 * mechanically checkable, enforce it with a hook; if it requires judgment, keep it as prompt text.
 * A plugin therefore accumulates two kinds of checker — deterministic ENGINES and model-judgement
 * LENSES — and nothing noticed when a domain grew a second of either, or when one quietly stopped
 * working.
 *
 * Both categories are DERIVED from structures that already exist. There is deliberately no
 * manifest field, no registry file and no `kind:` frontmatter key: a declaration is a state file by
 * another name, it can disagree with the thing it describes, and then the tiebreak rule becomes the
 * bug. What cannot be derived is REPORTED (see `UnresolvedRef`), never guessed.
 *
 *   LENS   an entry in a `reviewLenses:` array in a SKILL.md. Domain: the skill directory it is in.
 *   ENGINE an executable that produces findings, identified by any of — a `CONSTRAINT` /
 *          `APPLIES_TO` / `SEVERITY` module contract; appearing in a `mechanicalChecks` entry;
 *          being spawned by a hook in `hooks/hooks.json`. Domain: below.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANTS, AND THE DEFECT EACH ONE IS NAMED AFTER
 *
 * Every invariant is backed by a real defect found in this repo by three read-only audits. An
 * invariant that flags something nobody has ever got wrong is noise, so there are only these.
 *
 * I1  At most ONE deterministic engine per domain, unless the second demonstrably delegates to the
 *     first (spawns it, imports it, or is a documented shim).
 *     Defect: `scripts/prose-lint.py` — a second 157-line prose engine loading the SAME pattern
 *     tables as `scripts/prose-audit.py`, with no live caller and no domain gating. Run by mistake
 *     during the audit, it produced a useless answer (every domain's guide on every draft).
 *     Decided two ways, because a "domain" is not one thing:
 *       (a) two modules declaring the same `CONSTRAINT` value;
 *       (b) two checkers consuming the same pattern-table module — mentioning its file AND one of
 *           its table symbols. Consuming a table's SYMBOLS is the relation that makes two engines
 *           rivals; SPAWNING a file is delegation, and is exempt.
 *
 * I2  At most ONE lens per domain — decided as: two lenses quoting the SAME string literal make the
 *     same claim twice.
 *     Defect: the `prose-register` lens (teaching) and the `slide-register` system (workflows) now
 *     make the same claim about the same three string literals at two severities, with no dedup
 *     path between a craft finding and a span id (sweep 3, F1).
 *     NOT "one lens per skill directory": `/writing` carries four lenses whose columns are
 *     genuinely different (one reads the plan, one the register), and a rule that flagged those
 *     would fire on correct structure. The shared literal is what makes two lenses one claim.
 *
 * I3  Every engine has at least one LIVE caller. A comment, a CHANGELOG line, a doc, or a test that
 *     names but never invokes it is NOT a caller.
 *     Defect: `scripts/prose-lint.py`, `ai-tic/linter/score.py`, `scripts/check-all.sh` — ~330 dead
 *     lines, one of which is named by a test file that never calls it.
 *     A contract module is REGISTERED BY ITS CONTRACT, not by a literal path: `run-constraints.py`
 *     auto-discovers on `APPLIES_TO`/`SEVERITY` by glob. So a contract module counts as called when
 *     the plugin holds a live discovery runner. If it holds none, they are all uncalled, which is
 *     the truth.
 *
 * I4  Every path literal a checker COMPUTES to reach another file must resolve.
 *     Defect: `skills/writing/references/writing-no-bold-lead.py:30` uses `parents[2]` where all ten
 *     siblings use `parents[3]`. It resolves to a path that does not exist, the subprocess raises,
 *     a bare `except` swallows it, and `check-all` files a `SEVERITY = "hard"` constraint under
 *     **passed**. Inert since v6.0.0, behind a docstring that argues at length that the rule lives
 *     in exactly one place.
 *
 * I5  Every entry in a suppression/exemption list must match at least one live label. An entry
 *     matching nothing is dead, and means the suppression silently stopped covering something.
 *     Defect: `hooks/writing-prose-check.ts:49-53` suppresses by prefix `"skills/writing-"`, but the
 *     tables moved to `skills/writing/references/` — slash, not hyphen — so Strunk, Volokh and
 *     McCloskey have been double-reported ever since. Both entries in that list match nothing.
 *
 * I6  No quoted string literal in a lens prompt may also appear in a deterministic pattern table for
 *     the same domain. That is a copy, and it is the computable half of "a lens carries routing and
 *     scope, never a rule."
 *     Defect: `'The answer:'` appears both in the `prose-register` lens prompt and in
 *     `slide-register`'s regex.
 *
 * I7  ADVISORY: every shipped pattern should carry a corpus id that is not in `tics.yaml`'s
 *     `rejected:` list.
 *     Defect: six phrases banned as AI tells that the corpus recorded as HUMAN, four of which fire
 *     in a live audit (`serves as` at 141/M, `Of course,` at 387/M).
 *     Decided by COMPILING each shipped regex and TESTING it against each rejected phrase — a
 *     substring test cannot see through an alternation, and `plays a (vital|key) role` must be
 *     caught by `'plays a vital role'`.
 *     The corpus usually lives on rjds and will usually be unreachable. That is exactly what the
 *     `UnresolvedRef` channel is for: I7 NEVER passes silently. It is also the one invariant that
 *     does not gate — advisories are their own channel and are excluded from the exit code, because
 *     a pattern's corpus standing is a claim about the world, not about the plugin's shape.
 *
 * I8  A rule has ONE representation. A `<stem>.md` beside a `<stem>.py` in the same checker
 *     directory (the corpus writes the markdown as `typst-<stem>.md`, so that prefix is allowed) is
 *     a rule stated twice: the script decides it, and the prose is the copy that rots.
 *     Defect: `typst/constraints` carries 23 `.md` and 28 `.py`, of which 14 are PAIRS — the debt
 *     `skills/workflow-creator/SKILL.md` already names. A checker needs no parallel `.md`; it runs.
 *     A rule may legitimately explain WHY while the checker decides WHETHER, and whether a body
 *     "merely restates" is not decidable — so the PAIR is flagged and the rationale case is
 *     DECLARED, never guessed. See EXEMPTIONS below.
 *
 * I9  A checker is REACHABLE. A `.py` exposing the checker contract that sits outside every
 *     discovery runner's enumerated directory runs only because someone wrote its name down, and is
 *     one rename from silence with nothing to report it.
 *     Decided from the two halves this probe already builds — `discoveryRunners` and the directories
 *     each one globs — never from the literal name `constraints/`, which is a convention in two
 *     plugins and the definition in neither.
 *     Two silences, both deliberate: with NO discovery runner at all, I9 says nothing (I3 already
 *     reports every contract module as uncalled, and one fact twice is one fact plus noise); and a
 *     CLI-shaped checker named in a runner's own exclusion list — typst's
 *     `CLI_CHECKERS = ("runts", "widows", "orphans", "section-hierarchy")` — is excluded from the
 *     import path on purpose, so it is read FROM the runner, not hardcoded here.
 *
 * I10 Every rule in a checker directory is SCOPED. A `.md` there with no `applies-to:` frontmatter
 *     is in scope for zero workflows and indistinguishable from one nobody scoped.
 *     `scripts/load-constraints.ts` already refuses this at load time; I10 makes it repo-wide and
 *     visible BEFORE load, where a file that no workflow will ever select still looks live.
 *
 * I12 The rules/constraints split is PHYSICAL. Sibling `rules/` and `constraints/` directories of
 *     one base may not share a stem; `constraints/` holds no `.md`; `rules/` holds no `.py`.
 *     I8 pairs files SIDE BY SIDE in one directory, so the moment a corpus splits into two the
 *     pairs leave its jurisdiction and it reads clean over a corpus still stating each rule twice.
 *     I12 is what survives the split. Judged per base, so a skill's rules/ never collides with the
 *     plugin root's constraints/.
 *
 * ---------------------------------------------------------------------------------------------
 * RULE vs CONSTRAINT — the distinction I8, I9, I10 and I12 make decidable
 *
 *   a RULE is markdown. No script can settle it; a model reads it and judges.
 *   a CONSTRAINT is code. A script decides it, and its finding IS the statement.
 *
 * They are never the same rule in two forms. Three skills document that distinction; until I8-I10
 * nothing decided it, so the corpus drifted into 14 pairs while the doctrine read as enforced.
 *
 * ---------------------------------------------------------------------------------------------
 * EXEMPTIONS
 *
 * One rule is exemptable — `two-representations` — because retiring a paired `.md` can delete the
 * only written rationale for a checker, and the probe cannot read a body and tell rationale from
 * restatement. The grammar is wc-probe's, in this probe's namespace, and a marker must be the WHOLE
 * trimmed line (optionally behind a `//`, `#` or `*` comment lead-in):
 *
 *     <!-- pc-probe: ignore-two-representations -->
 *
 * In Markdown a marker inside a fenced or indented block is an EXAMPLE, not a declaration — else a
 * file documenting this syntax exempts itself. A marker naming a rule nothing honours is a FINDING
 * (I11), never a silent no-op. Every exemption applied is carried in `ProbeResult.exemptions` and
 * printed as a SUPPRESSED note on EVERY run, in both output modes: a suppressed check nobody can see
 * is indistinguishable from a check that passed.
 *
 * ---------------------------------------------------------------------------------------------
 * SCOPE, STATED SO THE SILENCES ARE NOT MISTAKEN FOR PASSES
 *
 * - The probe REPORTS. It fixes nothing and edits nothing.
 * - Everything is judged INSIDE `--target`. The real I6 defect spans two repositories (a lens in
 *   the teaching plugin against a table in this one), and a single-target probe cannot see it.
 *   Cross-plugin lens/table pairs are out of reach and are not claimed.
 * - I5 reads only LABEL-SHAPED entries: a string containing `/`. `SKIP_DIRS`-style lists of bare
 *   names are not label suppressions and are left alone.
 * - I8/I9/I10 judge a CHECKER DIRECTORY, derived as: a directory holding at least one `.py` that
 *   exposes the checker contract, or a directory some discovery runner globs. A dir the probe
 *   cannot derive is not judged, and is not claimed to be clean.
 * - The checker contract is a module-level `def check(<one parameter>)` or an `APPLIES_TO`
 *   declaration. ONE parameter is exact, not conservative: both runners in the corpus call
 *   `mod.check(context)` / `mod.check(filepath)` with a single positional, and a two-parameter
 *   `def check(path, verbose=False)` in a CLI script is an internal helper no runner dispatches to.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------- types

export interface Finding {
  rule: string
  severity: 'critical' | 'major' | 'minor'
  file: string
  line?: number
  detail: string
  remedy: string
}

/** I7's channel. Reported, printed, and deliberately NOT counted by the exit code. */
export interface Advisory {
  rule: string
  file: string
  line?: number
  detail: string
}

/**
 * A reference the probe declined to check because it names something this process cannot resolve.
 *
 * Recorded and printed rather than dropped, for the same reason every exemption is: a check that
 * silently did not run is indistinguishable from a check that passed.
 */
export interface UnresolvedRef {
  rule: string
  file: string
  line?: number
  token: string
  /** Why the check did not run, e.g. "the corpus dictionary is not reachable from here". */
  reason: string
}

export interface Engine {
  file: string
  /** How it was identified: the derivation, never a declaration. */
  via: ('contract' | 'mechanicalChecks' | 'hooks.json' | 'table-consumer')[]
  /** `CONSTRAINT` value when the module declares one. */
  constraint: string | null
  /** Skill directory it lives in, relative to the target, or null. */
  skill: string | null
}

export interface Lens {
  file: string
  line: number
  key: string
  prompt: string
  /** The entry's `refs:` array, verbatim. Two lenses with different refs judge different SUBJECTS. */
  refs: string
  /** Skill directory it lives in, relative to the target, or null. */
  skill: string | null
}

export interface PatternTable {
  file: string
  /** Module-level table symbols (`_PUFFERY_PATTERNS`, …). */
  symbols: string[]
  /** Regex sources of every `(r"…", "…")` entry. */
  regexes: { source: string; line: number }[]
  skill: string | null
}

/**
 * A DECLARED suppression of one rule, file-scoped.
 *
 * Only `two-representations` is honoured (`KNOWN_EXEMPTION_RULES`); anything else is a finding under
 * I11. Region scope is deliberately not offered: I8's subject is a PAIR of files, not a line range,
 * so a region marker would name a span no predicate consults.
 */
export interface Exemption {
  rule: string
  file: string
  line: number
}

export interface ProbeResult {
  target: string
  findings: Finding[]
  /** I7. Printed in both modes; never gates. */
  advisories: Advisory[]
  unresolvedRefs: UnresolvedRef[]
  engines: Engine[]
  lenses: Lens[]
  tables: PatternTable[]
  /** Every exemption applied. Printed on every run, in both modes. */
  exemptions: Exemption[]
  /** Checker directories, relative to the target — what I8 and I10 were judged over. */
  checkerDirs: string[]
  /** Directories some discovery runner globs, relative to the target — what I9 was judged against. */
  enumeratedDirs: string[]
  /** The corpus dictionary actually read, or null when none was reachable. */
  corpus: string | null
  filesEligible: number
  filesScanned: number
  filesSkipped: string[]
  dirsSkipped: string[]
}

const SKIP_DIRS = new Set([
  '.git', '.jj', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv',
  '.next', '.cache', 'dist', 'coverage', '.pixi', '.mypy_cache', '.ruff_cache',
  // Declared temp and episode directories. `scratch/` in particular holds whole snapshot copies of
  // the plugin, so walking it reported every duplicated constraint module as a rival engine — 240
  // I1 findings about files nobody ships.
  'scratch', 'logs', '.planning', '.tmp', '.base-ast-cache', '.craft',
])

const SOURCE_EXT_RE = /\.(md|markdown|ts|mts|cts|js|mjs|cjs|sh|bash|py|json)$/i
const MARKDOWN_EXT_RE = /\.(md|markdown)$/i

// ---------------------------------------------------------------- fs

/**
 * Regular files under `dir`, skipping vendored and VCS directories.
 *
 * A directory that cannot be enumerated is APPENDED to `skipped`, not swallowed: silently returning
 * what was reachable turns lost coverage into a clean bill of health.
 */
export function collectFiles(dir: string, out: string[] = [], skipped: string[] = [], depth = 0): string[] {
  if (depth > 40) return out
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    skipped.push(dir)
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    let isDir = e.isDirectory()
    let isFile = e.isFile()
    if (e.isSymbolicLink()) {
      try {
        const st = statSync(p)
        isDir = st.isDirectory()
        isFile = st.isFile()
      } catch {
        continue
      }
    }
    if (isDir) {
      if (SKIP_DIRS.has(e.name)) continue
      // `.claude/worktrees/<name>` is a whole second copy of the plugin, checked out by another
      // session. Walking it triples every count and reports a defect twice under two paths.
      if (e.name === 'worktrees' && basename(dir) === '.claude') continue
      collectFiles(p, out, skipped, depth + 1)
    } else if (isFile) out.push(p)
  }
  return out
}

export function readTextOrNull(file: string): string | null {
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size > 4_000_000) return null
    const buf = readFileSync(file)
    for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

export function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

// ---------------------------------------------------------------- code views

/**
 * `text` with everything that is NOT executable content blanked, newlines and indexes preserved.
 *
 * This is what makes I3 decidable rather than a guess, so its method is stated rather than assumed:
 *
 *   .ts/.js  a lexer pass blanks `//` and block comments. String CONTENTS are kept, because a path
 *            inside a string is exactly how a script is spawned.
 *   .py/.sh  `#` to end of line when the `#` is not inside a quote, plus triple-quoted blocks,
 *            which is where a docstring naming a retired engine lives.
 *   .md      the INVERSE: only fenced blocks and inline backtick spans survive. Markdown prose that
 *            names a script is a doc, and a doc is not a caller; a backticked command is.
 *   .json    kept whole — JSON has no comments.
 *
 * The residual imprecision is named rather than hidden: a `#` inside a Python regex character class
 * would be read as a comment. It costs a MISSED caller, i.e. a false finding that a human reads and
 * dismisses, never a missed defect.
 */
export function codeView(file: string, text: string): string {
  const ext = extname(file).toLowerCase()
  if (MARKDOWN_EXT_RE.test(file)) return markdownCodeView(text)
  if (ext === '.json') return text
  if (ext === '.py' || ext === '.sh' || ext === '.bash') return hashCodeView(text)
  return jsCodeView(text)
}

const blankRun = (arr: string[], a: number, b: number) => {
  for (let k = a; k < b && k < arr.length; k++) if (arr[k] !== '\n') arr[k] = ' '
}

export function jsCodeView(src: string): string {
  const out = src.split('')
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i)
      const end = j === -1 ? src.length : j
      blankRun(out, i, end)
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2)
      const end = j === -1 ? src.length : j + 2
      blankRun(out, i, end)
      i = end
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === c) break
        if (src[j] === '\n' && c !== '`') break
        j++
      }
      i = Math.min(j, src.length) + 1
      continue
    }
    i++
  }
  return out.join('')
}

export function hashCodeView(src: string): string {
  const out = src.split('')
  let i = 0
  while (i < src.length) {
    const three = src.slice(i, i + 3)
    if (three === '"""' || three === "'''") {
      const j = src.indexOf(three, i + 3)
      const end = j === -1 ? src.length : j + 3
      blankRun(out, i, end)
      i = end
      continue
    }
    const c = src[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === c || src[j] === '\n') break
        j++
      }
      i = Math.min(j, src.length) + 1
      continue
    }
    if (c === '#') {
      const j = src.indexOf('\n', i)
      const end = j === -1 ? src.length : j
      blankRun(out, i, end)
      i = end
      continue
    }
    i++
  }
  return out.join('')
}

/**
 * Only FENCED blocks survive. Inline backtick spans do not.
 *
 * A backticked filename in a sentence is how prose NAMES a file —
 * `docs/DESIGN-prose-constraint-architecture.md:34` names `scripts/prose-lint.py` in a table of
 * engines it is documenting — and counting that as a caller gave the deadest file in the repo a
 * live caller. A fenced block in a SKILL.md is a command the model runs; that is a call.
 */
export function markdownCodeView(src: string): string {
  const lines = src.split('\n')
  let fence: string | null = null
  const kept = lines.map(line => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence === null) {
      if (m) {
        fence = m[1]
        return ' '.repeat(line.length)
      }
      return ' '.repeat(line.length)
    }
    if (m && m[1][0] === fence[0] && m[1].length >= fence.length) {
      fence = null
      return ' '.repeat(line.length)
    }
    return line
  })
  return kept.join('\n')
}

// ---------------------------------------------------------------- discovery

/** `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` substituted; null when a variable remains. */
export function resolveCmdPath(raw: string, target: string, skillDir: string | null): string | null {
  let p = raw.trim()
  p = p.split('${CLAUDE_PLUGIN_ROOT}').join(target).split('$CLAUDE_PLUGIN_ROOT').join(target)
  if (skillDir) p = p.split('${CLAUDE_SKILL_DIR}').join(skillDir).split('$CLAUDE_SKILL_DIR').join(skillDir)
  if (/\$\{?[A-Za-z_]/.test(p)) return null
  if (p === '~') p = homedir()
  else if (p.startsWith('~/')) p = join(homedir(), p.slice(2))
  if (!p.startsWith(sep)) return null
  return resolve(p)
}

/** Every path-looking token in a command string that lands inside the target. */
export function commandTargets(cmd: string, target: string, skillDir: string | null): string[] {
  const out: string[] = []
  for (const tok of cmd.split(/[\s"']+/)) {
    if (!tok || !SOURCE_EXT_RE.test(tok)) continue
    const p = resolveCmdPath(tok, target, skillDir)
    if (p && existsSync(p)) out.push(p)
  }
  return out
}

/** The skill directory (relative to `target`) a file lives in, or null. */
export function skillOf(file: string, target: string): string | null {
  const rel = relative(target, file)
  const parts = rel.split(sep)
  const i = parts.indexOf('skills')
  if (i === -1 || parts.length < i + 2) return null
  return parts.slice(0, i + 2).join('/')
}

/** Does this module carry the check-all contract? */
export function hasModuleContract(text: string): boolean {
  const hasConstraint = /^\s*CONSTRAINT\s*(?::[^=\n]*)?=/m.test(text)
  const hasApplies = /^\s*APPLIES_TO\s*(?::[^=\n]*)?=/m.test(text)
  const hasSeverity = /^\s*SEVERITY\s*(?::[^=\n]*)?=/m.test(text)
  return hasConstraint && (hasApplies || hasSeverity)
}

export function constraintValue(text: string): string | null {
  const m = /^\s*CONSTRAINT\s*(?::[^=\n]*)?=\s*["']([^"']+)["']/m.exec(text)
  return m ? m[1] : null
}

/**
 * The module-level table symbols and the regex sources of a pattern-table module.
 *
 * A pattern table is a module holding at least one `_UPPER_CASE` sequence and at least one
 * `(r"…", "…")` entry. That is the shape every table in this plugin already has; nothing declares
 * itself a table.
 */
export function parsePatternTable(file: string, text: string, target: string): PatternTable | null {
  // WHERE a table lives is part of what makes it one. Without this, every data script holding three
  // regexes counted as a rule table: `crsp_lseg_splice.py` and `mflinks_sec_bridge.py` became
  // "domains", and two documents mentioning one of them became two rival engines over it.
  const inReferences = relative(target, file).split(sep).includes('references')
  if (!inReferences && !hasModuleContract(text)) return null
  const symbols = [...text.matchAll(/^\s*(_?[A-Z][A-Z0-9_]*)\s*(?::[^=\n]*)?=\s*[[(]/gm)].map(m => m[1])
  const regexes: { source: string; line: number }[] = []
  // ADJACENT r-strings are CONCATENATED, because Python concatenates them. Reading only the first
  // one hands I7 a fragment like `(?:\bthese\s+findings\s+carry\b`, which does not compile and was
  // reported as NOT CHECKED — a real pattern disappearing into the honesty channel.
  for (const m of text.matchAll(/\(\s*((?:r(['"])(?:\\.|(?!\2)[^\\])*\2\s*)+)/g)) {
    const parts = [...m[1].matchAll(/r(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map(p => p[2])
    if (parts.length === 0) continue
    regexes.push({ source: parts.join(''), line: lineOf(text, m.index ?? 0) })
  }
  // Three entries, not one: a lone regex in a module is a helper, a table is a rule set.
  if (symbols.length === 0 || regexes.length < 3) return null
  return { file, symbols, regexes, skill: skillOf(file, target) }
}

/** Lens entries of a `reviewLenses:` array. */
export function parseLenses(file: string, text: string, target: string): Lens[] {
  const out: Lens[] = []
  const skill = skillOf(file, target)
  for (const anchor of text.matchAll(/reviewLenses\s*:\s*\[/g)) {
    const start = (anchor.index ?? 0) + anchor[0].length - 1
    // Bracket-match over a view with string contents blanked, so a `]` inside a prompt cannot end
    // the array early.
    const masked = jsCodeView(text)
    let depth = 0
    let end = -1
    for (let i = start; i < text.length; i++) {
      const c = masked[i]
      if (c === '[') depth++
      else if (c === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) end = text.length
    const span = text.slice(start, end)
    const keys = [...span.matchAll(/\bkey\s*:\s*"([^"]*)"/g)].map(m => m[1])
    const prompts = [...span.matchAll(/\bprompt\s*:\s*"((?:\\.|[^"\\])*)"/g)]
    // Positional, and only trusted when every entry carries one — a partial list would misalign
    // refs with prompts and turn fan-out into duplication or the reverse.
    const refsAll = [...span.matchAll(/\brefs\s*:\s*\[([^\]]*)\]/g)].map(m => m[1].replace(/\s+/g, ' ').trim())
    const refs = refsAll.length === prompts.length ? refsAll : null
    for (let i = 0; i < prompts.length; i++) {
      out.push({
        file,
        line: lineOf(text, start + (prompts[i].index ?? 0)),
        key: keys[i] ?? `lens#${i + 1}`,
        prompt: prompts[i][1],
        refs: refs ? refs[i] : '',
        skill,
      })
    }
  }
  return out
}

/** Paths named by `mechanicalChecks` `cmd:` strings. */
export function parseMechanicalChecks(file: string, text: string, target: string): string[] {
  const out: string[] = []
  const skillDir = (() => {
    const s = skillOf(file, target)
    return s ? join(target, s) : null
  })()
  for (const anchor of text.matchAll(/mechanicalChecks\s*:\s*\[/g)) {
    const start = (anchor.index ?? 0) + anchor[0].length - 1
    const masked = jsCodeView(text)
    let depth = 0
    let end = text.length
    for (let i = start; i < text.length; i++) {
      const c = masked[i]
      if (c === '[') depth++
      else if (c === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const span = text.slice(start, end)
    for (const m of span.matchAll(/\bcmd\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
      out.push(...commandTargets(m[1].replace(/\\"/g, '"'), target, skillDir))
    }
  }
  return out
}

/** Paths spawned by `hooks/hooks.json`. */
export function parseHookRegistry(target: string): string[] {
  const reg = join(target, 'hooks', 'hooks.json')
  const text = readTextOrNull(reg)
  if (text === null) return []
  const out: string[] = []
  for (const m of text.matchAll(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    out.push(...commandTargets(m[1].replace(/\\"/g, '"'), target, null))
  }
  return out
}

// ---------------------------------------------------------------- literals

/**
 * Quoted phrases inside a lens PROMPT — the prompt is itself a double-quoted string, so its own
 * quoting is single quotes, backticks or escaped doubles.
 *
 * Length >= 8 and at least one space, because a one-word quotation in a prompt is vocabulary and a
 * phrase is a rule. That threshold is what keeps I2 and I6 off correct structure.
 */
/**
 * Quoted spans of `text`, paired SEQUENTIALLY: the 1st quote with the 2nd, the 3rd with the 4th.
 *
 * Filtering by length inside the match, as `/'([^']{8,}?)'/g` did, lets a short quotation's CLOSING
 * quote pair with the next quotation's OPENING one — so `flag 'x' at minimum, and 'y'` yielded the
 * prose between them, `at minimum, and`, as a quoted rule. Two lenses then "shared a literal" that
 * neither of them quoted.
 */
export function pairedSpans(text: string, ch: string): string[] {
  const at: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ch) continue
    // An English possessive or contraction is not a quote delimiter. Pairing them made
    // `plan's task table and each task's writablePaths` yield the "literal"
    // "s task table and each task", which two otherwise-unrelated lenses then shared.
    if (ch === "'" && /[A-Za-z]/.test(text[i - 1] ?? '') && /[A-Za-z]/.test(text[i + 1] ?? '')) continue
    at.push(i)
  }
  const out: string[] = []
  for (let i = 0; i + 1 < at.length; i += 2) out.push(text.slice(at[i] + 1, at[i + 1]))
  return out
}

export function quotedLiterals(prompt: string): string[] {
  const out = new Set<string>()
  const add = (s: string) => {
    const t = s.trim()
    if (t.length < 8 || !/\s/.test(t) || /^[A-Z_]+$/.test(t)) return
    // A markdown heading or a path is shared VOCABULARY, not a claim: teaching's notes and slides
    // lenses both cite the plan's `## Lectures In Scope` table and judge entirely different things.
    // The defect this rule is named for is a shipped PATTERN quoted twice, e.g. 'The answer:'.
    if (/^#{1,6}\s/.test(t) || /^[.~/]?[\w.-]+\//.test(t)) return
    out.add(t)
  }
  for (const s of pairedSpans(prompt, "'")) add(s)
  for (const s of pairedSpans(prompt, '`')) add(s)
  for (const m of prompt.matchAll(/\\"([^"]{8,}?)\\"/g)) add(m[1])
  return [...out]
}

/** Label-shaped entries of a suppression/exemption list in a checker. */
export function suppressionEntries(text: string): { name: string; entry: string; line: number }[] {
  const out: { name: string; entry: string; line: number }[] = []
  const re = /(?:const|let|var)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=\s*\[([^\]]*)\]/g
  for (const m of text.matchAll(re)) {
    const name = m[1]
    if (!/(SUPPRESS|EXEMPT|IGNORE|PREFIX)/i.test(name)) continue
    if (/(DIR|EXT|LANG)/i.test(name)) continue
    const found: { name: string; entry: string; line: number }[] = []
    for (const e of m[2].matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const entry = e[2]
      // Label-shaped only. A bare name is not a label suppression; see SCOPE in the header.
      if (!entry.includes('/')) continue
      found.push({ name, entry, line: lineOf(text, (m.index ?? 0) + (e.index ?? 0)) })
    }
    // A list whose every entry is a bare DIRECTORY prefix suppresses paths, not labels — e.g.
    // validate-skill-paths.ts's USER_PROJECT_PREFIXES (".planning/", "drafts/", …), which exist in
    // the consumer's project and never name a rule this plugin emits. Matching no label is the
    // CORRECT state for such a list, so I5 must not ask it the question at all; before this it
    // could only decline, reporting one permanent NOT CHECKED that never went away.
    if (found.length && found.every(f => f.entry.endsWith('/'))) continue
    out.push(...found)
  }
  return out
}

/**
 * Path literals a Python module COMPUTES from `__file__`, with the file they resolve to.
 *
 * `Path(__file__).resolve().parents[2] / "scripts" / "prose-audit.py"` — the exact shape of the I4
 * defect. `.parent` counts one level, `parents[N]` counts N, `.resolve()` counts none.
 */
export function computedPaths(file: string, text: string): { raw: string; resolved: string; line: number }[] {
  const out: { raw: string; resolved: string; line: number }[] = []
  const re =
    /Path\(\s*__file__\s*\)((?:\s*\.\s*(?:resolve\(\)|absolute\(\)|parents\[\d+\]|parent))+)((?:\s*\/\s*(?:"[^"]*"|'[^']*'))+)/g
  for (const m of text.matchAll(re)) {
    // `parents[N]` is N+1 directories up from the FILE — `parents[0]` is what `.parent` returns.
    // Reading it as N is the off-by-one that makes a correct `parents[3]` look broken.
    let up = 0
    for (const step of m[1].matchAll(/parents\[(\d+)\]|parent\b/g)) up += step[1] ? Number(step[1]) + 1 : 1
    let base = file
    for (let i = 0; i < up; i++) base = dirname(base)
    const segs = [...m[2].matchAll(/["']([^"']*)["']/g)].map(s => s[1])
    out.push({ raw: m[0].replace(/\s+/g, ' '), resolved: resolve(base, ...segs), line: lineOf(text, m.index ?? 0) })
  }
  // The TS/JS counterpart, same shape, same failure mode.
  const jsRe = /join\(\s*(?:import\.meta\.dir|__dirname)\s*,((?:\s*(?:"[^"]*"|'[^']*')\s*,?)+)\)/g
  for (const m of text.matchAll(jsRe)) {
    const segs = [...m[1].matchAll(/["']([^"']*)["']/g)].map(s => s[1])
    if (segs.length === 0) continue
    out.push({ raw: m[0].replace(/\s+/g, ' '), resolved: resolve(dirname(file), ...segs), line: lineOf(text, m.index ?? 0) })
  }
  return out
}

/** Phrases the corpus recorded as HUMAN, from a `tics.yaml`'s `rejected:` block. */
export function parseRejectedPhrases(yaml: string): string[] {
  const out = new Set<string>()
  const idx = yaml.search(/^rejected\s*:/m)
  if (idx === -1) return []
  // From the line AFTER `rejected:` to the next top-level key. Slicing from `idx` and then
  // searching the remainder for a top-level key finds `rejected:` itself and yields an empty block —
  // an I7 that reads as "no rejected phrases" rather than as "not parsed".
  const nl = yaml.indexOf('\n', idx)
  const body = nl === -1 ? '' : yaml.slice(nl + 1)
  const stop = body.search(/^[A-Za-z_]+\s*:/m)
  const block = stop === -1 ? body : body.slice(0, stop)
  for (const m of block.matchAll(/label\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    const label = m[1].replace(/\\"/g, '"')
    for (const q of label.matchAll(/'([^']+)'/g)) {
      const phrase = q[1].trim()
      if (phrase.length >= 4) out.add(phrase)
    }
  }
  return [...out]
}

// ---------------------------------------------------------------- exemptions

/**
 * The marker grammar. Whole trimmed line only — substring matching would make this very file exempt
 * the moment it spelled the marker out, which is the undeclared suppression the mechanism exists to
 * prevent. The rule-name alphabet is WIDER than the legal names on purpose: a name that never parses
 * is invisible in both channels, so anything name-shaped is parsed here and rejected by I11.
 */
const EXEMPT_LINE_RE = /^(?:\/\/|#|\*)?\s*<!--\s*pc-probe:\s*ignore-([A-Za-z0-9][A-Za-z0-9_.-]*)\s*-->$/

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(\S*)/

/**
 * The rules a marker may name — the set actually HONOURED, not the set that exists. A name outside
 * it suppresses nothing while reading exactly like a suppression that works.
 */
export const KNOWN_EXEMPTION_RULES: readonly string[] = ['two-representations']

/** The 1-based lines of `text` on which a declaration COUNTS. In Markdown, a marker inside a fenced
 *  or four-space-indented block is an example, not a declaration. */
export function declarableLines(file: string, text: string): number[] {
  const lines = text.split('\n')
  const markdown = MARKDOWN_EXT_RE.test(file)
  const out: number[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    if (markdown) {
      const f = FENCE_RE.exec(lines[i])
      if (fence === null) {
        if (f) {
          fence = f[2]
          continue
        }
      } else {
        if (f && f[2][0] === fence[0] && f[2].length >= fence.length && f[3] === '') fence = null
        continue
      }
      if (/^ {4}|^\t/.test(lines[i])) continue
    }
    out.push(i + 1)
  }
  return out
}

export function parseExemptions(file: string, text: string): Exemption[] {
  const lines = text.split('\n')
  const out: Exemption[] = []
  for (const lineNo of declarableLines(file, text)) {
    const m = EXEMPT_LINE_RE.exec(lines[lineNo - 1].trim())
    if (m) out.push({ rule: m[1], file, line: lineNo })
  }
  return out
}

/** I11: a marker naming a rule nothing honours is a finding, not a suppression. */
export function checkExemptionVocabulary(exemptions: readonly Exemption[]): Finding[] {
  return exemptions
    .filter(e => !KNOWN_EXEMPTION_RULES.includes(e.rule))
    .map(e => ({
      rule: 'I11 exemption vocabulary',
      severity: 'major' as const,
      file: e.file,
      line: e.line,
      detail: `the marker "ignore-${e.rule}" names a rule no predicate honours, so it suppresses nothing`,
      remedy: `use one of: ${KNOWN_EXEMPTION_RULES.join(', ')} — a marker that reads as a suppression and is not one hides a failing check twice over`,
    }))
}

// ---------------------------------------------------------------- checker shape

/**
 * Does this module expose the checker contract a discovery runner dispatches on?
 *
 * A module-level `def check(<one parameter>)`, or an `APPLIES_TO` declaration (the key workflows'
 * `run-constraints.py` reads), or the full check-all contract. See SCOPE for why one parameter.
 */
export function hasCheckerContract(text: string): boolean {
  if (hasModuleContract(text)) return true
  if (/^\s*APPLIES_TO\s*(?::[^=\n]*)?=/m.test(text)) return true
  return /^def\s+check\s*\(\s*[A-Za-z_]\w*(?:\s*:[^,()=]*)?\s*\)/m.test(text)
}

/** Does this markdown carry an `applies-to:` key in its FRONTMATTER (not merely in its body)? */
export function hasAppliesTo(text: string): boolean {
  if (!/^---\s*\n/.test(text)) return false
  const end = text.indexOf('\n---', 3)
  if (end === -1) return false
  return /^applies-to\s*:/m.test(text.slice(0, end))
}

/**
 * Directory anchors a runner computes from `__file__`, by variable name.
 *
 * `constraints_dir = os.path.dirname(os.path.abspath(__file__))`, `_plugin_constraints_dir =
 * Path(__file__).parent`, `_repo_root = Path(__file__).resolve().parent.parent` and the one level of
 * indirection the corpus needs, `skills_dir = _repo_root / "skills"`. Nothing else: a glob whose
 * anchor this probe cannot follow yields no enumerated directory, which can only ADD an I9 finding a
 * human dismisses — never hide one.
 */
export function globAnchors(runner: string, code: string): Map<string, string> {
  const self = dirname(runner)
  const out = new Map<string, string>([['__self__', self]])
  for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*os\.path\.dirname\(\s*(?:os\.path\.abspath\(\s*)?__file__/gm)) {
    out.set(m[1], self)
  }
  for (const m of code.matchAll(
    /^\s*([A-Za-z_]\w*)\s*=\s*Path\(\s*__file__\s*\)((?:\s*\.\s*(?:resolve\(\)|absolute\(\)|parents\[\d+\]|parent))+)((?:\s*\/\s*(?:"[^"]*"|'[^']*'))*)/gm,
  )) {
    let up = 0
    for (const step of m[2].matchAll(/parents\[(\d+)\]|parent\b/g)) up += step[1] ? Number(step[1]) + 1 : 1
    let base = runner
    for (let i = 0; i < up; i++) base = dirname(base)
    const segs = [...m[3].matchAll(/["']([^"']*)["']/g)].map(s => s[1])
    out.set(m[1], resolve(base, ...segs))
  }
  // One level of indirection: `NAME = OTHER / "seg"`, resolved against the anchors above.
  for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*((?:\/\s*(?:"[^"]*"|'[^']*')\s*)+)/gm)) {
    const base = out.get(m[2])
    if (!base) continue
    const segs = [...m[3].matchAll(/["']([^"']*)["']/g)].map(s => s[1])
    out.set(m[1], resolve(base, ...segs))
  }
  return out
}

/** Existing directories matching `segments` (each possibly holding `*`) under `base`. */
function expandDirs(base: string, segments: string[]): string[] {
  if (segments.length === 0) return existsSync(base) && statSync(base).isDirectory() ? [base] : []
  const [head, ...rest] = segments
  if (!head || head === '.') return expandDirs(base, rest)
  if (!head.includes('*')) return expandDirs(join(base, head), rest)
  const quoted = head.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp('^' + quoted.join('[^/]*') + '$')
  let entries: string[]
  try {
    entries = readdirSync(base)
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) if (re.test(e)) out.push(...expandDirs(join(base, e), rest))
  return out
}

/**
 * The directories `runner` ENUMERATES, derived from its glob patterns and its `__file__` anchors.
 *
 * A pattern with no directory part (`*.py`) is anchored at the runner's own directory — that is
 * where `glob.glob(os.path.join(constraints_dir, "*.py"))` points. A pattern that names directories
 * (a star segment followed by `constraints`) is tried against every anchor and kept where it
 * expands to a real directory.
 */
export function enumeratedDirsOf(runner: string, code: string, extraAnchors: readonly string[] = []): string[] {
  const anchors = globAnchors(runner, code)
  // A cwd-relative pattern — `glob.glob("constraints/*.py")` — is anchored wherever the runner is
  // invoked from, which this process cannot know. The plugin root is the plausible cwd, and counting
  // its expansion as enumerated can only SILENCE an I9, never invent one.
  for (const a of extraAnchors) anchors.set(`__extra:${a}`, a)
  const self = dirname(runner)
  const out = new Set<string>()
  for (const m of code.matchAll(/["']([^"'\n]*\*[^"'\n]*)["']/g)) {
    const pattern = m[1]
    if (pattern.startsWith('/') || pattern.includes('**')) continue
    const segs = pattern.split('/').filter(s => s !== '')
    if (segs.length === 0) continue
    // A trailing `*.ext` names FILES; the directory enumerated is what precedes it.
    const last = segs[segs.length - 1]
    const dirSegs = /\.[A-Za-z0-9]+$/.test(last) ? segs.slice(0, -1) : segs
    // A directory part that is nothing but wildcards (`*`, `*/*`) IDENTIFIES no directory, so it is
    // read only against the runner's own — a runner globbing `*` in its own directory. Cross-
    // producting it with every anchor expanded the plugin root into all 23 of its top-level
    // directories, which then read as checker directories and drew 25 I10 findings on correct prose.
    const named = dirSegs.some(s => s.replace(/\*/g, '') !== '')
    const bases = dirSegs.length === 0 || !named ? [self] : [...anchors.values()]
    // Filtered through SKIP_DIRS: a `__pycache__` the walk never scans is not a checker directory,
    // and reporting one as enumerated would describe coverage the probe does not have.
    for (const b of bases) for (const d of expandDirs(b, dirSegs)) if (!SKIP_DIRS.has(basename(d))) out.add(d)
  }
  return [...out]
}

/**
 * Module stems a runner deliberately keeps OUT of its import path.
 *
 * typst names them in `CLI_CHECKERS`; workflows passes `exclude_names={"check-all"}`. Read from the
 * runner because the list is the runner's, and a hardcoded copy here would go stale silently — the
 * exact failure I5 is named after.
 */
export function runnerExclusions(code: string): string[] {
  const out = new Set<string>()
  const take = (body: string) => {
    for (const s of body.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const v = s[2].trim()
      if (v) out.add(v.replace(/\.py$/, ''))
    }
  }
  for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*(?::[^=\n]*)?=\s*[[({]([^\])}]*)[\])}]/gm)) {
    if (!/(CLI|EXCLUDE|EXCLUDED|SKIP|EXEMPT|IGNORE|NOT_)/i.test(m[1])) continue
    take(m[2])
  }
  for (const m of code.matchAll(/exclude_names\s*=\s*[[({]([^\])}]*)[\])}]/g)) take(m[1])
  return [...out]
}

// ---------------------------------------------------------------- predicates

/** I1(a): two modules declaring the same CONSTRAINT. I1(b): two checkers over one pattern table. */
export function checkSingleEngine(
  engines: readonly Engine[],
  tables: readonly PatternTable[],
  consumersOf: Map<string, string[]>,
  delegates: (a: string, b: string) => boolean,
  target: string,
): Finding[] {
  const findings: Finding[] = []

  const byConstraint = new Map<string, Engine[]>()
  for (const e of engines) {
    if (!e.constraint) continue
    const list = byConstraint.get(e.constraint) ?? []
    list.push(e)
    byConstraint.set(e.constraint, list)
  }
  for (const [c, list] of [...byConstraint].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length < 2) continue
    findings.push({
      rule: 'I1 one engine per domain',
      severity: 'major',
      file: list[1].file,
      detail: `${list.length} modules declare CONSTRAINT "${c}": ${list.map(e => relative(target, e.file)).join(', ')}`,
      remedy:
        'one rule, one implementation — delete the duplicate or make it delegate to the survivor. Two encodings of one constraint drift, and the one that fires is whichever the runner reaches first',
    })
  }

  const reported = new Set<string>()
  for (const t of [...tables].sort((a, b) => a.file.localeCompare(b.file))) {
    const cs = (consumersOf.get(t.file) ?? []).slice().sort()
    if (cs.length < 2) continue
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        if (delegates(cs[i], cs[j]) || delegates(cs[j], cs[i])) continue
        const pair = `${cs[i]}|${cs[j]}`
        if (reported.has(pair)) continue
        reported.add(pair)
        findings.push({
          rule: 'I1 one engine per domain',
          severity: 'major',
          file: cs[j],
          detail: `two engines consume the pattern table ${relative(target, t.file)} without either delegating to the other: ${relative(target, cs[i])} and ${relative(target, cs[j])}`,
          remedy:
            'keep one engine over the domain and have the other spawn or import it — two engines over one table means two gatings, two severities and two chances for one of them to go quietly wrong',
        })
      }
    }
  }
  return findings
}

/** I2: two lenses quoting the same literal make the same claim twice. */
export function checkSingleLens(lenses: readonly Lens[], target: string): Finding[] {
  // Grouped case-insensitively, REPORTED as written: a finding that renames the literal it found
  // costs the reader the grep that would confirm it.
  //
  // TWO LENSES MAKE ONE CLAIM TWICE ONLY IF THEY JUDGE THE SAME SUBJECT. Identical prompt text over
  // DIFFERENT `refs` is FAN-OUT — one rule applied per subject, not a rival: exams dispatches
  // source-fidelity-01/02/03, whose prompts differ only in a question number, over three separate
  // question files. Cross-skill pairs stay in scope deliberately (the F1 defect was one).
  const byLiteral = new Map<string, { shown: string; lenses: Lens[] }>()
  for (const l of lenses) {
    for (const lit of quotedLiterals(l.prompt)) {
      const key = `${l.refs}\u0000${lit.toLowerCase().replace(/\s+/g, ' ')}`
      const slot = byLiteral.get(key) ?? { shown: lit, lenses: [] }
      if (!slot.lenses.some(x => x.file === l.file && x.key === l.key)) slot.lenses.push(l)
      byLiteral.set(key, slot)
    }
  }
  const findings: Finding[] = []
  const reported = new Set<string>()
  for (const [, slot] of [...byLiteral].sort((a, b) => a[0].localeCompare(b[0]))) {
    const list = slot.lenses
    if (list.length < 2) continue
    const pair = list.map(l => `${l.file}#${l.key}`).sort().join('|')
    if (reported.has(pair)) continue
    reported.add(pair)
    findings.push({
      rule: 'I2 one lens per domain',
      severity: 'major',
      file: list[1].file,
      line: list[1].line,
      detail: `lenses ${list.map(l => `"${l.key}" (${relative(target, l.file)})`).join(' and ')} both quote ${JSON.stringify(slot.shown)} — one claim, two lenses`,
      remedy:
        'one lens owns the claim; the other routes to it. Two lenses over one literal report it at two severities with no key joining them, and each surviving finding costs a refuter agent',
    })
  }
  return findings
}

/** I3: an engine with no live caller. */
export function checkEngineCallers(
  engines: readonly Engine[],
  callersOf: Map<string, string[]>,
  discoveryRunners: readonly string[],
  target: string,
): Finding[] {
  const findings: Finding[] = []
  for (const e of [...engines].sort((a, b) => a.file.localeCompare(b.file))) {
    if ((callersOf.get(e.file) ?? []).length > 0) continue
    // A contract module is registered BY ITS CONTRACT: check-all-style runners discover it by glob,
    // so there is no literal path to find. It is called iff such a runner exists.
    if (e.via.includes('contract') && discoveryRunners.length > 0) continue
    findings.push({
      rule: 'I3 every engine has a live caller',
      severity: 'major',
      file: e.file,
      detail:
        `${relative(target, e.file)} is identified as an engine (via ${e.via.join('+')}) and nothing in this plugin invokes it` +
        (e.via.includes('contract') ? ' — and no discovery runner reads APPLIES_TO, so its contract registers it with nobody' : ''),
      remedy:
        'wire it or delete it. A comment, a CHANGELOG line, a doc or a test that names it is not a caller, and an engine nobody runs reads exactly like an engine that passes',
    })
  }
  return findings
}

/** I4: a path a checker computes to reach another file must resolve. */
export function checkComputedPaths(checkers: readonly string[], textOf: Map<string, string>): Finding[] {
  const findings: Finding[] = []
  for (const f of [...checkers].sort()) {
    const text = textOf.get(f)
    if (text === undefined) continue
    // The RAW text, not the code view: a computed path inside a docstring is still the path the
    // module will import when someone uncomments it, and blanking comments here would only hide the
    // half of the defect that is easiest to fix.
    for (const p of computedPaths(f, text)) {
      if (existsSync(p.resolved)) continue
      findings.push({
        rule: 'I4 a computed path must resolve',
        severity: 'critical',
        file: f,
        line: p.line,
        detail: `${p.raw} resolves to ${p.resolved}, which does not exist`,
        remedy:
          'fix the level count. A computed path that misses raises inside the checker, and a bare except turns that into a constraint filed under passed',
      })
    }
  }
  return findings
}

/** I5: a suppression entry that matches no live label. */
export function checkSuppressionLists(
  entries: readonly { file: string; name: string; entry: string; line: number }[],
  labels: readonly string[],
  unresolved: UnresolvedRef[] = [],
): Finding[] {
  const findings: Finding[] = []
  const matches = (entry: string) => labels.some(l => l === entry || l.startsWith(entry))
  // A list is ABOUT checker labels only when at least one of its entries still matches one. A list
  // where none does is more likely a list of something else — `USER_PROJECT_PREFIXES` names the
  // user's `drafts/`, `data/`, `logs/` — and calling every entry dead would bury the real finding
  // under six that are not. The ambiguity is declared rather than resolved by guess.
  const byList = new Map<string, typeof entries[number][]>()
  for (const e of entries) {
    const k = `${e.file}#${e.name}`
    byList.set(k, [...(byList.get(k) ?? []), e])
  }
  for (const [, list] of byList) {
    if (list.some(e => matches(e.entry))) continue
    unresolved.push({
      rule: 'I5 suppression vocabulary',
      file: list[0].file,
      line: list[0].line,
      token: list[0].name,
      reason:
        'no entry in this list matches any label this plugin can emit, so the probe could not establish that it is a label suppression at all — I5 did NOT run on it',
    })
  }
  const ambiguous = new Set([...byList].filter(([, l]) => !l.some(e => matches(e.entry))).map(([k]) => k))
  for (const e of entries) {
    if (ambiguous.has(`${e.file}#${e.name}`)) continue
    if (matches(e.entry)) continue
    findings.push({
      rule: 'I5 a suppression entry must match a live label',
      severity: 'major',
      file: e.file,
      line: e.line,
      detail: `${e.name} carries ${JSON.stringify(e.entry)}, which matches none of the ${labels.length} labels this plugin's checkers can emit`,
      remedy:
        'repoint or delete the entry. A suppression that matches nothing is not inert — whatever it used to cover is now reported twice, and the entry still reads as if it were handled',
    })
  }
  return findings
}

/** I6: a lens prompt quoting a literal an in-domain pattern table already decides. */
export function checkLensLiteralInTable(
  lenses: readonly Lens[],
  tables: readonly PatternTable[],
  textOf: Map<string, string>,
  target: string,
): Finding[] {
  const findings: Finding[] = []
  for (const l of lenses) {
    for (const lit of quotedLiterals(l.prompt)) {
      for (const t of tables) {
        // In-domain: the same skill, or a plugin-level table that serves every skill.
        if (t.skill !== null && t.skill !== l.skill) continue
        const text = textOf.get(t.file) ?? ''
        if (!text.toLowerCase().includes(lit.toLowerCase())) continue
        findings.push({
          rule: 'I6 a lens may not restate a decided rule',
          severity: 'major',
          file: l.file,
          line: l.line,
          detail: `lens "${l.key}" quotes ${JSON.stringify(lit)}, which ${relative(target, t.file)} already decides deterministically`,
          remedy:
            'narrow the lens to the undecidable residue and point it at the table through refs. A lens carries routing and scope, never a rule the engine beside it already matches',
        })
      }
    }
  }
  return findings
}

/** I7 (ADVISORY): a shipped pattern that fires on a phrase the corpus recorded as human. */
export function checkCorpusRejected(
  tables: readonly PatternTable[],
  phrases: readonly string[],
  unresolved: UnresolvedRef[],
): Advisory[] {
  const out: Advisory[] = []
  for (const t of tables) {
    for (const rx of t.regexes) {
      let re: RegExp
      try {
        re = new RegExp(translatePyRegex(rx.source), 'i')
      } catch (err) {
        unresolved.push({
          rule: 'I7 corpus standing',
          file: t.file,
          line: rx.line,
          token: rx.source.slice(0, 80),
          reason: `the pattern does not compile here (${(err as Error).message}), so its corpus standing was NOT checked`,
        })
        continue
      }
      for (const p of phrases) {
        let hit: RegExpExecArray | null = null
        try {
          hit = re.exec(p)
        } catch {
          hit = null
        }
        // The pattern must fire on the PHRASE, not on a word inside it. A broad table entry like
        // `\w+ process` or a passive-voice regex matches a fragment of half the rejected list, and
        // reporting those buries the six real collisions under fifteen thousand.
        if (!hit || hit[0].length < 8 || hit[0].length < 0.6 * p.length) continue
        out.push({
          rule: 'I7 corpus standing (advisory)',
          file: t.file,
          line: rx.line,
          detail: `pattern /${rx.source}/ fires on ${JSON.stringify(p)}, which the corpus dictionary lists under rejected: (recorded as human writing)`,
        })
      }
    }
  }
  return out
}

/**
 * I8: a `<stem>.md` beside a `<stem>.py` in one checker directory — a rule stated twice.
 *
 * The corpus writes the markdown as `typst-<stem>.md`, so that prefix is stripped before pairing.
 * The finding points at the `.md`, because the script is what decides the rule and the prose is the
 * copy that rots. A declared `two-representations` exemption in EITHER member suppresses it, and is
 * recorded in `applied` so the CLI can print it.
 */
export function checkTwoRepresentations(
  checkerDirs: readonly string[],
  filesByDir: Map<string, string[]>,
  exemptionsOf: Map<string, Exemption[]>,
  target: string,
  applied: Exemption[] = [],
): Finding[] {
  const findings: Finding[] = []
  for (const dir of [...checkerDirs].sort()) {
    const files = filesByDir.get(dir) ?? []
    const py = new Map<string, string>()
    for (const f of files) if (extname(f) === '.py') py.set(basename(f, '.py'), f)
    for (const f of files.slice().sort()) {
      if (!MARKDOWN_EXT_RE.test(f)) continue
      const stem = basename(f).replace(MARKDOWN_EXT_RE, '')
      const script = py.get(stem) ?? py.get(stem.replace(/^typst-/, ''))
      if (!script) continue
      const exempt = [...(exemptionsOf.get(f) ?? []), ...(exemptionsOf.get(script) ?? [])].filter(
        e => e.rule === 'two-representations',
      )
      if (exempt.length) {
        applied.push(...exempt)
        continue
      }
      findings.push({
        rule: 'I8 one rule, one representation',
        severity: 'major',
        file: f,
        detail: `${relative(target, f)} states in prose what ${relative(target, script)} decides in code — one rule, two representations`,
        remedy:
          'a CONSTRAINT is code and needs no parallel .md; delete the markdown, or, if it carries the only written rationale for the checker, declare that with a pc-probe ignore-two-representations marker naming why',
      })
    }
  }
  return findings
}

/**
 * I9: a checker outside every discovery runner's enumerated directory.
 *
 * Silent when there is no discovery runner at all — I3 already reports those modules as uncalled —
 * and silent on a stem some runner's own exclusion list names, which is a CLI checker held out of
 * the import path on purpose.
 */
export function checkCheckerReach(
  contractFiles: readonly string[],
  enumerated: readonly string[],
  exclusions: readonly string[],
  runnerCount: number,
  target: string,
): Finding[] {
  if (runnerCount === 0) return []
  const dirs = new Set(enumerated)
  const excluded = new Set(exclusions)
  const findings: Finding[] = []
  for (const f of [...contractFiles].sort()) {
    if (dirs.has(dirname(f))) continue
    if (excluded.has(basename(f, '.py'))) continue
    findings.push({
      rule: 'I9 a checker must be reachable',
      severity: 'major',
      file: f,
      detail: `${relative(target, f)} exposes the checker contract and sits outside every directory this plugin's ${runnerCount} discovery runner(s) enumerate — nothing discovers it`,
      remedy:
        'move it into an enumerated checker directory, or widen the runner that should find it. A checker reached only because someone wrote its name down is one rename from silence, with nothing to report the silence',
    })
  }
  return findings
}

/** I10: a rule in a checker directory with no `applies-to:` frontmatter is scoped to nothing. */
export function checkRuleScope(
  checkerDirs: readonly string[],
  filesByDir: Map<string, string[]>,
  textOf: Map<string, string>,
  target: string,
): Finding[] {
  const findings: Finding[] = []
  for (const dir of [...checkerDirs].sort()) {
    for (const f of (filesByDir.get(dir) ?? []).slice().sort()) {
      if (!MARKDOWN_EXT_RE.test(f)) continue
      const text = textOf.get(f)
      if (text === undefined || hasAppliesTo(text)) continue
      findings.push({
        rule: 'I10 a rule must declare its scope',
        severity: 'major',
        file: f,
        detail: `${relative(target, f)} sits in a checker directory and declares no applies-to: frontmatter, so it is in scope for zero workflows`,
        remedy:
          'add applies-to: naming the workflows it governs, or move it out of the checker directory. load-constraints refuses it at load time; here it still reads as a live rule',
      })
    }
  }
  return findings
}

/**
 * I12: the rules/constraints split is PHYSICAL, not conventional.
 *
 * Three findings, all decidable from the filesystem alone:
 *
 *   a. a stem present in BOTH `<base>/rules/` and `<base>/constraints/` — the invariant. Sibling
 *      directories of one base, so a plugin root and each skill are judged separately and a
 *      `skills/exams/rules/x.md` never collides with a root `constraints/x.py`.
 *   b. a `.md` under `constraints/` — prose in a directory a runner globs for code.
 *   c. a `.py` under `rules/` — code in a directory nothing executes.
 *
 * The invariant I8 could not carry: I8 pairs files SIDE BY SIDE in one checker directory, so the
 * moment the corpus splits into two directories every pair leaves its jurisdiction and I8 reads
 * clean over a corpus that still states each rule twice. This is why the split had to be made
 * physical rather than remembered — a convention with nothing computing it is how the 14 pairs
 * accumulated while the doctrine read as enforced.
 *
 * A rule that shares a SUBJECT with a checker settling only part of it is not two representations;
 * it is named for the judgement it carries and says what the checker decides. That rename is what
 * clears (a), and it is a rename, not a deletion — the prose survives.
 */
export function checkSplitInvariant(
  files: readonly string[],
  target: string,
): Finding[] {
  const rules = new Map<string, Map<string, string>>() // base -> stem -> path
  const consts = new Map<string, Map<string, string>>()
  const findings: Finding[] = []

  for (const f of [...files].sort()) {
    const d = dirname(f)
    const kind = basename(d)
    if (kind !== 'rules' && kind !== 'constraints') continue
    const base = dirname(d)
    const stem = basename(f).replace(/\.(md|markdown|py)$/i, '')
    const bucket = kind === 'rules' ? rules : consts
    if (!bucket.has(base)) bucket.set(base, new Map())
    if (kind === 'rules' && MARKDOWN_EXT_RE.test(f)) bucket.get(base)!.set(stem, f)
    if (kind === 'constraints' && extname(f) === '.py') bucket.get(base)!.set(stem, f)

    if (kind === 'constraints' && MARKDOWN_EXT_RE.test(f)) {
      findings.push({
        rule: 'I12 the split is physical',
        severity: 'major',
        file: f,
        detail: `${relative(target, f)} is prose in a constraints/ directory — a runner globs that directory for code, and nothing there reads markdown`,
        remedy:
          'move it to the sibling rules/ directory if it is a rule a model must judge, or out of both if it is a record rather than a rule',
      })
    }
    if (kind === 'rules' && extname(f) === '.py') {
      findings.push({
        rule: 'I12 the split is physical',
        severity: 'major',
        file: f,
        detail: `${relative(target, f)} is code in a rules/ directory — nothing globs rules/ for execution, so this checker runs for nobody`,
        remedy: 'move it to the sibling constraints/ directory, where a runner enumerates it',
      })
    }
  }

  for (const [base, stems] of [...rules].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const beside = consts.get(base)
    if (!beside) continue
    for (const [stem, mdPath] of [...stems].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const pyPath = beside.get(stem)
      if (!pyPath) continue
      findings.push({
        rule: 'I12 the split is physical',
        severity: 'major',
        file: mdPath,
        detail: `${relative(target, mdPath)} and ${relative(target, pyPath)} share a stem — one fact in two representations, and the agent reads whichever one went stale`,
        remedy:
          'a constraint needs no rule: the checker runs and its finding IS the statement. Delete the prose, or re-home its rationale in the checker\'s module docstring. If the prose is really about something the checker does NOT decide, name it for that judgement and open it by saying what the checker covers',
      })
    }
  }
  return findings
}

/** The Python-regex constructs JS does not share, rewritten where the rewrite is exact. */
export function translatePyRegex(src: string): string {
  return src
    .replace(/\(\?([imsxu]+)\)/g, '') // inline flag groups: handled by the 'i' we pass
    .replace(/\(\?P<[^>]+>/g, '(')
    .replace(/\(\?P=([A-Za-z_]\w*)/g, '(?:\\k<$1>')
}

// ---------------------------------------------------------------- driver

export interface ProbeOptions {
  /** An explicit corpus dictionary. When given and unreadable, I7 reports NOT CHECKED — it does not
   *  silently fall back, because a fallback to a different corpus is a different answer. */
  corpus?: string | null
}

export function runProbe(target: string, opts: ProbeOptions = {}): ProbeResult {
  const root = resolve(target)
  const findings: Finding[] = []
  const unresolvedRefs: UnresolvedRef[] = []
  const dirsSkipped: string[] = []
  const filesSkipped: string[] = []

  const all = collectFiles(root, [], dirsSkipped)
  const eligible = all.filter(f => SOURCE_EXT_RE.test(f))
  const textOf = new Map<string, string>()
  const codeOf = new Map<string, string>()
  for (const f of eligible) {
    const t = readTextOrNull(f)
    if (t === null) {
      filesSkipped.push(f)
      continue
    }
    textOf.set(f, t)
    codeOf.set(f, codeView(f, t))
  }

  // ---- derive lenses, tables, engines
  const lenses: Lens[] = []
  const tables: PatternTable[] = []
  const mechanical = new Set<string>()
  for (const [f, text] of textOf) {
    if (basename(f) === 'SKILL.md') {
      lenses.push(...parseLenses(f, text, root))
      for (const p of parseMechanicalChecks(f, text, root)) mechanical.add(p)
    }
    const t = parsePatternTable(f, text, root)
    if (t) tables.push(t)
  }
  const registered = new Set(parseHookRegistry(root))

  const engineMap = new Map<string, Engine>()
  const noteEngine = (f: string, via: Engine['via'][number]) => {
    const e = engineMap.get(f) ?? { file: f, via: [], constraint: constraintValue(textOf.get(f) ?? '') , skill: skillOf(f, root) }
    if (!e.via.includes(via)) e.via.push(via)
    engineMap.set(f, e)
  }
  for (const [f, text] of textOf) if (hasModuleContract(text)) noteEngine(f, 'contract')
  for (const f of mechanical) if (textOf.has(f)) noteEngine(f, 'mechanicalChecks')
  for (const f of registered) if (textOf.has(f)) noteEngine(f, 'hooks.json')
  let engines = [...engineMap.values()].sort((a, b) => a.file.localeCompare(b.file))

  // ---- callers (I3) and consumers (I1b)
  const isTestFile = (f: string) =>
    /(^|[.\/])test[s]?[./]/i.test(relative(root, f)) || /\.(test|spec)\.[^.]+$/i.test(f) || /^test_/.test(basename(f))
  const callersOf = new Map<string, string[]>()
  const consumersOf = new Map<string, string[]>()
  const spawns = new Map<string, Set<string>>()
  for (const e of engines) callersOf.set(e.file, [])
  for (const t of tables) consumersOf.set(t.file, [])
  const nameableFrom = (f: string) => !MARKDOWN_EXT_RE.test(f) || basename(f) === 'SKILL.md'
  for (const [f, code] of codeOf) {
    if (isTestFile(f)) continue
    const mine = new Set<string>()
    if (!nameableFrom(f)) {
      spawns.set(f, mine)
      continue
    }
    for (const e of engines) {
      if (e.file === f) continue
      if (code.includes(basename(e.file))) {
        callersOf.get(e.file)!.push(f)
        mine.add(e.file)
      }
    }
    for (const t of tables) {
      if (t.file === f) continue
      // A document or a cache naming a table is not consuming it. Only code reaches symbols.
      if (MARKDOWN_EXT_RE.test(f) || extname(f).toLowerCase() === '.json') continue
      if (!code.includes(basename(t.file))) continue
      // CONSUMING a table means reaching its symbols. Merely naming the file is a spawn, which is
      // delegation, and delegation is the exemption I1 grants.
      if (t.symbols.some(s => code.includes(s))) consumersOf.get(t.file)!.push(f)
      mine.add(t.file)
    }
    spawns.set(f, mine)
  }
  // hooks.json and mechanicalChecks are callers by construction.
  for (const f of registered) if (callersOf.has(f)) callersOf.get(f)!.push(join(root, 'hooks', 'hooks.json'))
  for (const f of mechanical) if (callersOf.has(f)) callersOf.get(f)!.push('mechanicalChecks')

  // A FOURTH derivation, and the one that makes I3 able to fire at all: a file that reaches a
  // pattern table's symbols is producing findings, whatever else registers it. Without it the
  // engine set was exactly the set of REGISTERED engines, every one of which has a caller by
  // construction — so I3 could not reach `prose-lint.py`, the defect it is named after.
  for (const [t, cs] of consumersOf) for (const c of cs) if (c !== t) noteEngine(c, 'table-consumer')
  engines = [...engineMap.values()].sort((a, b) => a.file.localeCompare(b.file))
  for (const e of engines) if (!callersOf.has(e.file)) callersOf.set(e.file, [])
  for (const [f, code] of codeOf) {
    if (isTestFile(f)) continue
    if (!nameableFrom(f)) continue
    for (const e of engines) {
      if (e.file === f) continue
      if (code.includes(basename(e.file)) && !callersOf.get(e.file)!.includes(f)) callersOf.get(e.file)!.push(f)
    }
  }
  for (const f of registered) if (callersOf.has(f) && !callersOf.get(f)!.length) callersOf.get(f)!.push(join(root, 'hooks', 'hooks.json'))
  for (const f of mechanical) if (callersOf.has(f) && !callersOf.get(f)!.length) callersOf.get(f)!.push('mechanicalChecks')

  const delegates = (a: string, b: string) => (spawns.get(a)?.has(b) ?? false)

  // A discovery runner ENUMERATES a checker directory and DISPATCHES on the module contract. Which
  // contract member it keys on is the runner's choice: workflows' run-constraints.py reads APPLIES_TO,
  // typst's globs constraints/*.py and dispatches on a callable `check`. Requiring APPLIES_TO
  // specifically reported all 36 of typst's live checkers as uncalled — the runner was right there.
  const discoveryRunners = [...codeOf]
    .filter(([f, code]) => {
      if (hasModuleContract(textOf.get(f) ?? '')) return false
      if (code.includes('APPLIES_TO')) return true
      const enumerates = /\bglob\b|\biterdir\b|\breaddirSync\b|\breaddir\b|\bscandir\b|\blistdir\b/.test(code)
      const dispatches = /\bSEVERITY\b|\bCONSTRAINT\b|["']check["']|\bcheck\(/.test(code)
      return enumerates && dispatches
    })
    .map(([f]) => f)

  // ---- labels a checker can emit (I5). Derived from where the checkers actually live.
  // The label forms a runner actually builds — `skills/<skill>/references/<stem>` and
  // `constraints/<stem>` — not every suffix of every path. Arbitrary suffixes invented labels like
  // `data/foo`, which made a list of the USER's project directories look like a label suppression.
  const labels = new Set<string>()
  for (const f of [...engineMap.keys(), ...tables.map(t => t.file)]) {
    const rel = relative(root, f).replace(/\\/g, '/')
    const noExt = rel.replace(/\.[^./]+$/, '')
    labels.add(noExt)
    labels.add(noExt.replace(/^references\//, ''))
    labels.add(basename(noExt))
  }
  const suppress: { file: string; name: string; entry: string; line: number }[] = []
  for (const e of engines) {
    const text = textOf.get(e.file)
    if (!text) continue
    for (const s of suppressionEntries(text)) suppress.push({ file: e.file, ...s })
  }

  // ---- run the predicates
  findings.push(...checkSingleEngine(engines, tables, consumersOf, delegates, root))
  findings.push(...checkSingleLens(lenses, root))
  findings.push(...checkEngineCallers(engines, callersOf, discoveryRunners, root))
  findings.push(...checkComputedPaths([...engineMap.keys(), ...tables.map(t => t.file)], textOf))
  findings.push(...checkSuppressionLists(suppress, [...labels], unresolvedRefs))
  findings.push(...checkLensLiteralInTable(lenses, tables, textOf, root))

  // ---- I8/I9/I10: the RULE vs CONSTRAINT distinction, over derived checker directories
  const exemptions: Exemption[] = []
  const exemptionsOf = new Map<string, Exemption[]>()
  for (const [f, text] of textOf) {
    const es = parseExemptions(f, text)
    if (es.length) exemptionsOf.set(f, es)
  }
  findings.push(...checkExemptionVocabulary([...exemptionsOf.values()].flat()))

  // TWO sets, and the difference is load-bearing. `enumerated` includes the directories a
  // cwd-relative glob would reach if the runner were invoked from the plugin root — an ASSUMPTION,
  // used only to keep I9 quiet where the probe cannot know the cwd. `derived` holds only what a
  // runner computes from its own `__file__`, and that is what I8 and I10 call a checker directory:
  // an assumed cwd must never promote a prose directory into one.
  const enumerated = new Set<string>()
  const derived = new Set<string>()
  const exclusions = new Set<string>()
  for (const r of discoveryRunners) {
    const code = codeOf.get(r) ?? ''
    for (const d of enumeratedDirsOf(r, code, [root])) enumerated.add(d)
    for (const d of enumeratedDirsOf(r, code)) derived.add(d)
    for (const x of runnerExclusions(code)) exclusions.add(x)
  }
  const contractFiles = [...textOf]
    .filter(([f, text]) => extname(f) === '.py' && !isTestFile(f) && hasCheckerContract(text))
    .map(([f]) => f)
  const filesByDir = new Map<string, string[]>()
  for (const f of all) {
    const d = dirname(f)
    filesByDir.set(d, [...(filesByDir.get(d) ?? []), f])
  }
  const checkerDirs = new Set<string>(contractFiles.map(f => dirname(f)))
  for (const d of derived) if (filesByDir.has(d)) checkerDirs.add(d)

  findings.push(...checkTwoRepresentations([...checkerDirs], filesByDir, exemptionsOf, root, exemptions))
  findings.push(...checkCheckerReach(contractFiles, [...enumerated], [...exclusions], discoveryRunners.length, root))
  findings.push(...checkRuleScope([...checkerDirs], filesByDir, textOf, root))
  // I12 judges DIRECTORY NAMES, not derived checker directories: the whole point is that a
  // rules/ directory holds no code for a runner to derive itself from, so deriving it would
  // make the invariant invisible on exactly the corpus it governs.
  findings.push(...checkSplitInvariant(all, root))

  // ---- I7, advisory, and loud when it cannot run
  let corpus: string | null = null
  const advisories: Advisory[] = []
  const wanted = opts.corpus === undefined ? findCorpus(root) : opts.corpus
  if (wanted && existsSync(wanted)) corpus = resolve(wanted)
  if (corpus === null) {
    unresolvedRefs.push({
      rule: 'I7 corpus standing',
      file: root,
      token: String(wanted ?? 'tics.yaml'),
      reason:
        'the corpus dictionary is not reachable from here, so no shipped pattern was checked for corpus standing — I7 did NOT run, which is not the same as passing',
    })
  } else {
    const yaml = readTextOrNull(corpus)
    if (yaml === null) {
      unresolvedRefs.push({
        rule: 'I7 corpus standing',
        file: corpus,
        token: corpus,
        reason: 'the corpus dictionary could not be read, so I7 did NOT run',
      })
      corpus = null
    } else {
      advisories.push(...checkCorpusRejected(tables, parseRejectedPhrases(yaml), unresolvedRefs))
    }
  }

  return {
    target: root,
    findings,
    advisories,
    unresolvedRefs,
    engines,
    lenses,
    tables,
    exemptions,
    checkerDirs: [...checkerDirs].map(d => relative(root, d) || '.').sort(),
    enumeratedDirs: [...enumerated].map(d => relative(root, d) || '.').sort(),
    corpus,
    filesEligible: eligible.length,
    filesScanned: textOf.size,
    filesSkipped,
    dirsSkipped,
  }
}

/** Where a corpus dictionary may be found without being told. Both locations are reported. */
export function findCorpus(root: string): string | null {
  const inTree = collectFiles(root).find(f => basename(f) === 'tics.yaml')
  if (inTree) return inTree
  const home = join(homedir(), '.claude', 'skills', 'ai-tic', 'linter', 'tics.yaml')
  return existsSync(home) ? home : null
}

// ---------------------------------------------------------------- CLI

export class ArgError extends Error {}
export class HelpRequested extends Error {}

export const USAGE = 'usage: pc-probe.ts --target <plugin-dir> [--corpus <tics.yaml>] [--json]'

export function parseArgs(argv: string[]): { target: string; json: boolean; corpus?: string | null } {
  let target: string | null = null
  let json = false
  let corpus: string | null | undefined = undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--target') {
      target = argv[++i] ?? null
      if (target === null || target.startsWith('--')) throw new ArgError('--target requires a directory path')
    } else if (a.startsWith('--target=')) target = a.slice('--target='.length)
    else if (a === '--corpus') {
      const v = argv[++i] ?? null
      if (v === null || v.startsWith('--')) throw new ArgError('--corpus requires a file path')
      corpus = v
    } else if (a.startsWith('--corpus=')) corpus = a.slice('--corpus='.length)
    else if (a === '-h' || a === '--help') throw new HelpRequested(USAGE)
    else throw new ArgError(`unknown argument ${JSON.stringify(a)} (${USAGE})`)
  }
  if (!target) throw new ArgError(`--target <plugin-dir> is required (${USAGE})`)
  let resolved = target
  if (resolved === '~') resolved = homedir()
  else if (resolved.startsWith('~/')) resolved = join(homedir(), resolved.slice(2))
  resolved = resolve(resolved)
  if (!existsSync(resolved)) throw new ArgError(`--target does not exist: ${resolved}`)
  let st
  try {
    st = statSync(resolved)
  } catch {
    throw new ArgError(`--target is not readable: ${resolved}`)
  }
  if (!st.isDirectory()) throw new ArgError(`--target is not a directory: ${resolved}`)
  return { target: resolved, json, corpus }
}

function notesFor(result: ProbeResult): string[] {
  const lines: string[] = []
  // Every applied exemption, on every run: a suppressed check nobody can see is indistinguishable
  // from a check that passed.
  for (const e of result.exemptions) {
    lines.push(`  note: SUPPRESSED rule "${e.rule}" by a declared exemption at ${e.file}:${e.line}`)
  }
  for (const u of result.unresolvedRefs) {
    lines.push(`  note: rule "${u.rule}" NOT CHECKED for ${JSON.stringify(u.token)} in ${u.file}${u.line ? `:${u.line}` : ''} — ${u.reason}`)
  }
  for (const a of result.advisories) {
    lines.push(`  advisory: ${a.rule} — ${a.file}${a.line ? `:${a.line}` : ''} — ${a.detail}`)
  }
  for (const f of result.filesSkipped) lines.push(`  note: NOT SCANNED (unreadable): ${f}`)
  for (const d of result.dirsSkipped) lines.push(`  note: NOT ENUMERATED (unreadable directory): ${d}`)
  return lines
}

function tailLine(result: ProbeResult): string {
  const bits = [`${result.findings.length} finding(s)`]
  if (result.advisories.length) bits.push(`${result.advisories.length} advisory (does not gate)`)
  if (result.unresolvedRefs.length) bits.push(`${result.unresolvedRefs.length} NOT CHECKED`)
  if (result.exemptions.length) bits.push(`${result.exemptions.length} SUPPRESSED`)
  return `pc-probe: END — ${bits.join(', ')} | ${result.engines.length} engine(s), ${result.lenses.length} lens(es), ${result.tables.length} table(s)`
}

export function formatText(result: ProbeResult): string {
  const lines: string[] = []
  const coverage = `${result.filesScanned} of ${result.filesEligible} eligible source files scanned`
  lines.push(
    result.findings.length === 0
      ? `pc-probe: CLEAN — ${coverage} under ${result.target}`
      : `pc-probe: ${result.findings.length} finding(s) — ${coverage} under ${result.target}`,
  )
  lines.push(...notesFor(result))
  for (const f of result.findings) {
    lines.push('')
    lines.push(`[${f.severity}] ${f.rule}`)
    lines.push(`  file:   ${f.file}${f.line ? `:${f.line}` : ''}`)
    lines.push(`  detail: ${f.detail}`)
    lines.push(`  remedy: ${f.remedy}`)
  }
  lines.push('')
  lines.push(tailLine(result))
  return lines.join('\n')
}

export function main(argv: string[], run: typeof runProbe = runProbe): number {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    if (e instanceof HelpRequested) {
      console.log(e.message)
      return 0
    }
    console.error(`pc-probe: ${(e as Error).message}`)
    return 2
  }
  let result: ProbeResult
  try {
    result = run(opts.target, opts.corpus === undefined ? {} : { corpus: opts.corpus })
  } catch (e) {
    // 3, not 2: the arguments were fine and the probe still did not run.
    console.error(`pc-probe: failed to probe ${opts.target}: ${(e as Error).message}`)
    return 3
  }
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatText(result))
  return result.findings.length > 0 ? 1 : 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
