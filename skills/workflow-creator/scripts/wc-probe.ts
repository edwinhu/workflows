#!/usr/bin/env bun
/**
 * wc-probe.ts — deterministic workflow probe.
 *
 * Usage:  bun wc-probe.ts --target <dir> [--expect skill|agents] [--json]
 * Exit:   0 = no findings (or --help), 1 = findings, 2 = argument error, 3 = the probe crashed.
 *
 * 2 and 3 are separate because a caller must be able to tell "you invoked me wrong" from "I could
 * not do my job": the second is a gate that did not run, and a gate that did not run must not be
 * read as a gate that passed. An explicit --help is a successful invocation, so it exits 0.
 *
 * Every check is a named exported predicate so other tools (the PostToolUse
 * validate hook) can import P2/P3/P4 rather than re-implement them.
 *
 * Node stdlib + bun only. No dependencies.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
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

/**
 * A reference the probe declined to check because it names a variable this process cannot resolve.
 *
 * Recorded and printed rather than dropped, for the same reason every exemption is: a check that
 * silently did not run is indistinguishable from a check that passed.
 */
export interface UnresolvedRef {
  rule: string
  file: string
  line?: number
  token: string
  /** Why the check did not run, e.g. "$HOME is not resolvable here". */
  reason: string
}

export interface SkillContext {
  /** Directory that ${CLAUDE_SKILL_DIR} stands for, or null if the file is not in a skill. */
  skillDir: string | null
  /** Directory that ${CLAUDE_PLUGIN_ROOT} stands for, or null when this file has no plugin root
   *  and one must NOT be invented — an unresolvable token is reported, an invented one is a verdict
   *  that depends on the caller's argument. */
  pluginRoot: string | null
}

/**
 * Frontmatter keys a SKILL.md may carry. The rule exists to catch a key the harness SILENTLY
 * IGNORES, so the test is whether the harness reads it — not whether the docs list it.
 */
export const DOCUMENTED_FRONTMATTER_KEYS: readonly string[] = [
  'name',
  'description',
  'when_to_use',
  'argument-hint',
  'arguments',
  'disable-model-invocation',
  'user-invocable',
  'allowed-tools',
  'disallowed-tools',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'hooks',
  'paths',
  'shell',
  'metadata',
  'license',
  'compatibility',
  // Read by the harness but absent from the docs, so the docs are not the authority here: the
  // 2.1.226 binary's plugin skill/command loader does `a.version!=null?String(a.version):void 0`
  // alongside `a.name` and `a["argument-hint"]`. Flagging it told authors of correct skills
  // (plugin-dev/command-development among them) that a key it honours is silently ignored.
  'version',
]

/**
 * WHERE THE EVIDENCE FOR THAT LIST ACTUALLY IS — because the list presents every entry as equally
 * verified and it is not.
 *
 * Extracted from the 2.1.226 plugin skill/command loader by its real access patterns (`a["key"]`,
 * `a.key!=null`): allowed-tools, argument-hint, disable-model-invocation, disallowed-tools,
 * user-invocable, agent, context, name, version, when_to_use, description, model, effort, hooks,
 * metadata, background, shell, arguments. Diffed against the list above, `version` was the only
 * gap, and it is now closed.
 *
 * A NOTE ON THE METHOD, because it bit me: a first pass matched `\ba\.([a-z_]\w*)\b` and reported
 * `split` as a frontmatter key. It is `a.split(…)`, a method call. Require the comparison or the
 * bracket, never the bare member access.
 *
 * UNVERIFIED, inherited rather than measured: `paths`, `license`, `compatibility`. `"paths":`
 * occurs in the binary; the other two never appear in key position. They may belong to a plugin or
 * marketplace manifest rather than a SKILL.md. They stay because the failure modes are asymmetric —
 * dropping them turns a correct skill into a finding, keeping them lets a genuinely ignored key
 * pass — and this gate's settled doctrine is that a critical against correct code is the worse of
 * the two. Establish them before treating them as known.
 */

const SKIP_DIRS = new Set([
  '.git',
  '.jj',
  '.hg',
  '.svn',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.cache',
  'dist',
  'coverage',
  '.pixi',
  '.mypy_cache',
  '.ruff_cache',
])

// ---------------------------------------------------------------- fs helpers

/**
 * Recursively list regular files under `dir`, skipping vendored/VCS directories.
 *
 * A directory that cannot be enumerated is APPENDED to `skipped`, not swallowed: silently returning
 * what was reachable turns lost coverage into a clean bill of health.
 */
/** `p` with every trailing separator removed. `/` becomes `''`; `/a/` becomes `/a`. */
function stripTrailingSep(p: string): string {
  let end = p.length
  while (end > 0 && p[end - 1] === sep) end--
  return p.slice(0, end)
}

/**
 * Path containment, INCLUSIVE: true when `descendant` IS `ancestor` or lies beneath it.
 *
 * THE ROOT BOUNDARY IS WHY THIS IS A FUNCTION. The naive spelling this replaced —
 * `a === b || b.startsWith(a + sep)` — is wrong at exactly one path, and it is the most dangerous
 * one: for `a = "/"` the prefix is `"//"`, which no resolved path starts with, so the test reads
 * FALSE for the one directory that contains everything. At the ancestor guard in `collectFiles`
 * that meant `ln -s / link` was not classified as a climb; the walk followed it and enumerated the
 * whole filesystem until the process died — no stdout, and an exit code (SIGABRT/timeout) that a
 * gate reading 0-or-1 cannot interpret at all. Stripping trailing separators before building the
 * prefix collapses the special case rather than special-casing it: the prefix for `/` is `/`, and
 * every absolute path starts with `/`.
 *
 * All four containment tests in this file route through here — the ancestor guard (`collectFiles`),
 * the P2 in-roots filter, and both cross-file-target tests — because they are the same test with
 * the same boundary, and this codebase's signature failure is the sibling left standing.
 */
export function isAtOrAbove(ancestor: string, descendant: string): boolean {
  const a = stripTrailingSep(ancestor)
  const d = stripTrailingSep(descendant)
  if (a === d) return true
  return d.startsWith(a === '' ? sep : a + sep)
}

export function collectFiles(
  dir: string,
  out: string[] = [],
  skipped: string[] = [],
  seen = new Set<string>(),
  broken: string[] = [],
  escaped: string[] = [],
  rootReal?: string,
): string[] {
  // SYMLINKS ARE FOLLOWED, and that is not a nicety: on this machine a skill is DELIVERED by symlink
  // (`~/.claude/skills/<name>` -> the repo), and `Dirent.isFile()`/`isDirectory()` are both false for
  // a link. The walk therefore selected nothing, and a probe that opened nothing printed CLEAN — a
  // whole skill passing the gate because none of it was ever read.
  //
  // `seen` holds the realpaths on the CURRENT ANCESTOR CHAIN — it is a cycle guard, not a visited
  // set, and the distinction is load-bearing. As a visited set it also suppressed a sibling ALIAS of
  // an already-walked directory, and since `classifySkillFile` keys on the path a file is REPORTED
  // under, `agents -> shared` silently decided whether the agent rules ran, on unsorted readdir
  // order. Adding before the descent and removing after terminates cycles without that side effect.
  //
  // A link that cannot be resolved at all is APPENDED to `skipped`, never dropped: fail closed.
  let real: string
  try {
    real = realpathSync(dir)
  } catch {
    skipped.push(dir)
    return out
  }
  if (seen.has(real)) return out
  const root = rootReal ?? real

  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    skipped.push(dir)
    return out
  }
  seen.add(real)
  try {
    for (const e of entries) {
      const p = join(dir, e.name)
      let isDir = e.isDirectory()
      let isFile = e.isFile()
      let linkReal: string | null = null
      if (e.isSymbolicLink()) {
        try {
          const st = statSync(p) // follows the link
          isDir = st.isDirectory()
          isFile = st.isFile()
          linkReal = realpathSync(p)
        } catch {
          // A dangling link is lost coverage — EXCEPT where the walk would have declined to read the
          // subtree anyway. The resolve-failure path did not honour SKIP_DIRS, so a stale
          // `node_modules -> /nonexistent` was an unexemptable critical while the real directory
          // beside it was skipped in silence.
          if (!SKIP_DIRS.has(e.name)) broken.push(p)
          continue
        }
      }
      if (isDir) {
        // SKIP_DIRS decides on what the entry RESOLVES to, not on what it is called. On the name
        // alone it failed both ways: `vendor -> node_modules` walked a dependency tree, and
        // `dist -> real-content` dropped real content with no entry in any channel.
        if (SKIP_DIRS.has(linkReal ? basename(linkReal) : e.name)) continue
        // ANCESTOR GUARD. A link resolving to the root or above it re-enters the tree from outside
        // and enumerates everything beside it: `sub/up -> ../..`, or a link to $HOME or /. Sideways
        // links OUT of the tree are still followed — that is how a skill is delivered here, as
        // `~/.claude/skills/<name>` -> the repo — but a climb is refused and declared.
        if (linkReal && isAtOrAbove(linkReal, root)) {
          escaped.push(p)
          continue
        }
        collectFiles(p, out, skipped, seen, broken, escaped, root)
      } else if (isFile) {
        out.push(p)
      }
    }
  } finally {
    seen.delete(real)
  }
  return out
}

export function readTextOrNull(file: string): string | null {
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size > 4_000_000) return null
    const buf = readFileSync(file)
    // crude binary sniff: a NUL byte in the first 4k
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

// ---------------------------------------------------------------- exemptions

/**
 * A DECLARED suppression of one rule, scoped to a file or to a region of one.
 *
 * Grammar — the marker must be the WHOLE trimmed line, optionally behind a `//`, `#` or `*`
 * comment lead-in so it is expressible in TypeScript and in Markdown alike:
 *
 *     <!-- wc-probe: ignore-paths -->            file-scoped, rule `paths`
 *     <!-- wc-probe: ignore-returns:start -->    opens a region for rule `returns`
 *     <!-- wc-probe: ignore-returns:end -->      closes it (an unclosed region runs to EOF)
 *     <!-- wc-probe: ignore-all -->              every rule, file-scoped
 *
 * The rule name is matched loosely on purpose — letters, digits, `_`, `.`, `-` — and then checked
 * against `KNOWN_EXEMPTION_RULES` by P9. A name outside that list is a FINDING, never a silent
 * no-op: see the note on `EXEMPT_LINE_RE` for why parsing a wrong name matters more than refusing it.
 *
 * Whole-line matching is load-bearing. Substring matching made this very file exempt from its own
 * P2 the moment it defined the marker string, which is the failure mode the mechanism exists to
 * prevent: a suppression nobody declared. Every exemption applied is returned in `ProbeResult` and
 * printed by the CLI in BOTH modes — a suppressed check that nobody can see is indistinguishable
 * from a check that passed.
 *
 * The legitimate case is a file that QUOTES broken input as evidence about the input itself. This
 * skill's own are counted in EXEMPTION ENTRIES — `notesFor` emits one `SUPPRESSED` note per entry,
 * whole-file or region-scoped alike, so two region markers for one rule in one file print twice.
 * Only whole-file entries are declared here, so entries, rule×file pairs and notes coincide at FOUR
 * across THREE files, all four reported on every run (SKILL.md's "Declared exemptions" table lists
 * the same four; a mismatch between the two is the undeclared-suppression failure, not a doc nit):
 *
 *   references/hook-reach.md   `paths`             — records that `${CLAUDE_SKILL_DIR}` does not
 *                                                    substitute inside `hooks:` frontmatter, and the
 *                                                    proof IS the unsubstituted command string.
 *   scripts/wc-probe.test.ts   `paths`, `returns`  — its fixtures are deliberately broken paths and
 *                                                    fake documented return shapes.  (2 pairs)
 *   scripts/parity-check.sh    `paths`             — its fixture writes a deliberately broken
 *                                                    `${CLAUDE_PLUGIN_ROOT}` reference so the two
 *                                                    surfaces have something to disagree about.
 */
export interface Exemption {
  /** Rule key: one of `KNOWN_EXEMPTION_RULES`. */
  rule: string
  file: string
  scope: 'file' | 'region'
  /** 1-based, inclusive. A file-scoped exemption spans the whole file. */
  startLine: number
  endLine: number
}

/**
 * The marker grammar. The rule-name alphabet is deliberately WIDER than the set of legal rule names.
 *
 * It used to be `[a-z][a-z-]*?`, which meant `ignore-P5` — the spelling this skill's own `P2`/`P5`/`P9`
 * naming teaches an author to reach for — did not match this line at all. A name that never parses is
 * not an exemption and is not a finding either: it is invisible in BOTH channels, `result.exemptions`
 * and `result.findings`, which is precisely the "suppression nobody declared" failure the whole-line
 * rule exists to close, arriving by the other door. So anything shaped like a name is PARSED here and
 * REJECTED by P9 (`checkExemptionVocabulary`) against `KNOWN_EXEMPTION_RULES`, which stays lower-case:
 * `ignore-Paths` is a finding, not a synonym for `ignore-paths`.
 *
 * The name group is GREEDY, not lazy. Lazy was safe only by exhaustive backtracking; greedy is safe
 * by construction, because the class excludes both `:` and `>`. So `ignore-paths:start` cannot have
 * its name run past the `:` (the suffix binds), and `ignore-x-->` cannot have it run into the close
 * (`-` is in the class, but the `>` that ends `-->` is not, so the only viable split leaves `x`).
 */
const EXEMPT_LINE_RE = /^(?:\/\/|#|\*)?\s*<!--\s*wc-probe:\s*ignore-([A-Za-z0-9][A-Za-z0-9_.-]*)(?::(start|end))?\s*-->$/

/**
 * The rule names an exemption marker may name — and NOTHING else, because a name no predicate reads
 * suppresses nothing while reading exactly like a suppression that works.
 *
 * This list is deliberately the set of rules that are actually HONOURED, not the set of rules that
 * exist. `frontmatter`, `plugin-root` and `fences` were documented here once and no predicate ever
 * consulted them; an author who wrote one got a silent no-op and a file that still failed the gate.
 */
export const KNOWN_EXEMPTION_RULES: readonly string[] = [
  'all',
  'hooks',
  'paths',
  'returns',
  'workflow-refs',
  'refs',
  'entry-point',
  'dispatch',
  'task-coverage',
]

/**
 * `lens-set-parity` IS NOT AND MUST NOT BE ON THAT LIST. P11 polices exactly one file per skill —
 * the SKILL.md emitting the fences — so a whole-file `ignore-lens-set-parity` is not a scoped
 * suppression, it is the rule's off switch, and a rule that can be switched off is worse than no
 * rule because it reads as enforcement. An intended difference is declared per-KEY instead, by
 * `parseLensSetDiffers`, which does not route through `EXEMPT_LINE_RE`.
 */

/** A marker naming a rule nothing honours is a finding, not a suppression. */
export function checkExemptionVocabulary(exemptions: readonly Exemption[]): Finding[] {
  return exemptions
    .filter(e => !KNOWN_EXEMPTION_RULES.includes(e.rule))
    .map(e => ({
      rule: 'P9 exemption vocabulary',
      severity: 'major' as const,
      file: e.file,
      line: e.startLine,
      detail: `the marker "ignore-${e.rule}" names a rule no predicate honours, so it suppresses nothing`,
      remedy: `use one of: ${KNOWN_EXEMPTION_RULES.join(', ')} — a marker that reads as a suppression and is not one hides a failing check twice over`,
    }))
}

/** Marker text quoted in CLI output. Defined by parts so this line is not itself a marker line. */
export const P2_EXEMPT_MARKER = `<!-- wc-probe: ${'ignore-paths'} -->`

/**
 * Every exemption declared in `text`, in file order.
 *
 * In Markdown, a marker inside a fenced block — or indented four spaces, which is Markdown's other
 * way of writing a code block — is an EXAMPLE, not a declaration. Honouring it would mean a file
 * that documents this very syntax silently exempts itself: the same failure the whole-line rule
 * exists to close, one level up.
 *
 * This is called ONCE per file, from `runProbe`, against the RAW text, and the result is threaded
 * into every predicate. Predicates used to re-parse from whatever text they were handed; for a `.md`
 * file the code view has its fence DELIMITERS blanked but its fence CONTENTS intact, so a marker
 * inside a fence read as top-level there and suppressed the whole file, while `result.exemptions` —
 * built from raw — reported nothing. Threading makes that disagreement unrepresentable.
 */
/**
 * The 1-based lines of `text` on which a `wc-probe:` declaration COUNTS: in Markdown, everything
 * outside a fenced block and outside an indented code block, since a marker inside one is an
 * example. Shared by every declaration parser — two walkers over the same grammar drift, and a line
 * one honours and the other does not is exactly the undeclared-suppression failure.
 */
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
      if (/^ {4}|^\t/.test(lines[i])) continue // an indented code block: an example, not a declaration
    }
    out.push(i + 1)
  }
  return out
}

export function parseExemptions(file: string, text: string): Exemption[] {
  const lines = text.split('\n')
  const out: Exemption[] = []
  const open = new Map<string, number>()
  for (const lineNo of declarableLines(file, text)) {
    const m = EXEMPT_LINE_RE.exec(lines[lineNo - 1].trim())
    if (!m) continue
    const rule = m[1]
    if (m[2] === 'start') {
      if (!open.has(rule)) open.set(rule, lineNo)
      continue
    }
    if (m[2] === 'end') {
      const start = open.get(rule)
      if (start === undefined) continue
      open.delete(rule)
      out.push({ rule, file, scope: 'region', startLine: start, endLine: lineNo })
      continue
    }
    out.push({ rule, file, scope: 'file', startLine: 1, endLine: lines.length })
  }
  // An unclosed region is honoured to end of file rather than dropped: dropping it would turn a
  // declared suppression into a silent one at exactly the moment the author got the syntax wrong.
  for (const [rule, start] of open) out.push({ rule, file, scope: 'region', startLine: start, endLine: lines.length })
  return out
}

/**
 * A P11 declaration: the lens keys two craft-args fences are ALLOWED to differ by.
 *
 *     <!-- wc-probe: lens-set-differs scope-fidelity -->
 *     <!-- wc-probe: lens-set-differs scope-fidelity budget -->
 *
 * `malformed` is set when a line opens the declaration and names no parseable key. It is reported
 * rather than dropped: a declaration that never parses is invisible in both channels, which is how
 * an author gets a rule they believe they configured and a gate that says nothing.
 */
export interface LensSetDiffers {
  file: string
  line: number
  keys: string[]
  malformed: boolean
}

/** The strict grammar: one or more space-separated key names. */
const LENS_DIFFERS_RE =
  /^(?:\/\/|#|\*)?\s*<!--\s*wc-probe:\s*lens-set-differs\s+([A-Za-z0-9][A-Za-z0-9_.-]*(?:\s+[A-Za-z0-9][A-Za-z0-9_.-]*)*)\s*-->$/
/** The loose opener, so a line that MEANT to declare and got the syntax wrong is not silence. */
const LENS_DIFFERS_OPEN_RE = /^(?:\/\/|#|\*)?\s*<!--\s*wc-probe:\s*lens-set-differs\b/

/**
 * Every `lens-set-differs` declaration in `text`, in file order.
 *
 * This is a DECLARATION, not an exemption: it names the keys a difference may cover and nothing
 * else, so it cannot switch P11 off. It deliberately does not route through `EXEMPT_LINE_RE`, which
 * still accepts only `ignore-<name>`.
 */
export function parseLensSetDiffers(file: string, text: string): LensSetDiffers[] {
  const lines = text.split('\n')
  const out: LensSetDiffers[] = []
  for (const line of declarableLines(file, text)) {
    const raw = lines[line - 1].trim()
    if (!LENS_DIFFERS_OPEN_RE.test(raw)) continue
    const m = LENS_DIFFERS_RE.exec(raw)
    if (!m) {
      out.push({ file, line, keys: [], malformed: true })
      continue
    }
    out.push({ file, line, keys: m[1].split(/\s+/), malformed: false })
  }
  return out
}

/** True when `rule` is suppressed at 1-based `line` by some declared exemption. */
export function isExemptAt(exemptions: readonly Exemption[], rule: string, line: number): boolean {
  return exemptions.some(e => (e.rule === rule || e.rule === 'all') && line >= e.startLine && line <= e.endLine)
}

/** Back-compat helper: true when the WHOLE file is exempt from P2. */
export function isPathCheckExempt(text: string): boolean {
  return parseExemptions('', text).some(e => e.scope === 'file' && (e.rule === 'paths' || e.rule === 'all'))
}

/**
 * The first shell/template variable left in `raw` after the two placeholders this probe knows how
 * to substitute, or null when nothing is left.
 *
 * The unbraced form is the load-bearing half. `resolveRefPath` used to test only for `${`, so
 * `bash $HOME/scripts/g.sh` was resolved LITERALLY — against a directory named `$HOME` that of
 * course does not exist — and every hook registration written that way became a false CRITICAL.
 * An environment variable this process cannot see is not a broken path; it is an unknown one.
 */
export function unresolvedVarIn(raw: string, ctx: SkillContext): string | null {
  let p = raw.trim()
  if (ctx.skillDir) p = p.split('${CLAUDE_SKILL_DIR}').join(ctx.skillDir)
  if (ctx.pluginRoot) p = p.split('${CLAUDE_PLUGIN_ROOT}').join(ctx.pluginRoot)
  const m = /\$\{[^}]*\}?|\$[A-Za-z_][A-Za-z0-9_]*/.exec(p)
  return m ? m[0] : null
}

/** Resolve ~ and normalize. Returns null when the path still holds an unresolved variable. */
export function resolveRefPath(raw: string, baseDir: string, ctx: SkillContext): string | null {
  let p = raw.trim()
  if (!p) return null
  if (unresolvedVarIn(raw, ctx) !== null) return null
  if (ctx.skillDir) p = p.split('${CLAUDE_SKILL_DIR}').join(ctx.skillDir)
  if (ctx.pluginRoot) p = p.split('${CLAUDE_PLUGIN_ROOT}').join(ctx.pluginRoot)
  if (p === '~') p = homedir()
  else if (p.startsWith('~/')) p = join(homedir(), p.slice(2))
  if (!p.startsWith(sep)) p = resolve(baseDir, p)
  return resolve(p)
}

/**
 * Is this agent `.md` somewhere a `hooks:` block actually FIRES?
 *
 * Three locations register an agent; only `.claude/agents` and `~/.claude/agents` deliver its
 * hooks — `hooks:`/`mcpServers:`/`permissionMode:` are ignored for a plugin-shipped agent. Since
 * `--agent` exists to gate a guard, the other location certifies dead code. It also keeps the
 * included-agent context override sound: an agent here has no competing plugin root to be
 * redirected away from.
 */
export function isGuardDiscoveryPath(file: string): boolean {
  // Recursive, for the same documented reason `isUnderAgentsRoot` is: a guard at
  // `.claude/agents/review/security.md` registers exactly like one at `.claude/agents/security.md`.
  const agentsDir = agentsDirOf(file)
  // `<anything>/.claude/agents` (project-level) or `~/.claude/agents` (personal).
  return agentsDir !== null && basename(dirname(agentsDir)) === '.claude'
}

/** Nearest ancestor directory (inclusive) holding a SKILL.md, else null. */
export function findSkillDir(file: string, stopAt: string): string | null {
  // `file` need not EXIST: the included-agent override passes a synthetic `join(root,'SKILL.md')`,
  // and a bare statSync on it threw ENOENT out of runProbe (exit 3, no findings) whenever --target
  // had no SKILL.md. That case is the P0 coverage floor's business, not a crash.
  let d: string
  try {
    d = statSync(file).isDirectory() ? file : dirname(file)
  } catch {
    d = dirname(file)
  }
  const stop = resolve(stopAt)
  for (;;) {
    if (existsSync(join(d, 'SKILL.md'))) return d
    if (d === stop || d === dirname(d)) return null
    d = dirname(d)
  }
}

/** Nearest ancestor holding a plugin manifest, else `fallback`. */
/** Real plugin root for `startDir`, or null when there is none. Invents nothing. */
export function findPluginRootOrNull(startDir: string): string | null {
  let d = resolve(startDir)
  for (;;) {
    if (existsSync(join(d, '.claude-plugin', 'plugin.json')) || existsSync(join(d, 'plugin.json'))) return d
    const parent = dirname(d)
    if (parent === d) return null
    d = parent
  }
}

export function findPluginRoot(startDir: string, fallback: string): string {
  let d = resolve(startDir)
  for (;;) {
    if (existsSync(join(d, '.claude-plugin', 'plugin.json')) || existsSync(join(d, 'plugin.json'))) return d
    const parent = dirname(d)
    if (parent === d) return resolve(fallback)
    d = parent
  }
}

/**
 * The two directories a placeholder can stand for, for one file.
 *
 * `stopAt` and `pluginFallback` are SEPARATE arguments on purpose. They were one argument once,
 * forwarded to `findSkillDir(file, stopAt)` and `findPluginRoot(dir, fallback)` alike — so the
 * write-time hook, which passes `sep` as a perfectly sane walk limit, also handed `/` to
 * `findPluginRoot` as a nonsense fallback and resolved every `${CLAUDE_PLUGIN_ROOT}` to `/`.
 * Write-time and gate-time then disagreed about the same file, which the whole shared-predicate
 * design exists to prevent.
 *
 * Default fallback is the resolved skill directory: for a personal, non-plugin skill that IS what
 * `CLAUDE_PLUGIN_ROOT` is set to in the hook environment (measured — see references/hook-reach.md).
 */
/**
 * Context for an agent supplied by `--agent`. Its two tokens have DIFFERENT bases:
 * `${CLAUDE_SKILL_DIR}` is the skill it guards (`root`), because that is what its hooks point at;
 * `${CLAUDE_PLUGIN_ROOT}` is its OWN, or null. Deriving both from `root` let the probe invent a
 * plugin root out of the `--target` argument, so one unchanged agent passed under one target and
 * failed under another — PASS became a property of the invocation.
 */
export function includedAgentContext(agentFile: string, root: string): SkillContext {
  const skillDir = existsSync(join(root, 'SKILL.md')) ? resolve(root) : null
  // `${CLAUDE_SKILL_DIR}` resolves to the skill this agent is declared to guard. `${CLAUDE_PLUGIN_ROOT}`
  // gets NO fallback: it is documented as the plugin installation directory, so an agent outside a
  // plugin has none and inventing one made the verdict a property of the --target argument. P1 now
  // refuses that token in an agent outright, so this no longer hides behind a NOT CHECKED note.
  return { skillDir, pluginRoot: findPluginRootOrNull(dirname(agentFile)) }
}

export function skillContextFor(file: string, stopAt: string, pluginFallback?: string): SkillContext {
  const skillDir = findSkillDir(file, stopAt)
  const base = skillDir ?? dirname(file)
  const pluginRoot = findPluginRoot(base, pluginFallback ?? base)
  return { skillDir, pluginRoot }
}

// ---------------------------------------------------------------- markdown views

/**
 * Files the Markdown predicates treat as Markdown, spelled ONCE.
 *
 * Five hand-maintained copies of this test lived in this file and one of them — `runProbe`'s
 * `file.endsWith('.md')`, which picks the raw-vs-code view P5/P6/P7 read — was case-SENSITIVE while
 * the other four were `/i`. So `NOTE.MD` was Markdown to P2 and not Markdown to P6 in the same run.
 */
export const MARKDOWN_EXT_RE = /\.(md|markdown)$/i

/**
 * Files whose comments `scanLiterals` may be trusted to find: a JS/TS lexer, and only on JS/TS.
 *
 * An ALLOWLIST, not the denylist this replaced. A denylist gives every extension nobody thought
 * about the JS lexer by default, which is how a shell file was once read as one unterminated block
 * comment — blinding P2 for the rest of the file, silently. Now that `.py` and `.json` are eligible
 * source, the default matters: over-checking a path in a `#` comment fails LOUD and is exemptable,
 * mis-lexing one fails silent.
 */
const LEXABLE_EXT_RE = /\.(ts|mts|cts|js|mjs|cjs)$/i

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(\S*)/
const CODE_FENCE_LANGS = new Set(['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'mjs', 'cjs'])

/** A call to `Workflow(` — the content signature that makes a fence code whatever its info string. */
const WORKFLOW_CALL_RE = /\bWorkflow\s*\(/

export interface FenceBlock {
  lang: string
  /** 1-based line of the opening delimiter. */
  line: number
  /** 1-based line of the closing delimiter, or the last line when the fence is never closed. */
  endLine: number
  body: string
}

/** Fenced blocks of a Markdown document, with their info string and 1-based line span. */
export function fencedBlocks(md: string): FenceBlock[] {
  const lines = md.split('\n')
  const blocks: FenceBlock[] = []
  let open: { marker: string; lang: string; line: number; body: string[] } | null = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_RE.exec(lines[i])
    if (open === null) {
      if (m) open = { marker: m[2], lang: m[3], line: i + 1, body: [] }
      continue
    }
    if (m && m[2][0] === open.marker[0] && m[2].length >= open.marker.length && m[3] === '') {
      blocks.push({ lang: open.lang, line: open.line, endLine: i + 1, body: open.body.join('\n') })
      open = null
      continue
    }
    open.body.push(lines[i])
  }
  if (open !== null) blocks.push({ lang: open.lang, line: open.line, endLine: lines.length, body: open.body.join('\n') })
  return blocks
}

/**
 * For each 1-based line, whether it is a fence delimiter or fence interior — for fences of EVERY
 * info string, `js` and `text` and bare alike.
 *
 * This is the prose/code discriminator for Markdown. It is separate from `maskNonFenced` on purpose:
 * a documented return shape inside a ```text fence is sample OUTPUT, not a contract, even though
 * that same fence may hold a `Workflow(` call that P6 and P7 must read.
 */
export function fenceLineMap(md: string): boolean[] {
  const map = new Array<boolean>(md.split('\n').length + 1).fill(false)
  for (const b of fencedBlocks(md)) for (let l = b.line; l <= b.endLine; l++) map[l] = true
  return map
}

/**
 * True when a fenced block should be read as code.
 *
 * CONTENT, not label. The rule was once "the info string must say js/ts", and it was authored
 * against a corpus that does not follow it: of the real `Workflow(` call sites in the spine skills,
 * most sit in a BARE fence and several in a ```text one. A label rule left the gate reading a small
 * minority of the call sites it exists to judge, so it is the content that decides.
 */
export function isCodeFence(block: FenceBlock): boolean {
  return CODE_FENCE_LANGS.has(block.lang.toLowerCase()) || WORKFLOW_CALL_RE.test(block.body)
}

/**
 * A same-length view of a Markdown document in which everything EXCEPT the interior of a CODE fence
 * (see `isCodeFence`) is blanked. Newlines are preserved, so an index into the view is an index into
 * the original and `lineOf` needs no offset arithmetic.
 *
 * This is what lets P6/P7 run on the artifact this skill actually emits. Running them on raw
 * Markdown does not work: `maskLiterals` reads a Markdown backtick fence as a template literal and
 * blanks the block's contents before `findObjectLiterals` ever sees them.
 *
 * Exemption markers are NOT preserved here. They used to be, because the predicates re-parsed them
 * from this view; they are now parsed once from the raw file and threaded in, so leaving marker text
 * in a view labelled "code" would only give the code predicates something to misread.
 */
/**
 * The complement of `maskNonFenced`: fenced blocks — delimiters and interior, EVERY info string —
 * are blanked and prose is kept. Newlines and indexes are preserved.
 *
 * P2's Markdown link scans read this. Reading raw text made a `[a](./x.md)` or a `[a]: ./x.md`
 * written inside a fence as a worked EXAMPLE draw a critical against a file the example never
 * claimed exists — and `parseExemptions` deliberately ignores a marker inside a fence, so there was
 * no way to suppress it in place either.
 */
/** P2 moved to `fencedLineSet` (demotion, not masking); P12(a) reads this to judge PROSE only. */
export function maskFences(md: string): string {
  const lines = md.split('\n')
  const drop = new Set<number>()
  for (const b of fencedBlocks(md)) for (let l = b.line; l <= b.endLine; l++) drop.add(l)
  return lines.map((line, i) => (drop.has(i + 1) ? ' '.repeat(line.length) : line)).join('\n')
}

/**
 * Lines inside a fenced block, 1-based. P2 uses this to DEMOTE rather than to blind itself:
 * a reference in a fence is illustration, so it is announced, never a critical and never silent.
 */
export function fencedLineSet(md: string): Set<number> {
  const lines = md.split('\n')
  const drop = new Set<number>()
  for (const b of fencedBlocks(md)) {
    // An UNCLOSED fence runs to EOF, so one stray ``` would demote every reference below it for the
    // rest of the file — a single typo silently switching P2 off. Demotion is the fail-OPEN
    // direction, so an unterminated block does not get it: unbalanced markers mean the document is
    // malformed, and a malformed document is checked, not excused.
    const closed = b.endLine < lines.length || /^\s*(`{3,}|~{3,})\s*$/.test(lines[b.endLine - 1] ?? '')
    if (!closed) continue
    for (let l = b.line; l <= b.endLine; l++) drop.add(l)
  }
  return drop
}

export function maskNonFenced(md: string): string {
  const lines = md.split('\n')
  const keep = new Set<number>()
  for (const b of fencedBlocks(md)) {
    if (!isCodeFence(b)) continue
    for (let l = b.line + 1; l < b.endLine; l++) keep.add(l)
    // An unclosed fence has no closing delimiter line to stop short of.
    if (b.endLine === lines.length && !/^\s*(`{3,}|~{3,})\s*$/.test(lines[b.endLine - 1])) keep.add(b.endLine)
  }
  return lines.map((line, i) => (keep.has(i + 1) ? line : ' '.repeat(line.length))).join('\n')
}

// ---------------------------------------------------------------- JS scanning

/**
 * Blank out string, template and comment contents so brace matching and key
 * extraction only see code. Newlines are preserved so indexes stay aligned
 * with the original text (line numbers remain correct).
 *
 * TEMPLATE INTERPOLATION IS TRACKED, and it has to be. The naive version scanned a `` ` `` forward
 * to the next `` ` ``, which a nested template inside `${…}` closes early — after which the
 * in-string/out-of-string state alternates wrongly for the whole rest of the file. One such line in
 * `writing-draft.js` left 65% of that file masked as "string", and 89% of
 * `compiled-runner-template.js`. Both directions of that failure were live: the real top-level
 * `return {` became invisible so its documented keys read as unimplemented, and executable code in
 * the desynced region read as BLANK, i.e. as prose, so `documentedShapes` invented documented
 * contracts out of running code. P5, P6 and P7 all read this output, so the blast radius was every
 * rule that judges what a script contains.
 *
 * `${` opens a CODE context that ends at its matching `}`, and a template opened inside that context
 * nests. The interpolation stack records the brace depth each `${` opened at, which is what lets the
 * matching `}` hand control back to the enclosing template's literal part.
 */
export function maskLiterals(src: string): string {
  return scanLiterals(src).masked
}

export interface LiteralScan {
  /** Strings, templates and comments blanked; newlines and indexes preserved. */
  masked: string
  /** 1 where the character is inside a COMMENT, as opposed to a string or template. */
  comment: Uint8Array
}

/**
 * The single scanner behind `maskLiterals`, which also reports WHICH KIND of blank each character is.
 *
 * One pass produces both, deliberately. A second scanner computing comment spans separately is the
 * sibling-drift failure this file has already paid for three times: two functions reading the same
 * text with subtly different rules, agreeing until they don't.
 */
export function scanLiterals(src: string): LiteralScan {
  const out = src.split('')
  const n = src.length
  const comment = new Uint8Array(n)
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '
  }
  const markComment = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) comment[k] = 1
  }
  const prevCode = (i: number): string => {
    for (let k = i - 1; k >= 0; k--) {
      const c = out[k]
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') continue
      return c
    }
    return ''
  }
  // Brace depth of the code context, and the depth each open `${` was entered at.
  let brace = 0
  const interp: number[] = []
  let inTemplate = false
  let i = 0
  while (i < n) {
    const c = src[i]
    if (inTemplate) {
      if (c === '\\') {
        blank(i, i + 2)
        i += 2
        continue
      }
      if (c === '`') {
        // Closes this template. If it was opened inside an interpolation, the matching `}` below is
        // what returns us to the enclosing template.
        inTemplate = false
        i++
        continue
      }
      if (c === '$' && src[i + 1] === '{') {
        interp.push(brace)
        brace++
        inTemplate = false
        i += 2
        continue
      }
      if (c !== '\n') out[i] = ' '
      i++
      continue
    }
    if (c === '`') {
      inTemplate = true
      i++
      continue
    }
    if (c === '{') {
      brace++
      i++
      continue
    }
    if (c === '}') {
      brace = Math.max(0, brace - 1)
      if (interp.length > 0 && brace === interp[interp.length - 1]) {
        interp.pop()
        inTemplate = true
      }
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i)
      const end = j === -1 ? n : j
      blank(i, end)
      markComment(i, end)
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2)
      const end = j === -1 ? n : j + 2
      blank(i, end)
      markComment(i, end)
      i = end
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === c || src[j] === '\n') break
        j++
      }
      blank(i + 1, j)
      i = Math.min(j, n) + 1
      continue
    }
    if (c === '/') {
      const p = prevCode(i)
      const isDivision = p !== '' && (/[\w$)\]]/.test(p))
      if (!isDivision) {
        let j = i + 1
        let inClass = false
        let closed = false
        while (j < n) {
          const d = src[j]
          if (d === '\\') {
            j += 2
            continue
          }
          if (d === '\n') break
          if (d === '[') inClass = true
          else if (d === ']') inClass = false
          else if (d === '/' && !inClass) {
            closed = true
            break
          }
          j++
        }
        if (closed) {
          blank(i + 1, j)
          i = j + 1
          continue
        }
      }
    }
    i++
  }
  return { masked: out.join(''), comment }
}

export interface ObjectLiteral {
  start: number // index of '{'
  end: number // index just past matching '}'
  keys: string[]
}

/** Index of the '}' matching the '{' at `start`, in masked text; -1 if unbalanced. */
export function matchBrace(masked: string, start: number): number {
  let depth = 0
  for (let i = start; i < masked.length; i++) {
    const c = masked[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Top-level keys of the object literal whose '{' sits at `start`.
 *
 * `includeShorthand` also counts ES6 shorthand properties — `{ verdict, scoreTable }`, an identifier
 * with no `:` after it. It is OFF by default because the identifier-only form is how documents
 * SKETCH a shape (`{ id, name, work }`), and counting those turns a sketch into a task row P7 then
 * demands `refs` from. It is ON wherever the text is real code and the shorthand keys are real
 * channels — `contractReturn` and `sameFileDrift`. `work.js` returns 15 keys and 8 of them are
 * shorthand, so without this the contract came back half-empty and every one of those keys read as
 * documented-but-unimplemented.
 */
export function objectTopLevelKeys(
  src: string,
  masked: string,
  start: number,
  end: number,
  includeShorthand = false,
): string[] {
  const keys: string[] = []
  let depth = 0
  let i = start + 1
  // Only the token at the START of an entry can be a key. Without this, `planPath: PLAN_PATH,` read
  // its VALUE as a second, shorthand key.
  let expectKey = true
  while (i < end) {
    const c = masked[i]
    if (c === '{' || c === '[' || c === '(') {
      depth++
      i++
      continue
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      i++
      continue
    }
    if (depth === 0 && c === ',') {
      expectKey = true
      i++
      continue
    }
    if (depth === 0 && !expectKey) {
      i++
      continue
    }
    if (depth === 0 && (c === '"' || c === "'")) {
      const close = masked.indexOf(c, i + 1)
      if (close === -1 || close >= end) break
      let k = close + 1
      while (k < end && /\s/.test(masked[k])) k++
      if (masked[k] === ':') keys.push(src.slice(i + 1, close))
      expectKey = false
      i = close + 1
      continue
    }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < end && /[\w$]/.test(masked[j])) j++
      let k = j
      while (k < end && /\s/.test(masked[k])) k++
      if (masked[k] === ':') keys.push(src.slice(i, j))
      // Shorthand: the identifier is followed by a separator or the closing brace, nothing else.
      else if (includeShorthand && (masked[k] === ',' || k >= end)) keys.push(src.slice(i, j))
      expectKey = false
      i = j
      continue
    }
    i++
  }
  return keys
}

/**
 * Object literals in a JS/TS source, with their top-level keys.
 * A '{' counts as an object literal (not a block) when the preceding code
 * character is one of `([,=:` or it follows `return` / `=>`.
 */
export function findObjectLiterals(src: string): ObjectLiteral[] {
  const masked = maskLiterals(src)
  const found: ObjectLiteral[] = []
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '{') continue
    let k = i - 1
    while (k >= 0 && /\s/.test(masked[k])) k--
    const prev = k >= 0 ? masked[k] : ''
    const before = masked.slice(Math.max(0, k - 8), k + 1)
    const isLiteral = '([,=:'.includes(prev) || /(?:return|=>)\s*$/.test(before + '')
    if (!isLiteral) continue
    const end = matchBrace(masked, i)
    if (end === -1) continue
    found.push({ start: i, end: end + 1, keys: objectTopLevelKeys(src, masked, i, end) })
  }
  return found
}

/** String literals inside `src.slice(from, to)`, in order. */
export function stringLiteralsIn(src: string, from: number, to: number): string[] {
  const slice = src.slice(from, to)
  const out: string[] = []
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(slice)) !== null) out.push(m[2])
  return out
}

// ---------------------------------------------------------------- frontmatter

export interface FrontmatterResult {
  ok: boolean
  error?: string
  keys: string[]
  /** index in the source just past the closing `---`, or 0 when absent */
  bodyStart: number
  hasFrontmatter: boolean
}

/**
 * Minimal YAML frontmatter reader: validates the fences and structure enough to
 * catch the breakages that matter (missing close, tab indentation, a top-level
 * line that is not a key) and returns the top-level keys.
 */
export function parseFrontmatter(text: string): FrontmatterResult {
  if (!text.startsWith('---')) {
    return { ok: true, keys: [], bodyStart: 0, hasFrontmatter: false }
  }
  const firstNl = text.indexOf('\n')
  if (firstNl === -1) {
    return { ok: false, error: 'frontmatter opened with --- but the file has no further lines', keys: [], bodyStart: 0, hasFrontmatter: true }
  }
  const lines = text.slice(firstNl + 1).split('\n')
  let closeIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === '---' || lines[i].trimEnd() === '...') {
      closeIdx = i
      break
    }
  }
  if (closeIdx === -1) {
    return { ok: false, error: 'frontmatter is never closed by a --- fence', keys: [], bodyStart: 0, hasFrontmatter: true }
  }
  const bodyStart = firstNl + 1 + lines.slice(0, closeIdx + 1).reduce((a, l) => a + l.length + 1, 0)
  const keys: string[] = []
  let blockScalarIndent: number | null = null
  for (let i = 0; i < closeIdx; i++) {
    const raw = lines[i]
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue
      blockScalarIndent = null
    }
    if (/^\s*\t/.test(raw) || raw.slice(0, indent).includes('\t')) {
      return { ok: false, error: `line ${i + 2}: tab character used for indentation (YAML forbids tabs)`, keys, bodyStart, hasFrontmatter: true }
    }
    if (indent > 0) continue
    const m = /^(["']?)([A-Za-z0-9_.-]+)\1\s*:(\s|$)/.exec(raw)
    if (!m) {
      return { ok: false, error: `line ${i + 2}: top-level line is not a "key:" mapping entry -> ${JSON.stringify(raw.slice(0, 60))}`, keys, bodyStart, hasFrontmatter: true }
    }
    keys.push(m[2])
    const rest = raw.slice(raw.indexOf(':') + 1).trim()
    if (rest === '|' || rest === '>' || /^[|>][-+]?\d*$/.test(rest)) blockScalarIndent = indent
    const q = /^(["'])/.exec(rest)
    if (q && !new RegExp(`${q[1]}\\s*$`).test(rest.slice(1)) && !rest.slice(1).includes(q[1])) {
      return { ok: false, error: `line ${i + 2}: unterminated quoted scalar for key "${m[2]}"`, keys, bodyStart, hasFrontmatter: true }
    }
  }
  return { ok: true, keys, bodyStart, hasFrontmatter: true }
}

/** What predicate set a file is subject to. `null` means "not one of the three kinds". */
export type SkillFileKind = 'skill' | 'agent' | 'hooks' | null

/**
 * THE single dispatch table, shared by the gate and the write-time hook.
 *
 * They each had their own. `runProbe` ran P4 only when `basename === 'SKILL.md'`; the hook ran it for
 * a skill OR an agent file. So on the same agent file the gate reported one finding and the advisory
 * hook reported two — the ENFORCEMENT authority passing what the advisory surface flagged, which is
 * the precise disagreement the shared-predicate design exists to prevent. Sharing the predicates and
 * not the dispatch left the bug one level up.
 */
/** The nearest ancestor directory named `agents`, or null. */
export function agentsDirOf(filePath: string): string | null {
  let dir = dirname(resolve(filePath))
  for (;;) {
    if (basename(dir) === 'agents') return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/**
 * Is this file inside an agent-DISCOVERY root? Depth is not the test and never was:
 * "Claude Code scans `.claude/agents/` and `~/.claude/agents/` recursively, so you can organize
 * definitions into subfolders such as `agents/review/`" — and plugin `agents/` too
 * (code.claude.com/docs/en/sub-agents). So `agents/review/security.md` IS a registered agent.
 *
 * What made `docs/agents/guide/x.md` prose is that `docs/` is not a root, not that the file was
 * two levels down. Anchoring on the ROOT covers both; the immediate-parent rule that replaced the
 * any-ancestor rule traded a false positive for a hole one subfolder wide.
 */
export function isUnderAgentsRoot(filePath: string, root?: string): boolean {
  const agentsDir = agentsDirOf(filePath)
  if (agentsDir === null) return false
  const holder = dirname(agentsDir)
  if (basename(holder) === '.claude') return true
  if (root) return resolve(root) === holder
  // No root to judge against: fall back to the one case that needs none.
  return dirname(resolve(filePath)) === agentsDir
}

export function classifySkillFile(filePath: string, root?: string): SkillFileKind {
  const name = basename(filePath)
  if (name === 'SKILL.md') return 'skill'
  if (name === 'hooks.json') return 'hooks'
  if (name.endsWith('.md') && isUnderAgentsRoot(filePath, root)) return 'agent'
  return null
}

// ---------------------------------------------------------------- P1

const SCRIPT_EXT_RE = /\.(ts|mts|cts|js|mjs|cjs|sh|bash|py|rb|pl)$/

/** Every `command` string reachable under a `hooks` key of a parsed settings/hooks object. */
export function hookCommandsInParsedJson(value: unknown, underHooks = false, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) hookCommandsInParsedJson(v, underHooks, out)
    return out
  }
  if (value === null || typeof value !== 'object') return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (underHooks && k === 'command' && typeof v === 'string') out.add(v)
    hookCommandsInParsedJson(v, underHooks || k === 'hooks', out)
  }
  return out
}

/**
 * Every hook `command` string registered by a hooks.json / settings*.json, with its line.
 *
 * The parse decides WHICH commands count; the regex only supplies line numbers. Taking every
 * `"command"` key made `statusLine.command` — which is a command but not a hook — read as a hook
 * registration, so a status line pointing at a missing script produced a finding under the wrong
 * rule. When the JSON does not parse, every command is kept: a file too broken to read is not
 * grounds for quietly checking less of it.
 */
export function hookCommandsInJson(text: string): { command: string; line: number }[] {
  let allowed: Set<string> | null = null
  try {
    allowed = hookCommandsInParsedJson(JSON.parse(text))
  } catch {
    allowed = null // unparseable: fall back to every command rather than to none
  }
  const out: { command: string; line: number }[] = []
  const re = /"command"\s*:\s*"((?:\\.|[^"\\])*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let value: string
    try {
      value = JSON.parse(`"${m[1]}"`)
    } catch {
      value = m[1]
    }
    if (allowed !== null && !allowed.has(value)) continue
    out.push({ command: value, line: lineOf(text, m.index) })
  }
  return out
}

/** Every `command:` string inside a `hooks:` block of a skill/agent frontmatter, with its line. */
export function hookCommandsInFrontmatter(text: string): { command: string; line: number }[] {
  const fm = parseFrontmatter(text)
  if (!fm.hasFrontmatter) return []
  // When the fence never closes, `bodyStart` is 0 and slicing it yields '' — so a file too broken
  // to parse reported ZERO hook commands and P1 passed it in silence. `hookCommandsInJson` already
  // states the governing policy for the same situation: a file too broken to read is not grounds
  // for quietly checking less of it. Scan the whole text instead.
  const head = fm.ok && fm.bodyStart > 0 ? text.slice(0, fm.bodyStart) : text
  const lines = head.split('\n')
  const out: { command: string; line: number }[] = []
  let inHooks = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw.trimEnd() === '---' || raw.trimEnd() === '...') continue
    const indent = raw.length - raw.trimStart().length
    if (indent === 0 && raw.trim() !== '') {
      inHooks = /^hooks\s*:/.test(raw.trim())
      continue
    }
    if (!inHooks) continue
    const m = /(?:^|[-\s])command\s*:\s*(.+)$/.exec(raw)
    if (!m) continue
    let value = m[1].trim()
    const q = /^(["'])([\s\S]*)\1$/.exec(value)
    if (q) value = q[2]
    out.push({ command: value, line: i + 1 })
  }
  return out
}

/**
 * Path-shaped tokens inside a shell command string.
 *
 * QUOTES ARE HONOURED. Splitting on whitespace tore `bun "/a b/scripts/g.ts"` into `"/a` and
 * `b/scripts/g.ts"`, so a path with a space in it was reported missing under a name nobody wrote —
 * and the real path went unchecked.
 */
export function hookScriptTokens(command: string): string[] {
  const out: string[] = []
  const tokens: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (/\s/.test(c)) {
      if (cur) tokens.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur) tokens.push(cur)

  // UNBALANCED QUOTE — an apostrophe in prose (`echo don't && bash /sk/g.sh`) opens a quote that
  // never closes, and the accumulated run is then one token ending in `.sh`: a critical naming a
  // path nobody wrote, while the real body goes unchecked. A command that does not lex is not a
  // command we may reason about token-wise, so fall back to the naive split the parent used.
  if (quote !== null) {
    tokens.length = 0
    for (const t of command.split(/\s+/)) {
      const stripped = t.replace(/^['"]+/, '').replace(/['"]+$/, '')
      if (stripped) tokens.push(stripped)
    }
  }

  const consider = (tok: string) => {
    const t = tok.replace(/^[`]+/, '').replace(/[`;]+$/, '')
    if (!t || !SCRIPT_EXT_RE.test(t)) return
    if (!t.includes('/')) return // a bare `foo.sh` is a PATH lookup, not a shipped file
    out.push(t)
  }

  for (const rawTok of tokens) {
    // A QUOTED PAYLOAD IS STILL A COMMAND. `bash -c 'exec /sk/g.sh "$@"'` lexes to ONE token, which
    // `SCRIPT_EXT_RE` (anchored at `$`) never matches — so P1 saw zero tokens, reported zero
    // findings AND zero skips, and a registered hook whose body is missing passed CLEAN. Re-split a
    // multi-word token that is not itself a path; a genuine path with a space in it matches whole
    // and is never re-split, which is the case quote-awareness was added for.
    if (/\s/.test(rawTok) && !SCRIPT_EXT_RE.test(rawTok)) {
      for (const piece of rawTok.split(/\s+/)) consider(piece)
      continue
    }
    consider(rawTok)
  }
  return out
}

/** True when `p` exists AND is a regular file. A hook body must be a file, not a directory. */
export function isExecutableFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * P1 hook-registration — every hook body a registry REGISTERS must exist on disk.
 *
 * The rule is registration-driven, not directory-driven. It used to scan `<target>/hooks/` and
 * accept `registryText.includes(basename)` as proof of registration, which failed twice over: the
 * layout this skill prescribes routes guard bodies to `scripts/`, so the scan never ran at all; and
 * any prose mention of a basename — including a sentence saying the hook was DELETED — satisfied
 * the substring test. Inverting it fixes both: a script nobody registers is just a script (probes
 * live under `scripts/` too), while a registered command pointing at nothing never fires and is
 * indistinguishable from a passing one.
 */
export function checkHookRegistration(
  target: string,
  skips: UnresolvedRef[] = [],
  applied: Exemption[] = [],
  /** Agent files from outside `target` (`--agent`). Walked HERE too: runProbe's source loop runs
   *  P2-P7 only, and P1 is the rule a guard file most needs. */
  includeAgents: readonly string[] = [],
): Finding[] {
  const findings: Finding[] = []
  const seen = new Set<string>()
  const includedSet = new Set(includeAgents.map(a => resolve(a)))
  for (const f of [...collectFiles(target), ...includeAgents]) {
    const b = basename(f)
    // An `--agent` file comes from OUTSIDE `target`, so `target` is not its root — judging it
    // against one would classify a real agent as prose. It falls back to the rootless rule.
    const fileRoot = includedSet.has(resolve(f)) ? undefined : target
    const isJsonRegistry = b === 'hooks.json' || /^settings.*\.json$/.test(b)
    // Routed through `classifySkillFile`, not a second substring test. Narrowing the classifier to
    // the immediate parent and leaving this on any-ancestor recreated the shared-predicates/
    // unshared-dispatch split one level up: prose under `docs/agents/guide/` was not an agent to the
    // classifier and WAS a hook registry here, so P1 judged a document as a guard.
    const isMdRegistry = b === 'SKILL.md' || classifySkillFile(f, fileRoot) === 'agent'
    if (!isJsonRegistry && !isMdRegistry) continue
    const text = readTextOrNull(f)
    if (text === null) continue
    // P1 is REGISTRY-driven, so it walks its own files and cannot take a per-file exemption list
    // from runProbe's source-file loop. It therefore hands back what it parsed, and runProbe reports
    // it. Without that, a marker in a `hooks.json` — which `SOURCE_EXT_RE` never collects — silenced
    // a critical P1 and appeared in NEITHER output mode: the invisible suppression this whole
    // mechanism exists to prevent, surviving on the one path the threading did not cover.
    const exemptions = parseExemptions(f, text)
    applied.push(...exemptions)
    const commands = isJsonRegistry ? hookCommandsInJson(text) : hookCommandsInFrontmatter(text)
    if (commands.length === 0) continue
    const rawCtx = includeAgents.includes(f) ? includedAgentContext(f, target) : skillContextFor(f, target)
    const ctx = classifySkillFile(f, fileRoot) === 'agent'
      ? { ...rawCtx, pluginRoot: findPluginRootOrNull(dirname(f)) }
      : rawCtx
    for (const { command, line } of commands) {
      if (isExemptAt(exemptions, 'hooks', line)) continue

      // ${CLAUDE_SKILL_DIR} DOES NOT SUBSTITUTE in a `hooks:` frontmatter command. That is measured,
      // by this very skill — see references/hook-reach.md: it reached the hook process as an empty
      // argument and was unset in the hook's environment, so the command ran with a broken path and
      // silently found no script. P1 was resolving it against the skill directory and reading CLEAN,
      // which passes the one hook-registration failure this skill has itself demonstrated.
      // BOTH SPELLINGS. bash terminates a bare `$CLAUDE_SKILL_DIR` at the `/`, so
      // `$CLAUDE_SKILL_DIR/scripts/g.sh` and `${CLAUDE_SKILL_DIR}/scripts/g.sh` run identically —
      // and the braced-only substring test let the shell-natural form fall through to
      // `unresolvedVarIn`, which downgraded the same defect to a skip note and exited CLEAN.
      if (isMdRegistry && /\$(?:\{CLAUDE_SKILL_DIR\}|CLAUDE_SKILL_DIR\b)/.test(command)) {
        findings.push({
          rule: 'P1 hook-registration',
          severity: 'critical',
          file: f,
          line,
          detail:
            'a hooks: frontmatter command is written against ${CLAUDE_SKILL_DIR}, which does not substitute in that context (measured — references/hook-reach.md): it arrives empty, so the command runs with a broken path and finds no script',
          remedy: 'use an absolute path in a hooks: command — and NOT ${CLAUDE_PLUGIN_ROOT} in an agent, which is documented as the PLUGIN installation directory and has no value outside one',
        })
        continue
      }

      // ${CLAUDE_PLUGIN_ROOT} in an AGENT's hooks: command. Documented as "the plugin's
      // installation directory, for scripts bundled with a plugin" — so in an agent outside a
      // plugin it names nothing, and in a plugin-shipped agent the whole hooks: block is ignored.
      // Either way it cannot resolve to something the hook will actually run. Resolving it anyway
      // is what made one unchanged agent CLEAN under one --target and CRITICAL under another: the
      // probe was inventing a value the runtime never supplies. Skills are NOT covered here —
      // there the placeholder is meaningful and was measured.
      if (classifySkillFile(f, fileRoot) === 'agent' && /\$(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT\b)/.test(command)) {
        findings.push({
          rule: 'P1 hook-registration',
          severity: 'critical',
          file: f,
          line,
          detail:
            'an agent hooks: command is written against ${CLAUDE_PLUGIN_ROOT}, which is documented as the plugin installation directory: an agent outside a plugin has none, and a plugin-shipped agent has its hooks: block ignored entirely, so this command can never run against a path the harness supplies',
          remedy: 'use an absolute path. If the guard belongs to a plugin, declare it in that plugin\'s hooks/hooks.json, where ${CLAUDE_PLUGIN_ROOT} is defined',
        })
        continue
      }

      for (const token of hookScriptTokens(command)) {
        const variable = unresolvedVarIn(token, ctx)
        if (variable !== null) {
          skips.push({ rule: 'P1 hook-registration', file: f, line, token, reason: `${variable} is not resolvable here` })
          continue
        }
        const resolved = resolveRefPath(token, dirname(f), ctx)
        if (resolved === null) continue
        // isFile, not existsSync: a DIRECTORY named `guard.ts` satisfied "the body exists" and the
        // hook still cannot run.
        if (isExecutableFile(resolved)) continue
        const key = `${f}::${resolved}`
        if (seen.has(key)) continue
        seen.add(key)
        findings.push({
          rule: 'P1 hook-registration',
          severity: 'critical',
          file: f,
          line,
          detail: `a registered hook command runs ${JSON.stringify(token)}, which resolves to ${resolved} and is not a readable file`,
          remedy: 'create the hook body at that path, or drop the registration — a registered hook whose body is missing never fires and is indistinguishable from a passing one',
        })
      }
    }
  }
  return findings
}

// ---------------------------------------------------------------- P2

/**
 * The tail must START with `/`, or it is not a path at all. Without that anchor, prose about the
 * placeholder itself — `${CLAUDE_PLUGIN_ROOT}-in-body`, the name of the P4 anti-pattern — parsed as
 * a path and produced a false CRITICAL.
 *
 * The tail also admits a further `${VAR}` SEGMENT. It did not, and the charset stopped dead at the
 * `$`, so `${CLAUDE_SKILL_DIR}/${VERSION}/rules.md` was truncated to `${CLAUDE_SKILL_DIR}/` and then
 * dropped as "a bare directory reference, nothing to resolve" — a path P2 declined to check without
 * saying so, on the very line where P7 announced the same token.
 */
/**
 * Does this reference carry a documentation placeholder that RESUMES a path — `dev-[phase]/x.md`,
 * `refs/{name}.md`? Then it names a family of files, not one. A bracket the path does not resume
 * past is ordinary trailing markup and the reference before it was complete.
 */
export function isPathTemplate(raw: string): boolean {
  // `(?<!\$)` matters: `${CLAUDE_SKILL_DIR}/scripts/w.js` opens a brace group followed by `/`, and
  // without this every substitutable reference read as a template and stopped being checked.
  return /(?<!\$)[[<{][^\]>}]*[\]>}][/.]/.test(raw)
}

const PLACEHOLDER_RE = /\$\{(CLAUDE_SKILL_DIR|CLAUDE_PLUGIN_ROOT)\}((?:\/(?:[A-Za-z0-9_\-.*]|\$\{[A-Za-z_][A-Za-z0-9_]*\})+)*\/?)?/g

/**
 * Absolute, extension-bearing paths written out in full, e.g. in a Markdown link or an inline cmd.
 *
 * The trailing guard is `(?!\.?[A-Za-z0-9_+-])` rather than `\b`: `\b` let `/a/b/notes.md.backup`
 * match as `/a/b/notes.md`, so a file that exists was reported missing under a name nobody wrote.
 * A bare `.` may still follow (a sentence-ending period, stripped below); a `.` plus more filename
 * may not.
 */
/**
 * The extensions P2 resolves, spelled ONCE and matched case-INSENSITIVELY.
 *
 * Three copies of this alternation were maintained by hand and all three were lowercase-only, while
 * the file-type gate that decides a document is Markdown is `/i`. `./x.MD` therefore fell between
 * them: no scanner matched it, so it was neither checked nor announced.
 */
const PATH_EXT = 'md|markdown|ts|mts|cts|js|mjs|cjs|json|sh|bash|py'
const PATH_EXT_RE = new RegExp(`\\.(?:${PATH_EXT})$`, 'i')

const BARE_ABS_RE = new RegExp(
  `/(?:[A-Za-z0-9_.+-]+/)+[A-Za-z0-9_.+-]+\\.(?:${PATH_EXT})(?!\\.?[A-Za-z0-9_+-])`,
  'gi',
)

/**
 * `<skill>/agents/x-impl.md` is a TEMPLATE whose placeholder sits to the LEFT of the first slash,
 * so the absolute scanner matches only the `/agents/…` tail and announced a NOT CHECKED note about
 * a path appearing nowhere in the file — noise in the channel a reader is asked to audit.
 * `isPathTemplate` cannot see it, because by then the head is gone.
 *
 * Returns the placeholder head (`<skill>`, `[name]`) when the match at `index` is such a tail, so
 * the note names what was written. `${VAR}/…` is deliberately NOT here: the placeholder loop above
 * owns that form and already resolves or announces it.
 */
function templateHeadBefore(text: string, index: number): string | null {
  const close = index > 0 ? text[index - 1] : ''
  if (close !== '>' && close !== ']') return null
  const open = close === '>' ? '<' : '['
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  const openAt = text.lastIndexOf(open, index - 2)
  if (openAt < lineStart) return null
  const inner = text.slice(openAt + 1, index - 1)
  // A placeholder NAMES something: one word-ish run, no nesting, no whitespace. `](` — the ordinary
  // Markdown link, whose destination the relative loop owns — has an empty or bracketed inner and
  // is rejected here.
  if (!/^[A-Za-z0-9_. -]+$/.test(inner)) return null
  // `<code>/usr/bin/x.sh</code>` is an HTML ELEMENT abutting a real path, not a placeholder, and
  // reading it as one would turn a broken reference into a note. An element has a closing tag; a
  // placeholder does not.
  if (close === '>' && text.includes(`</${inner}>`)) return null
  return text.slice(openAt, index)
}

/** `href="…"` / `src="…"` in raw HTML, which Markdown documents here do use. */
const HTML_ATTR_RE = /\b(?:href|src)\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'>]+))/gi

/** A ref-def opener: `[label]:`, with CommonMark's ≤3 leading spaces. */
const REF_DEF_OPEN_RE = /^ {0,3}\[[^\]]*\]:[ \t]*(.*)$/

/**
 * CommonMark backslash escapes: a `\` before ASCII punctuation is the punctuation.
 *
 * `[a](./nope\_x.md)` names the file `nope_x.md`. Resolving the escape literally reported a
 * CRITICAL against a file that EXISTS, and its remedy — "create the file" — would have created a
 * second, wrongly-named one.
 */
export function unescapeDestination(raw: string): string {
  return raw.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

export type MarkdownRefForm = 'inline' | 'reference-definition' | 'html-attribute'

export interface MarkdownPathRef {
  /** The destination exactly as written — still escaped, fragment still attached. */
  raw: string
  /** Index into the SAME string that was scanned, so `lineOf` needs no offset arithmetic. */
  index: number
  form: MarkdownRefForm
}

/**
 * Parse an inline link destination starting at the `(` of `](`.
 *
 * Hand-written rather than another regex because the three forms a regex cannot express together
 * are exactly the three that were silently unchecked: a `<…>` destination containing a SPACE (the
 * only reason CommonMark has the angle form at all), a bare destination with BALANCED PARENS
 * (`./nope(1).md`), and backslash escapes. Each read as "no match", which is byte-identical to
 * "checked and clean".
 */
function parseInlineDestination(text: string, paren: number): { raw: string; end: number } | null {
  const n = text.length
  let i = paren + 1
  while (i < n && /[ \t\n]/.test(text[i])) i++
  let raw = ''
  if (text[i] === '<') {
    i++
    while (i < n && text[i] !== '>' && text[i] !== '\n') {
      if (text[i] === '\\' && i + 1 < n) {
        raw += text[i] + text[i + 1]
        i += 2
        continue
      }
      raw += text[i]
      i++
    }
    if (text[i] !== '>') return null
    i++
  } else {
    let depth = 0
    while (i < n) {
      const c = text[i]
      if (c === '\\' && i + 1 < n) {
        raw += c + text[i + 1]
        i += 2
        continue
      }
      if (/\s/.test(c)) break
      if (c === '(') depth++
      if (c === ')') {
        if (depth === 0) break
        depth--
      }
      raw += c
      i++
    }
  }
  if (raw === '') return null
  // The link must actually CLOSE, after an optional title. Without this test a stray `](` in prose
  // yields a destination the document never linked to.
  let j = i
  while (j < n && /\s/.test(text[j])) j++
  if (text[j] === '"' || text[j] === "'") {
    const q = text[j]
    j++
    while (j < n && text[j] !== q) j++
    if (text[j] !== q) return null
    j++
  } else if (text[j] === '(') {
    const at = text.indexOf(')', j)
    if (at === -1) return null
    j = at + 1
  }
  while (j < n && /\s/.test(text[j])) j++
  if (text[j] !== ')') return null
  return { raw, end: j + 1 }
}

/**
 * Every path-shaped reference a Markdown document makes, in ONE pass over ONE view, tagged by form.
 *
 * The forms are enumerated here rather than discovered one regex at a time, because a form nobody
 * enumerated is a form nobody checked — and a scanner that matches nothing reports CLEAN, which is
 * indistinguishable from a scanner that ran. Ordered so the explicit forms claim their spans first;
 * Each scanner marks the span it consumed, so `[a](./x.md)` is one reference and not two.
 */
export function markdownPathRefs(text: string): MarkdownPathRef[] {
  const refs: MarkdownPathRef[] = []
  const n = text.length
  const consumed = new Uint8Array(n)
  const claim = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) consumed[k] = 1
  }

  for (let i = 0; i + 1 < n; i++) {
    if (text[i] !== ']' || text[i + 1] !== '(') continue
    const d = parseInlineDestination(text, i + 1)
    if (d === null) continue
    const at = text.indexOf(d.raw, i + 1)
    refs.push({ raw: d.raw, index: at === -1 ? i + 2 : at, form: 'inline' })
    claim(i, d.end)
    i = d.end - 1
  }

  // Reference definitions, line by line: CommonMark allows the destination on the FOLLOWING line,
  // and a one-line regex read that as no ref-def at all rather than as one it could not resolve.
  const lines = text.split('\n')
  const starts: number[] = []
  {
    let off = 0
    for (const l of lines) {
      starts.push(off)
      off += l.length + 1
    }
  }
  for (let li = 0; li < lines.length; li++) {
    const m = REF_DEF_OPEN_RE.exec(lines[li])
    if (m === null) continue
    let destLine = li
    let rest = m[1]
    if (rest.trim() === '') {
      if (li + 1 >= lines.length || lines[li + 1].trim() === '') continue
      destLine = li + 1
      rest = lines[destLine]
    }
    // `rest` is a suffix of its own line in both branches, so its column is a length difference.
    let col = lines[destLine].length - rest.length
    const tok = rest.trimStart()
    col += rest.length - tok.length
    let raw: string
    if (tok.startsWith('<')) {
      const close = tok.indexOf('>')
      if (close === -1) continue
      raw = tok.slice(1, close)
      col += 1
    } else {
      raw = tok.split(/\s/)[0]
    }
    if (raw === '') continue
    const index = starts[destLine] + col
    if (consumed[index]) continue
    refs.push({ raw, index, form: 'reference-definition' })
    // The TOKEN, not the line. Claiming the whole line meant a `[label]:` followed by an ordinary
    // sentence swallowed every bare reference in that sentence — a silent loss of exactly the kind
    // this rebuild removes.
    claim(index, index + raw.length)
  }

  HTML_ATTR_RE.lastIndex = 0
  let h: RegExpExecArray | null
  while ((h = HTML_ATTR_RE.exec(text)) !== null) {
    const raw = h[1] ?? h[2] ?? h[3] ?? ''
    if (raw === '') continue
    const at = text.indexOf(raw, h.index)
    if (consumed[at]) continue
    refs.push({ raw, index: at, form: 'html-attribute' })
    claim(h.index, h.index + h[0].length)
  }

  // BARE-RELATIVE SCANNING IS DELIBERATELY ABSENT. It was built here and REMOVED after measuring it:
  //
  //   1. It cannot tell a live reference from prose. `**Example**: `scripts/rotate_pdf.py`` and
  //      `See `references/finance.md` for financial schemas` are illustrations, and it made both
  //      criticals — 9 against plugin-dev/skill-development and 6 against anthropic-skills'
  //      skill-creator, all against correct, shipped files. No narrowing on the directory's
  //      existence helps: those directories exist beside the file.
  //   2. Alone among P2's scanners this form has no anchor character, so it is the one that can hit
  //      the engine's backtracking cap — and when it does, `exec` returns null and the loop ENDS,
  //      silently abandoning the rest of the file. Measured: a line of 8000 `../` segments made a
  //      genuinely broken reference below it disappear while the run still reported CLEAN.
  //
  // (2) is the fail-open class this whole gate exists to prevent, and (1) is worse than a miss —
  // a gate that criticals correct code is one authors learn to ignore. A delimited form (a link, a
  // ref-def, an `href=`) carries the author's own signal that a path is meant; bare prose does not.
  // Do not reintroduce this without a signal that distinguishes the two.

  return refs
}

/** Directory to probe for existence, given a possibly-globbed resolved path. */
export function globProbeTarget(resolved: string): string {
  if (!resolved.includes('*')) return resolved
  const prefix = resolved.split('*')[0]
  // `dirname` alone drops a level when the prefix already ends at a separator, so
  // `<dir>/no-such-dir/*.md` probed `<dir>` — the PARENT of the directory that must hold the files.
  return prefix.endsWith(sep) ? prefix.slice(0, -1) || sep : dirname(prefix)
}

/**
 * P2 path-resolution — every path reference inside a skill must resolve on disk.
 *
 * Two scans, because the skill names paths two ways:
 *   (a) `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` placeholder references, and
 *   (b) BARE ABSOLUTE paths — the form this skill's own doctrine tells authors to PREFER, and the
 *       form P2 was blind to entirely.
 *
 * Scan (b) is deliberately narrow, because it is the run's largest false-positive surface: the path
 * must be absolute, must sit under a root this file actually belongs to (its skill dir, its plugin
 * root, or the user's home), and must carry a known extension. A path naming some other machine's
 * filesystem — an experiment log quoting `/tmp/...` — is not this skill's to verify.
 */
export function checkPathResolution(
  file: string,
  text: string,
  ctx: SkillContext,
  exemptions: readonly Exemption[],
  skips: UnresolvedRef[] = [],
): Finding[] {
  if (!Array.isArray(exemptions)) {
    throw new TypeError('checkPathResolution requires exemptions — they are parsed once, from the raw file')
  }
  const findings: Finding[] = []
  const seen = new Set<string>()

  // On a CODE file, a path inside a comment is illustration, not a reference the code makes.
  // `retarget-hooks.ts` documents its own transformation as
  // `${CLAUDE_PLUGIN_ROOT}/hooks/x.py -> ${CLAUDE_PLUGIN_ROOT}/hooks/x.ts`, where `x` is
  // metasyntactic; checking it reports two missing files nobody ever meant to ship. In Markdown the
  // opposite holds — prose IS the document, and a broken link in it is broken for every reader — so
  // this narrowing applies only where there is code to tell prose apart from.
  // NO comment narrowing for shell, Python, JSON or Markdown. A JS lexer over shell read `"$SRC"/*`
  // as an unterminated block comment and blinded the rest of the file; the seven-line `#` mask that
  // replaced it was unsound the other way (a `#` inside a string blinded the rest of the LINE).
  // Both failed SILENT. With no mask a path in a shell comment is over-checked, which fails LOUD —
  // an author sees a false critical and can declare an exemption. Only .ts/.js get the lexer, where
  // it is sound.
  const codeComments = LEXABLE_EXT_RE.test(file) ? scanLiterals(text).comment : null

  const fencedLines = MARKDOWN_EXT_RE.test(file) ? fencedLineSet(text) : new Set<number>()
  // SEPARATE from `seen`. Sharing one set made the FIRST occurrence of a path decide the verdict for
  // every later one: a fenced example above silenced an identical PROSE reference below (exit 0),
  // and reversing the two paragraphs produced exit 1 on the same claims. `never silent` failed in
  // both directions, and the verdict depended on document order.
  const seenNotes = new Set<string>()
  const report = (raw: string, resolved: string, index: number) => {
    if (codeComments && codeComments[index]) return
    const line = lineOf(text, index)
    if (isExemptAt(exemptions, 'paths', line)) return
    // ILLUSTRATION, NOT A CLAIM. A path inside a ``` fence is a worked example — that is what a
    // fence means — and the previous split (fenced Markdown links masked, fenced `${…}` and
    // absolute paths still CRITICAL) was reasoned, not measured. Measured: 68 criticals against
    // plugin-dev/command-development and 22 against plugin-structure, every one a `${CLAUDE_PLUGIN_ROOT}`
    // example inside a fence in a skill whose SUBJECT is that placeholder. A gate that criticals
    // correct documentation is one authors learn to ignore. Announced, so it is not silent either —
    // which the masking half of the old split WAS.
    // A fence alone is not enough to call something illustration. What separates the two is whether
    // the token is PORTABLE. `${CLAUDE_PLUGIN_ROOT}/scripts/analyze.js` or `[a](REFERENCE.md)` is
    // example syntax a reader adapts; `${CLAUDE_PLUGIN_ROOT}/skills/…/wc-probe.ts` is a fact
    // about THIS machine, and nobody illustrates with someone else's absolute path.
    //
    // A NOTE IS NOT A GATE, and this demotion is justified on its merits or not at all. The gate
    // reads the exit code; craft's mechanicalChecks agent is told to capture "the last ~2000
    // characters". So a demoted finding does not fail anything, and its note may not even reach the
    // report. The claim to weigh is that a critical against correct documentation is worse than a
    // miss here — not that the note makes it safe.
    //
    // The blanket version of this rule made the skill's OWN mechanicalChecks commands uncheckable:
    // they are absolute paths inside ```js fences, and renaming wc-probe.ts read CLEAN, exit 0,
    // where the pre-demotion probe returned two criticals. A fence that holds the literal command
    // the workflow runs verbatim is not an example of anything.
    if (fencedLines.has(line) && !raw.startsWith('/')) {
      if (seenNotes.has(resolved)) return
      seenNotes.add(resolved)
      skips.push({ rule: 'P2 path-resolution', file, line, token: raw,
        reason: 'it is a portable reference inside a fenced example, so it illustrates a path rather than claiming one' })
      return
    }
    if (seen.has(resolved)) return
    seen.add(resolved)
    findings.push({
      rule: 'P2 path-resolution',
      severity: 'critical',
      file,
      line,
      detail: `"${raw}" resolves to ${resolved}, which does not exist`,
      remedy: `fix the path or create the file — a reference that does not resolve fails only at the moment it is needed`,
    })
  }

  PLACEHOLDER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) {
    const varName = m[1]
    const tail = (m[2] ?? '').replace(/[.]+$/, '')
    if (!tail || tail === '/') continue // bare directory reference, nothing to resolve
    const raw = `\${${varName}}${tail}`
    // A DOCUMENTATION TEMPLATE, not a path. `${CLAUDE_SKILL_DIR}/../../skills/dev-[phase_name]/SKILL.md`
    // is how a skill writes "one of these" — and since `[` is outside the tail's character class,
    // the match STOPS there, leaving the stub `.../skills/dev-`. Resolving that stub reported a
    // path nobody wrote as a critical, taxing the ordinary way of documenting a family of files.
    // A template is one whose REFERENCE CONTINUES past the placeholder: `dev-[phase]/SKILL.md` and
    // `refs/[name].md` both resume with path after the closing bracket, so the match was a fragment
    // of a longer name. `scripts/guard<br>` and `gone.md[1]` do not — the path was complete and a
    // bracket merely followed it. Keying on a file extension instead classified every extensionless
    // reference (a script, a binary, a directory) as a fragment and swallowed it.
    const ended = text[m.index + m[0].length]
    const CLOSERS: Record<string, string> = { '[': ']', '<': '>', '{': '}' }
    const continuesPastPlaceholder = () => {
      const close = CLOSERS[ended!]
      const at = text.indexOf(close, m!.index + m![0].length)
      if (at === -1) return false
      // Only `/` or `.` — the characters that RESUME a path. Anything else after the placeholder
      // is prose, so the reference before it was complete. Fails closed on purpose: a false
      // critical is visible and fixable, a swallowed broken path is silent.
      const after = text[at + 1]
      return after === '/' || after === '.'
    }
    if (ended !== undefined && CLOSERS[ended] !== undefined && continuesPastPlaceholder()) {
      const line = lineOf(text, m.index)
      if (!(codeComments && codeComments[m.index]) && !isExemptAt(exemptions, 'paths', line)) {
        skips.push({
          rule: 'P2 path-resolution',
          file,
          line,
          token: `${raw}${ended}…`,
          reason: 'the path carries a documentation placeholder, so it names a family of files rather than one',
        })
      }
      continue
    }
    // A token still holding a variable this process cannot see is UNKNOWN, not broken — and the
    // skip is reported, exactly as P1 and P7 report theirs. P2 was the one path in the round that
    // gained `unresolvedVarIn` without gaining its channel, so `${CLAUDE_SKILL_DIR}/${VERSION}/x.md`
    // vanished from P2 in silence while P7 announced the same token on the line below.
    const variable = unresolvedVarIn(raw, ctx)
    if (variable !== null) {
      const line = lineOf(text, m.index)
      // Same narrowing as `report`: a path in a code comment is illustration, so there is no check
      // being skipped and nothing to announce.
      if (!(codeComments && codeComments[m.index]) && !isExemptAt(exemptions, 'paths', line)) {
        skips.push({ rule: 'P2 path-resolution', file, line, token: raw, reason: `${variable} is not resolvable here` })
      }
      continue
    }
    const resolved = resolveRefPath(raw, dirname(file), ctx)
    if (resolved === null) continue
    if (existsSync(globProbeTarget(resolved))) continue
    report(raw, resolved, m.index)
  }

  // ON A CODE FILE, `homedir()` IS NOT A ROOT. Markdown prose that names `~/dotfiles/x.md` is making
  // a claim to its reader, so a broken one is a defect. Code naming an absolute path under $HOME is
  // usually declaring a path it will WRITE, or a fixture it deliberately does not ship — and since
  // P2 was ungated onto `.ts`/`.js`, every one of those became a CRITICAL whose remedy ("create the
  // file") is wrong. Narrowing to the roots the file actually belongs to keeps what the ungating was
  // for — a script naming its own skill's missing `references/rules.md` still fails — and is the
  // same doctrine the docstring already states for `/tmp`.
  const isMarkdown = MARKDOWN_EXT_RE.test(file)
  const roots = [ctx.skillDir, ctx.pluginRoot, isMarkdown ? homedir() : null]
    .filter((r): r is string => !!r)
    .map(r => resolve(r))
  BARE_ABS_RE.lastIndex = 0
  while ((m = BARE_ABS_RE.exec(text)) !== null) {
    const prev = m.index > 0 ? text[m.index - 1] : ''
    // `~` was in this skip class, so `~/notes/x.md` matched, was discarded as a token tail, and was
    // neither checked nor announced — the silent class this rule exists to prevent, in the rule
    // itself. A leading `~/` is a HOME-rooted path, and $HOME is already one of the roots below for
    // a Markdown file, so resolve it instead of dropping it.
    const tilde = prev === '~' && !/[\w$}./\\-]/.test(m.index > 1 ? text[m.index - 2] : '')
    if (prev && !tilde && /[\w$}~./\\-]/.test(prev)) continue // a suffix of a longer token, or a ${VAR} tail
    const raw = (tilde ? '~' : '') + m[0].replace(/[.]+$/, '')
    const templateHead = templateHeadBefore(text, m.index)
    if (templateHead !== null) {
      const line = lineOf(text, m.index)
      if (!(codeComments && codeComments[m.index]) && !isExemptAt(exemptions, 'paths', line)) {
        skips.push({
          rule: 'P2 path-resolution',
          file,
          line,
          token: templateHead + raw,
          reason: 'the reference is a template, not a path',
        })
      }
      continue
    }
    const resolved = tilde ? resolve(homedir(), raw.slice(2)) : resolve(raw)
    // Same containment test, same root boundary: a root of `/` would otherwise match nothing and
    // silently drop every finding this loop exists to raise. REPORTED, not silent — every other P2
    // skip announces itself, and this one printed CLEAN over a path it had declined to check.
    if (!roots.some(r => isAtOrAbove(r, resolved))) {
      const line = lineOf(text, m.index)
      if (!(codeComments && codeComments[m.index]) && !isExemptAt(exemptions, 'paths', line)) {
        skips.push({
          rule: 'P2 path-resolution',
          file,
          line,
          token: raw,
          reason: 'the path lies outside this skill, its plugin root and $HOME, so this run says nothing about it',
        })
      }
      continue
    }
    if (existsSync(globProbeTarget(resolved))) continue
    report(raw, resolved, m.index)
  }

  // Relative Markdown references, resolved against the file's own directory.
  //
  // ONE extraction (`markdownPathRefs`) over ONE view, then ONE classification below. The previous
  // shape was a regex per form, each with its own quirks, and every widening of it produced a new
  // silently-unmatched form; the matrix in the suite is what this loop is written against.
  //
  // RAW text, like every other scanner here. Fenced hits are demoted to notes in `report`, so all
  // three loops now treat a fence the same way instead of one masking and two criticalling.
  if (MARKDOWN_EXT_RE.test(file)) {
    for (const ref of markdownPathRefs(text)) {
      const line = lineOf(text, ref.index)
      const note = (token: string, reason: string) => {
        if (codeComments && codeComments[ref.index]) return
        if (isExemptAt(exemptions, 'paths', line)) return
        skips.push({ rule: 'P2 path-resolution', file, line, token, reason })
      }
      // A fragment names a place INSIDE the destination, not a different file.
      const dest = unescapeDestination(ref.raw).replace(/#.*$/, '')
      // Not this loop's to resolve: a URL, a bare anchor, an absolute path (the loop above owns
      // those), or a placeholder-rooted reference (the loop above that one owns those).
      if (dest === '' || /^(?:[a-z][a-z0-9+.-]*:|#|\/|~|\$)/i.test(dest)) continue
      const variable = unresolvedVarIn(dest, ctx)
      if (isPathTemplate(dest) || variable !== null) {
        note(dest, variable !== null ? `${variable} is not resolvable here` : 'the link is a template, not a path')
        continue
      }
      // Extensionless destinations are a DOCUMENTED exclusion, not a silent one: `[x](./)` and
      // `[x](../sibling)` name a directory or a section, and this loop resolves files.
      if (!PATH_EXT_RE.test(dest)) continue
      const resolved = resolve(dirname(file), dest)
      // BARE-RELATIVE ONLY, and this narrowing is the whole false-positive budget of the form.
      if (existsSync(resolved)) continue
      report(dest, resolved, ref.index)
    }
  }

  return findings
}

// ---------------------------------------------------------------- P3

/** Frontmatter keys a SKILL.md cannot load usefully without. */
export const REQUIRED_FRONTMATTER_KEYS: readonly string[] = ['name', 'description']

/**
 * P3 frontmatter — a SKILL.md's frontmatter must parse, must declare the required keys, and may
 * use only documented keys.
 *
 * The presence test is not redundant with the allowlist loop: the loop only fires on keys NOT in
 * the list, so frontmatter declaring `name:` and nothing else scored zero findings. A missing
 * `description` is the highest-consequence and most silent SKILL.md defect there is — the skill
 * loads and never triggers — and it passed both this gate and the write-time hook.
 */
/**
 * P3 for an AGENT .md — the three conditions that decide whether the harness registers it at all.
 *
 * Separate from `checkFrontmatter` because that one is SKILL.md's: its messages name SKILL.md and
 * its documented-key vocabulary is a skill's, so an agent's `tools:`/`model:`/`color:` would read as
 * undocumented. Unknown keys are therefore NOT policed here; the load-bearing three are.
 *
 * Without this, an agent whose frontmatter never closes — which registers nothing, and whose guard
 * therefore never runs — was CLEAN at exit 0, with the coverage line asserting full reach over it.
 */
export function checkAgentFrontmatter(file: string, text: string): Finding[] {
  const fm = parseFrontmatter(text)
  if (!fm.hasFrontmatter) {
    return [{
      rule: 'P3 frontmatter',
      severity: 'critical',
      file,
      line: 1,
      detail: 'agent file has no YAML frontmatter, so it registers no agent and any hooks: guard on it never runs',
      remedy: 'add a --- fenced block declaring at least name and description',
    }]
  }
  if (!fm.ok) {
    return [{
      rule: 'P3 frontmatter',
      severity: 'critical',
      file,
      line: 1,
      detail: `agent frontmatter does not parse: ${fm.error} — an agent that does not parse registers nothing`,
      remedy: 'fix the YAML',
    }]
  }
  const findings: Finding[] = []
  for (const required of ['name', 'description']) {
    if (fm.keys.includes(required)) continue
    findings.push({
      rule: 'P3 frontmatter',
      severity: 'critical',
      file,
      line: 1,
      detail: `agent frontmatter does not declare the required key "${required}", so the harness registers no agent from it`,
      remedy: `add ${required}: to the frontmatter — an implementerAgentType naming an unregistered agent installs no guard`,
    })
  }
  return findings
}

export function checkFrontmatter(file: string, text: string): Finding[] {
  const findings: Finding[] = []
  const fm = parseFrontmatter(text)
  if (!fm.hasFrontmatter) {
    findings.push({
      rule: 'P3 frontmatter',
      severity: 'major',
      file,
      line: 1,
      detail: 'SKILL.md has no YAML frontmatter block',
      remedy: 'add a --- fenced frontmatter block with at least name and description',
    })
    return findings
  }
  if (!fm.ok) {
    findings.push({
      rule: 'P3 frontmatter',
      severity: 'critical',
      file,
      line: 1,
      detail: `frontmatter does not parse: ${fm.error}`,
      remedy: 'fix the YAML — an unparseable frontmatter means the skill does not load',
    })
    return findings
  }
  for (const required of REQUIRED_FRONTMATTER_KEYS) {
    if (fm.keys.includes(required)) continue
    findings.push({
      rule: 'P3 frontmatter',
      severity: 'critical',
      file,
      line: 1,
      detail: `frontmatter does not declare the required key "${required}"`,
      remedy: `add "${required}:" to the frontmatter — without name and description the skill either does not load or never triggers, and neither failure is visible from the file`,
    })
  }
  for (const k of fm.keys) {
    if (DOCUMENTED_FRONTMATTER_KEYS.includes(k)) continue
    findings.push({
      rule: 'P3 frontmatter',
      severity: 'major',
      file,
      line: 1,
      detail: `undocumented frontmatter key "${k}"`,
      remedy: `use only documented keys (${DOCUMENTED_FRONTMATTER_KEYS.join(', ')}) — an unrecognized key is silently ignored`,
    })
  }
  return findings
}

// ---------------------------------------------------------------- P4

/**
 * P4 anti-pattern — ${CLAUDE_PLUGIN_ROOT} in a NON-plugin skill/agent BODY.
 *
 * A PLUGIN-SHIPPED BODY IS EXEMPT, because there the token DOES substitute. Measured from the
 * shipped binary (2.1.226), not read off documentation, which does not describe it: the plugin
 * skill/command loader runs the body through `UTe(W,{path,source})` — `e.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g,
 * ()=>t.path)` — inside `getPromptForCommand`, and the plugin AGENT loader does the same to the
 * agent body (`T=UTe(u.trim(),{path:o,source:n})`). The non-plugin skill loader's own
 * `getPromptForCommand` substitutes ${CLAUDE_SKILL_DIR}/${CLAUDE_PROJECT_DIR}/${CLAUDE_SESSION_ID}
 * and never CLAUDE_PLUGIN_ROOT, so outside a plugin the token stays literal and the rule holds.
 *
 * `pluginShipped` defaults to the file's own position, so this surface and the write-time hook
 * cannot disagree about the same file.
 *
 * NOT a licence to relax P1's refusal of the token in an AGENT's `hooks:` block: the same binary
 * warns "Plugin agent file ... sets hooks, which is ignored for plugin agents", so there the token
 * cannot resolve to anything the harness runs, plugin-shipped or not.
 */
export function checkPluginRootInBody(file: string, text: string, pluginShipped?: boolean): Finding[] {
  const shipped = pluginShipped ?? findPluginRootOrNull(dirname(file)) !== null
  if (shipped) return []
  const findings: Finding[] = []
  const fm = parseFrontmatter(text)
  const body = text.slice(fm.bodyStart)
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    findings.push({
      rule: 'P4 anti-pattern',
      severity: 'major',
      file,
      line: lineOf(text, fm.bodyStart + m.index),
      detail: '${CLAUDE_PLUGIN_ROOT} appears in the body of a skill/agent that is NOT plugin-shipped, so nothing substitutes it there and it stays literal (a plugin-shipped body IS substituted; this file has no plugin manifest above it)',
      remedy: 'use an absolute path — or ${CLAUDE_SKILL_DIR} in a skill body — unless you ship the file inside a plugin, where the loader does substitute ${CLAUDE_PLUGIN_ROOT} in the body',
    })
  }
  return findings
}

// ---------------------------------------------------------------- P5

/**
 * The object literal a single-assignment identifier is bound to, or null.
 *
 * `const r = {...}; return r` is an ordinary way to write a return shape, and the version of P5 that
 * only read `return {` saw no implementing literal at all — so every documented key came back as
 * unimplemented. Following the binding is only sound when the name is written exactly once: one
 * `const`/`let`/`var` declaration with an object-literal initialiser and no later assignment. A
 * rebound name could hold anything by the time the return runs, so it is left unresolved.
 */
export function bindingObjectLiteral(src: string, masked: string, name: string): { start: number; end: number } | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null
  const decls = [...masked.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\{`, 'g'))]
  if (decls.length !== 1) return null
  // Any assignment beyond the declaration's own means the name is not single-assignment.
  const assigns = [...masked.matchAll(new RegExp(`(?<![\\w$.])${name}\\s*=(?![=>])`, 'g'))]
  if (assigns.length !== 1) return null
  const brace = masked.indexOf('{', decls[0].index!)
  const end = matchBrace(masked, brace)
  return end === -1 ? null : { start: brace, end }
}

/** A return shape stated in prose, a comment, or a Markdown code span. */
export interface DocumentedShape {
  index: number
  line: number
  keys: string[]
  /** True when the annotation lists the WHOLE shape: every comma element parsed as an identifier,
   *  and no `...` / `…` / `etc`. Only an exhaustive shape can be judged for completeness. */
  exhaustive: boolean
}

/**
 * The doc regex tolerates ONE code-span or quote delimiter between `returns` and `{`.
 *
 * Without it the rule never fired on the dominant real-world form. The corpus writes
 * ``It returns `{ … }` `` — a Markdown code span — and the backtick made `/[Rr]eturns?\s*\{/` miss
 * every one of them. It is deliberately NOT extended to balanced braces: `[^{}]*` keeps a nested
 * object out of the match rather than mis-parsing its inner keys as top-level ones.
 */
const DOC_SHAPE_RE = /[Rr]eturns?\s*[`'"]?\s*\{([^{}]*)\}/g

/**
 * Every documented return shape in `text`.
 *
 * The prose/code discriminator DEPENDS ON THE FILE TYPE, and getting that wrong is what made P5
 * vacuous on the only artifact this skill emits. In a JS/TS source, prose is what `maskLiterals`
 * blanks — a comment or a string. Markdown inverts that in both directions: plain prose is not
 * blanked, so it read as CODE and was skipped, while a ``` fence IS blanked (backticks parse as a
 * template literal), so real code read as DOCUMENTATION. Markdown therefore uses `fenceLineMap`
 * instead, and requires BOTH ends of the match to sit outside a fence — a shape inside a ```text
 * fence is sample output, not a contract, and one straddling a boundary is not a shape at all.
 */
export function documentedShapes(text: string, isMarkdown: boolean): DocumentedShape[] {
  const out: DocumentedShape[] = []
  const fence = isMarkdown ? fenceLineMap(text) : null
  const scan = isMarkdown ? null : scanLiterals(text)
  DOC_SHAPE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = DOC_SHAPE_RE.exec(text)) !== null) {
    const line = lineOf(text, m.index)
    if (fence) {
      if (fence[line] || fence[lineOf(text, m.index + m[0].length - 1)]) continue
    } else if (!scan!.comment[m.index]) {
      // In code, an annotation lives in a COMMENT. Accepting any blanked region — which is what
      // "masked here" meant — also accepted STRINGS, and a `return {` inside a template literal is
      // code a generator EMITS, not prose about this file's own return. `emit-implementation-
      // workflow.ts` documented four keys that belong to the script it writes out, while its own
      // contract is `{path, source}`; the mask was right and the inference from it was wrong.
      continue
    }
    const elements = m[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '')
    const keys = elements.map(s => s.replace(/[?:].*$/, '').trim()).filter(s => /^[A-Za-z_$][\w$]*$/.test(s))
    if (keys.length === 0) continue
    out.push({ index: m.index, line, keys, exhaustive: keys.length === elements.length && !/\.\.\.|…|\betc\b/.test(m[1]) })
  }
  return out
}

/** How a `scriptPath` string resolved. */
export type ScriptTargetKind = 'resolved' | 'missing' | 'placeholder' | 'unsubstituted'

export interface ScriptTarget {
  kind: ScriptTargetKind
  raw: string
  line: number
  /** Set for `resolved` and `missing`. */
  path?: string
}

export interface ScriptPathRef {
  raw: string
  index: number
  line: number
}

/**
 * Every `scriptPath: "..."` in RAW text, fences included.
 *
 * Raw, not the code view, because the reference and the shape that documents it sit on opposite
 * sides of the fence boundary: the shape is prose, the call is fenced.
 *
 * A bare `Workflow({name: "..."})` is deliberately NOT collected. Resolving a bare name to a path
 * would infer a file the document never wrote, and a mis-inferred target is worse than no target:
 * it produces confident findings about a script nobody named.
 */
export function findScriptPathRefs(text: string): ScriptPathRef[] {
  const out: ScriptPathRef[] = []
  const re = /\bscriptPath\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ raw: m[2], index: m.index, line: lineOf(text, m.index) })
  return out
}

/**
 * Classify one `scriptPath` value.
 *
 * The placeholder test runs FIRST and on purpose. `"<absolute path>.js"` is a prose stand-in, not a
 * path that failed to resolve, and reporting it as missing would flag every worked example in every
 * document this skill has ever written. `${genDir}/w.js` is a different thing again — a real path
 * whose variable this process cannot see — and gets its own kind rather than being called missing.
 */
export function resolveScriptTarget(raw: string, baseDir: string, ctx: SkillContext, line = 0): ScriptTarget {
  // The SAME rule P2 uses. These were two rules over one string: P5 treated any `<...>` as a
  // placeholder and never `[...]`, P2 the reverse-ish, so one call site drew a P2 skip note and a
  // P5 drift finding about the same token in the same file.
  if (isPathTemplate(raw)) return { kind: 'placeholder', raw, line }
  if (unresolvedVarIn(raw, ctx) !== null) return { kind: 'unsubstituted', raw, line }
  const path = resolveRefPath(raw, baseDir, ctx)
  if (path === null) return { kind: 'unsubstituted', raw, line }
  return { kind: existsSync(path) ? 'resolved' : 'missing', raw, line, path }
}

export interface ContractReturn {
  path: string
  /** How many returns at indentation zero the file has. */
  returns: number
  /** Union of their top-level keys. */
  keys: string[]
  /** True when some top-level return spreads another object at BRACE DEPTH ZERO. */
  topLevelSpread: boolean
}

/** An object literal that some `return` hands back, and the form it was written in. */
export interface ReturnLiteral {
  form: 'literal' | 'binding' | 'arrow'
  /** Index of the construct (the `return` keyword, or the `=>`). */
  index: number
  /** Span of the object literal itself. */
  start: number
  end: number
}

/**
 * EVERY object literal a `return` hands back, in all three forms a real file uses.
 *
 * ONE list, consumed by BOTH halves of P5. They previously had their own: `sameFileDrift` learned
 * `const r = {…}; return r` and `=> ({…})`, `contractReturn` learned neither, so a Markdown file
 * whose script returned a bound object was told "nothing implements the documented contract" —
 * claimed-absent-when-present, the exact failure the arrow fix had just closed on the other path.
 * Callers filter this list; they do not re-derive it.
 */
export function returnLiterals(src: string, masked: string): ReturnLiteral[] {
  const out: ReturnLiteral[] = []
  const spanAt = (from: number) => {
    const brace = masked.indexOf('{', from)
    if (brace === -1) return null
    const end = matchBrace(masked, brace)
    return end === -1 ? null : { start: brace, end }
  }
  let m: RegExpExecArray | null
  const literalRe = /\breturn\s*\{/g
  while ((m = literalRe.exec(masked)) !== null) {
    const s = spanAt(m.index)
    if (s) out.push({ form: 'literal', index: m.index, ...s })
  }
  const arrowRe = /=>\s*\(\s*\{/g
  while ((m = arrowRe.exec(masked)) !== null) {
    const s = spanAt(m.index)
    if (s) out.push({ form: 'arrow', index: m.index, ...s })
  }
  const bindingRe = /\breturn\s+([A-Za-z_$][\w$]*)\s*[;\n]/g
  while ((m = bindingRe.exec(masked)) !== null) {
    const s = bindingObjectLiteral(src, masked, m[1])
    if (s) out.push({ form: 'binding', index: m.index, ...s })
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * True when the literal spreads another object at BRACE DEPTH ZERO.
 *
 * Depth-aware, and shared, because the naive whole-slice `/\.\.\./` reads
 * `carriedForward: [...CARRIED.keys()]` — a spread inside an array VALUE, at depth 1 — as a
 * top-level spread. `contractReturn` was made depth-aware and `sameFileDrift` was left on the naive
 * test, so the two halves of P5 disagreed about the same construct and one of them silently
 * downgraded every finding on such a file to `minor`.
 */
export function hasTopLevelSpread(masked: string, start: number, end: number): boolean {
  let depth = 0
  for (let i = start + 1; i < end; i++) {
    const c = masked[i]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (depth === 0 && c === '.' && masked.startsWith('...', i)) return true
  }
  return false
}

/**
 * True when this return is the module wrapper's own, not a helper's or a callback's.
 *
 * The `return` KEYWORD must sit in column 0. Testing the LINE instead is wrong: `function h(){
 * return {…} }` begins in column 0 and would smuggle a helper's shape into the contract.
 *
 * ARROWS ARE EXCLUDED, and this asymmetry with `sameFileDrift` is deliberate and MEASURED. An
 * arrow's implicit return is never in column 0 itself, so the only available test is that its line
 * is — and on the real corpus that admits top-level `const x = items.map(s => ({…}))` callbacks:
 * it put `id, key, slides` into `workshop-generate.js`'s contract and five more keys into
 * `writing-verify.js`'s, none of which any caller sees. Inflating a contract cuts both ways — it
 * softens direction A silently and invents direction B findings — so a form that cannot be located
 * precisely is better left out. A Workflow script hands its value over with a top-level `return`.
 */
function isModuleReturn(masked: string, r: ReturnLiteral): boolean {
  if (r.form === 'arrow') return false
  return r.index === 0 || masked[r.index - 1] === '\n'
}

export function contractReturn(src: string, path = ''): ContractReturn {
  const masked = maskLiterals(src)
  const keys = new Set<string>()
  let returns = 0
  let topLevelSpread = false
  for (const r of returnLiterals(src, masked)) {
    // Indentation zero is the only place a module wrapper can hand a value to its caller. A
    // helper's early return has a shape of its own, and unioning it puts keys in the contract no
    // caller ever sees.
    if (!isModuleReturn(masked, r)) continue
    returns++
    for (const k of objectTopLevelKeys(src, masked, r.start, r.end, true)) keys.add(k)
    if (hasTopLevelSpread(masked, r.start, r.end)) topLevelSpread = true
  }
  return { path, returns, keys: [...keys].sort(), topLevelSpread }
}

export interface ReturnDriftOptions {
  /** Parsed ONCE from the raw file by `runProbe` and threaded in. Never re-parsed here. */
  exemptions: readonly Exemption[]
  /** Markdown only: read the contract return of a resolved target, with caching and reporting. */
  contractFor?: (target: ScriptTarget) => ContractReturn | null
  /** Markdown only: record a check that did not run, so no suppression is silent. */
  note?: (ref: UnresolvedRef) => void
  ctx?: SkillContext
}

/**
 * P5 return-shape drift — a documented return shape and the return that implements it must agree.
 *
 * Two paths, because the two artifact kinds put the contract in different places:
 *
 *   .ts / .js   the documented shape and the implementing `return {` are in the SAME file.
 *   .md         they are NOT. The shape is prose in a SKILL.md; the return lives in the workflow
 *               script the file's `Workflow({scriptPath})` names. P5 follows the reference. This is
 *               the live defect the rule exists for: 10 of 12 documented shapes in the spine corpus
 *               describe a script the skill does not own, so no same-file rule could ever see them.
 *
 * There is deliberately no empty-set escape. A documented shape with no implementing return at all
 * used to pass every key vacuously — the empty-set-passes class gate-laws L2(a) forbids.
 */
export function checkReturnShapeDrift(file: string, text: string, opts: ReturnDriftOptions): Finding[] {
  if (!Array.isArray(opts?.exemptions)) {
    throw new TypeError('checkReturnShapeDrift requires opts.exemptions — exemptions are parsed once, in runProbe')
  }
  const isMarkdown = MARKDOWN_EXT_RE.test(file)
  const shapes = documentedShapes(text, isMarkdown).filter(s => !isExemptAt(opts.exemptions, 'returns', s.line))
  if (shapes.length === 0) return []
  return isMarkdown ? crossFileDrift(file, text, shapes, opts) : sameFileDrift(file, text, shapes)
}

/** The `.ts`/`.js` path: the implementing return is in this file. */
function sameFileDrift(file: string, text: string, shapes: DocumentedShape[]): Finding[] {
  const findings: Finding[] = []
  const masked = maskLiterals(text)

  // Paren depth BEFORE each index, computed once. Depth 0 means "not inside a call argument or a
  // parameter list" — i.e. a return belonging to the enclosing function rather than to a callback
  // passed into one. One linear pass: recomputing per match was a clean O(n²), 1.16s for 8000
  // arrows against 7.8ms for 500.
  const depthBefore = new Int32Array(masked.length + 1)
  for (let i = 0, d = 0; i < masked.length; i++) {
    depthBefore[i] = d
    const ch = masked[i]
    if (ch === '(') d++
    else if (ch === ')') d = Math.max(0, d - 1)
  }

  // DIRECT = the enclosing function's own returns. NESTED = returns from a callback inside a call.
  //
  // Splitting them, rather than gating one clause, is what closes the whole family. Gating only the
  // concise-arrow form left its block-body twin — `items.map(x => { return {…} })` — reproducing the
  // defect verbatim, and *dropping* a nested return outright made `defineWorkflow(() => ({…}))`
  // report "this file contains no return {...} literal at all", which is flatly false.
  //
  // The FORMS come from `returnLiterals`, shared with `contractReturn`, and the spread test from
  // `hasTopLevelSpread`, likewise. Both halves of P5 used to keep their own copies and drifted apart
  // in both places at once. `includeShorthand` is ON: this is real code and these are real keys.
  const direct = new Set<string>()
  const nested = new Set<string>()
  for (const r of returnLiterals(text, masked)) {
    const set = depthBefore[r.index] === 0 ? direct : nested
    for (const k of objectTopLevelKeys(text, masked, r.start, r.end, true)) set.add(k)
    if (hasTopLevelSpread(masked, r.start, r.end)) set.add('__spread__')
  }

  // When the file has NO direct return, its value is produced some other way — wrapped in a
  // `defineWorkflow(...)` call, say. Judging against an empty set would report every documented key
  // as unimplemented, so fall back to the nested set and say the contract could not be located.
  const indirect = direct.size === 0 && nested.size > 0
  const contract = indirect ? nested : direct
  const hasSpread = contract.has('__spread__')
  const actualKeys = [...contract].filter(x => x !== '__spread__').sort()

  for (const shape of shapes) {
    for (const k of shape.keys) {
      if (contract.has(k)) continue
      // Returned, but only from a callback the enclosing function passes into a call. That is not
      // this function's contract, so it is still drift — but say which it is rather than claiming
      // the key appears nowhere.
      const onlyNested = !indirect && nested.has(k)
      findings.push({
        rule: 'P5 return-shape drift',
        severity: hasSpread || onlyNested ? 'minor' : 'major',
        file,
        line: shape.line,
        detail: onlyNested
          ? `documented return key "${k}" is returned only from a nested callback, not from this file's own return (its own return: ${actualKeys.join(', ') || 'none'})`
          : actualKeys.length === 0
            ? `documented return key "${k}" has no implementation: this file contains no return {...} literal at all`
            : `documented return key "${k}" is not among the keys of any actual return {...} in this file (actual: ${actualKeys.join(', ')}${indirect ? '; located indirectly — this file has no top-level return' : ''})`,
        remedy: 'make the documented return shape and the actual return agree — the documented shape is the contract callers and selectors are written against',
      })
    }
  }
  return findings
}

/**
 * The `.md` path: the implementing return is in the script the file's `scriptPath` names.
 *
 * A shape binds to the NEAREST PRECEDING `scriptPath`, else the nearest following one — documents
 * introduce the call and then describe what it gives back. Every finding quotes the resolved path,
 * so a mis-bind is visible to a reader rather than being an invisible premise of the verdict.
 */
function crossFileDrift(file: string, text: string, shapes: DocumentedShape[], opts: ReturnDriftOptions): Finding[] {
  const findings: Finding[] = []
  const refs = findScriptPathRefs(text)
  const ctx = opts.ctx ?? skillContextFor(file, dirname(file))
  const note = (line: number, token: string, reason: string) =>
    opts.note?.({ rule: 'P5 return-shape drift', file, line, token, reason })

  for (const shape of shapes) {
    const before = refs.filter(r => r.index < shape.index).pop()
    const ref = before ?? refs.find(r => r.index > shape.index)
    if (!ref) {
      note(shape.line, shape.keys.join(', '), 'the file documents a return shape but names no scriptPath to compare it against')
      continue
    }
    const target = resolveScriptTarget(ref.raw, dirname(file), ctx, ref.line)
    if (target.kind === 'placeholder' || target.kind === 'unsubstituted') {
      note(shape.line, ref.raw, `the scriptPath at line ${ref.line} is a ${target.kind} reference, so its contract cannot be read`)
      continue
    }
    if (target.kind === 'missing') {
      findings.push({
        rule: 'P5 return-shape drift',
        severity: 'major',
        file,
        line: shape.line,
        detail: `the documented return shape names ${target.path} through the scriptPath at line ${ref.line}, and that file does not exist`,
        remedy: 'point scriptPath at the script that implements the shape — a documented contract with no implementing file behind it is checked by nothing',
      })
      continue
    }
    const contract = opts.contractFor?.(target) ?? null
    if (contract === null) {
      note(shape.line, target.path!, 'the target script could not be read')
      continue
    }
    if (contract.returns === 0) {
      findings.push({
        rule: 'P5 return-shape drift',
        severity: 'major',
        file,
        line: shape.line,
        detail: `the documented return shape names ${target.path}, and that file has no return {...} at indentation zero — nothing implements the documented contract`,
        remedy: 'give the script a top-level return, or document the shape where the return actually is',
      })
      continue
    }

    // Direction A — documented, but not in the contract.
    const absent = shape.keys.filter(k => !contract.keys.includes(k))
    if (absent.length > 0) {
      findings.push({
        rule: 'P5 return-shape drift',
        severity: contract.topLevelSpread ? 'minor' : 'major',
        file,
        line: shape.line,
        detail: `documented return key(s) ${absent.map(k => `"${k}"`).join(', ')} are not returned by ${target.path} (its contract return: ${contract.keys.join(', ')})`,
        remedy: 'make the documented shape and the script’s top-level return agree — the documented shape is the contract callers and selectors are written against',
      })
    }

    // Direction B — in the contract, but undocumented. Gated, because every gate here is a claim
    // that the documented list is meant to be complete: an inexhaustive annotation, a script with
    // more than one top-level return, or a spread all make "missing" unknowable rather than false.
    if (!shape.exhaustive) {
      note(shape.line, target.path!, 'the documented shape is not exhaustive, so undocumented contract keys cannot be judged')
      continue
    }
    if (contract.returns > 1) {
      note(shape.line, target.path!, `the target has ${contract.returns} top-level returns; their keys are unioned and completeness is not judged`)
      continue
    }
    if (contract.topLevelSpread) {
      note(shape.line, target.path!, 'the target’s return spreads another object at top level, so its full key set is unknown')
      continue
    }
    const undocumented = contract.keys.filter(k => !shape.keys.includes(k))
    if (undocumented.length > 0) {
      findings.push({
        rule: 'P5 return-shape drift',
        severity: 'major',
        file,
        line: shape.line,
        detail: `${target.path} returns key(s) ${undocumented.map(k => `"${k}"`).join(', ')} that this documented shape does not list (documented: ${shape.keys.join(', ')})`,
        remedy: 'add the keys to the documented shape — a caller written against the documentation cannot consume a channel the documentation does not mention',
      })
    }
  }
  return findings
}

// ---------------------------------------------------------------- P6

/**
 * P6 bare-name workflow refs — implementWorkflow / verifyWorkflow / workflow()
 * given a bare string. A bare name resolves only through .claude/workflows/, so
 * a script shipped anywhere else is unreachable by its own name.
 */
export function checkBareWorkflowRefs(file: string, text: string, exemptions: readonly Exemption[]): Finding[] {
  if (!Array.isArray(exemptions)) {
    throw new TypeError('checkBareWorkflowRefs requires exemptions — they are parsed once, from the raw file')
  }
  const findings: Finding[] = []
  const masked = maskLiterals(text)

  /** A string value is resolved as a workflow NAME whatever it looks like — but say which it is. */
  const describe = (value: string) =>
    value.includes('/')
      ? `the path string ${JSON.stringify(value)}, which is resolved as a workflow NAME, not as a path`
      : `the bare name ${JSON.stringify(value)}`

  const emit = (index: number, detail: string, remedy: string) => {
    const line = lineOf(text, index)
    if (isExemptAt(exemptions, 'workflow-refs', line)) return
    findings.push({ rule: 'P6 bare-name workflow refs', severity: 'critical', file, line, detail, remedy })
  }

  const valueAt = (quotePos: number) => {
    const quote = text[quotePos]
    const close = text.indexOf(quote, quotePos + 1)
    return close === -1 ? '' : text.slice(quotePos + 1, close)
  }

  const keyRe = /\b(implementWorkflow|verifyWorkflow)\s*:\s*(['"`])/g
  let m: RegExpExecArray | null
  while ((m = keyRe.exec(masked)) !== null) {
    const value = valueAt(m.index + m[0].length - 1)
    emit(
      m.index,
      `${m[1]} is given ${describe(value)}, where {scriptPath: ...} is required`,
      `write ${m[1]}: { scriptPath: "<absolute or resolved path>.js" } — a string value resolves only through .claude/workflows/, so a script shipped elsewhere is unreachable`,
    )
  }
  const callRe = /\b[Ww]orkflow\s*\(\s*(['"`])/g
  while ((m = callRe.exec(masked)) !== null) {
    const value = valueAt(m.index + m[0].length - 1)
    emit(
      m.index,
      `Workflow() is called with ${describe(value)}, where {scriptPath, args} is required`,
      'call Workflow({ scriptPath: "<path>.js", args: {...} })',
    )
  }

  // The OBJECT form. Both regexes above require a QUOTE right after the colon/paren, so the exact
  // spelling this skill's doctrine names as the canonical wrong move — `Workflow({name: "x"})` —
  // walked through the gate untouched: the value is an object, not a string, and nothing matched.
  // What makes it wrong is the KEY SET, not the value's shape. A `name` with no `scriptPath`
  // resolves only through .claude/workflows/, exactly as the bare string does.
  //
  // This reuses `matchBrace` + `objectTopLevelKeys` rather than parsing: `objectTopLevelKeys`
  // already knows that only the token at the start of an entry is a key, and already skips nested
  // depth, so `{scriptPath, args: {name: "x"}}` reads as `scriptPath, args` and stays clean.
  const flagObject = (at: number, brace: number, subject: string, remedy: string) => {
    const close = matchBrace(masked, brace)
    if (close === -1) return
    // `includeShorthand: true` — real code, real channels, the condition `objectTopLevelKeys`
    // documents. With it off a shorthand key counted as no key, so `{name, scriptPath}` was flagged
    // and `Workflow({name})` went clean. A doc's `{ id, name, work }` sketch sits nested under
    // `tasks` and is never a top-level key here.
    const keys = objectTopLevelKeys(text, masked, brace, close, true)
    // `scriptPath` present is the correct call, whether or not `name` rides along — the plan pins
    // BOTH `{scriptPath}` alone and `{name, scriptPath}` together as producing no finding.
    if (!keys.includes('name') || keys.includes('scriptPath')) return
    const span = findKeyValueSpan(text, masked, { start: brace, end: close + 1, keys }, 'name')
    const value = span ? stringLiteralsIn(text, span.start, span.end)[0] : undefined
    const named = value === undefined ? 'a name key' : `the bare name ${JSON.stringify(value)}`
    emit(at, `${subject} is given an object carrying ${named} and no scriptPath`, remedy)
  }

  const objKeyRe = /\b(implementWorkflow|verifyWorkflow)\s*:\s*\{/g
  while ((m = objKeyRe.exec(masked)) !== null) {
    flagObject(
      m.index,
      m.index + m[0].length - 1,
      m[1],
      `write ${m[1]}: { scriptPath: "<absolute or resolved path>.js" } — a name resolves only through .claude/workflows/, so a script shipped elsewhere is unreachable by its own meta.name`,
    )
  }
  const objCallRe = /\b[Ww]orkflow\s*\(\s*\{/g
  while ((m = objCallRe.exec(masked)) !== null) {
    flagObject(
      m.index,
      m.index + m[0].length - 1,
      'Workflow()',
      'call Workflow({ scriptPath: "<path>.js", args: {...} }) — a name resolves only through .claude/workflows/, so a script shipped alongside a skill is unreachable by its own meta.name',
    )
  }
  return findings
}

// P8 fence labelling was REMOVED. It required a `Workflow(` call to sit in a fence labelled `js`,
// and it was authored against a corpus that does not do that — most real call sites are in a bare
// fence. `isCodeFence` now decides by content, so the label carries no gate meaning and a rule
// enforcing it would only fail files that are correct.

// ---------------------------------------------------------------- P7

/** True when an object literal's keys look like a craft task row. */
export function isTaskRow(keys: string[]): boolean {
  const has = (k: string) => keys.includes(k)
  return has('id') && (has('work') || has('writablePaths') || has('acceptance'))
}

/** True when an object literal's keys look like a review lens. */
export function isLens(keys: string[]): boolean {
  const has = (k: string) => keys.includes(k)
  return has('key') && has('prompt')
}

/**
 * P7 refs declaration — every task row and every lens must declare a `refs` key
 * (refs: [] is CLEAN; an absent key is a finding, because an omission cannot be
 * told apart from a forgotten one), and every declared ref must resolve.
 */
export function checkRefsDeclaration(
  file: string,
  text: string,
  target: string,
  exemptions: readonly Exemption[],
  ctx?: SkillContext,
  skips: UnresolvedRef[] = [],
): Finding[] {
  if (!Array.isArray(exemptions)) {
    throw new TypeError('checkRefsDeclaration requires exemptions — they are parsed once, from the raw file')
  }
  const findings: Finding[] = []
  const context = ctx ?? skillContextFor(file, target)
  const masked = maskLiterals(text)
  for (const obj of findObjectLiterals(text)) {
    const kind = isTaskRow(obj.keys) ? 'task row' : isLens(obj.keys) ? 'lens' : null
    if (!kind) continue
    if (isExemptAt(exemptions, 'refs', lineOf(text, obj.start))) continue
    const idSpan = findKeyValueSpan(text, masked, obj, kind === 'task row' ? 'id' : 'key')
    const label = idSpan ? (stringLiteralsIn(text, idSpan.start, idSpan.end)[0] ?? '?') : '?'
    if (!obj.keys.includes('refs')) {
      findings.push({
        rule: 'P7 refs declaration',
        severity: 'major',
        file,
        line: lineOf(text, obj.start),
        detail: `${kind} (${JSON.stringify(label)}) does not declare a refs key`,
        remedy: 'declare refs explicitly — refs: [] states "this one has no domain rules"; an absent key cannot be told apart from a forgotten one',
      })
      continue
    }
    // resolve every declared ref
    const refsPos = findKeyValueSpan(text, masked, obj, 'refs')
    if (!refsPos) continue
    for (const raw of stringLiteralsIn(text, refsPos.start, refsPos.end)) {
      const variable = unresolvedVarIn(raw, context)
      if (variable !== null) {
        skips.push({
          rule: 'P7 refs declaration',
          file,
          line: lineOf(text, refsPos.start),
          token: raw,
          reason: `${variable} is not resolvable here`,
        })
        continue
      }
      const resolved = resolveRefPath(raw, dirname(file), context)
      if (resolved === null) continue
      if (existsSync(resolved)) continue
      findings.push({
        rule: 'P7 refs declaration',
        severity: 'major',
        file,
        line: lineOf(text, refsPos.start),
        detail: `${kind} (${JSON.stringify(label)}) declares ref ${JSON.stringify(raw)}, which resolves to ${resolved} and does not exist`,
        remedy: 'point refs at a file that exists — a ref the agent cannot Read delivers no rule at all',
      })
    }
  }
  return findings
}

/** Span of the value for `key` inside an object literal, or null. */
export function findKeyValueSpan(
  src: string,
  masked: string,
  obj: ObjectLiteral,
  key: string,
): { start: number; end: number } | null {
  let depth = 0
  // Only the token at the START of an entry can be a key — the same guard `objectTopLevelKeys` got,
  // and for the same reason. Without it a VALUE identifier is read as a key: in
  // `{ id: "t1", prompt: flag ? refs : other, refs: ["real.md"] }` the ternary's `refs` branch
  // matched first, so P7 checked whether `other` resolved and never looked at the declared ref.
  let expectKey = true
  for (let i = obj.start + 1; i < obj.end - 1; i++) {
    const c = masked[i]
    if (c === '{' || c === '[' || c === '(') {
      depth++
      continue
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--
      continue
    }
    if (depth !== 0) continue
    if (c === ',') {
      expectKey = true
      continue
    }
    if (!expectKey) continue
    if (!/[A-Za-z_$'"]/.test(c)) continue
    let name: string
    let after: number
    if (c === "'" || c === '"') {
      const close = masked.indexOf(c, i + 1)
      if (close === -1) break
      name = src.slice(i + 1, close)
      after = close + 1
    } else {
      let j = i
      while (j < obj.end && /[\w$]/.test(masked[j])) j++
      name = src.slice(i, j)
      after = j
    }
    let k = after
    while (k < obj.end && /\s/.test(masked[k])) k++
    if (masked[k] !== ':') {
      expectKey = false
      i = after - 1
      continue
    }
    expectKey = false
    k++
    while (k < obj.end && /\s/.test(masked[k])) k++
    if (name !== key) {
      i = k - 1
      continue
    }
    if (masked[k] === '[') {
      let d = 0
      for (let e = k; e < obj.end; e++) {
        if (masked[e] === '[') d++
        else if (masked[e] === ']') {
          d--
          if (d === 0) return { start: k, end: e + 1 }
        }
      }
      return null
    }
    // non-array value: take to the next top-level comma or the closing brace
    let d = 0
    for (let e = k; e < obj.end; e++) {
      const ch = masked[e]
      if ('{[('.includes(ch)) d++
      else if ('}])'.includes(ch)) {
        if (d === 0) return { start: k, end: e }
        d--
      } else if (ch === ',' && d === 0) return { start: k, end: e }
    }
    return null
  }
  return null
}

// ---------------------------------------------------------------- P10 / P11

/** One craft args object, as read out of one fenced block of a Markdown file. */
export interface CraftArgsFence {
  /** 1-based file line of the fence's opening delimiter. */
  fenceLine: number
  /** Entries in `mechanicalChecks`, or null when the fence declares no such key. */
  mechanicalCount: number | null
  /** 1-based file line of the `mechanicalChecks` value. */
  mechanicalLine: number | null
  /** Sorted `reviewLenses[].key` values. An ABSENT key yields `[]`, not null: craft reads an absent
   *  or empty array as its own two defaults, so omitting it declares a lens set rather than none. */
  lensKeys: string[]
  /** The `projectDir` STRING LITERAL, or null when the key is absent or written as a shorthand /
   *  identifier — a value this file does not spell out is a value the probe cannot judge. */
  projectDir: string | null
  /** 1-based file line of that literal. */
  projectDirLine: number | null
  /** `tasks[].id` string literals. An absent `tasks` key and `tasks: []` both yield `[]` — P13
   *  skips both, because a `readOnly` charter legitimately carries no work order. */
  taskIds: string[]
  /** Instance ids this fence enumerates, deduplicated, each with the arrays that named it. */
  instanceIds: InstanceId[]
}

/** One instance the fence fans out over, and every array of the fence that enumerated it. */
export interface InstanceId {
  /** A run of digits. See `INSTANCE_ID_SOURCES` for why the id-space is numeric only. */
  id: string
  /** Sorted array names, for the finding that has to say where the id came from. */
  sources: string[]
}

/**
 * How an instance id is read out of a fence, and why each is a run of DIGITS.
 *
 * A fan-out id has no declared syntax anywhere in craft — it is whatever the caller wrote into a
 * lens key, an item line and a `--lecture` spec. Digits are the one shape all three carry in the
 * corpus and the one shape that can be matched back against a task id without guessing: a lens key
 * suffix that is not numeric (`scope-fidelity`, `source-first`) is a lens NAME, not an instance, and
 * treating it as one manufactures a missing task row for every lens a workflow declares.
 */
const INSTANCE_ID_SOURCES = {
  mech: 'mechanicalChecks cmd',
  lens: 'reviewLenses[].key',
  scored: 'scoredChecks[].items',
} as const

/** Direct object elements of the array at `span` declaring `key`; a nested match is not an element. */
function directElements(
  literals: readonly ObjectLiteral[],
  span: { start: number; end: number },
  key: string,
): ObjectLiteral[] {
  const inside = literals.filter(o => o.start > span.start && o.end <= span.end && o.keys.includes(key))
  return inside.filter(o => !inside.some(p => p !== o && p.start < o.start && p.end >= o.end))
}

/** Top-level elements of the array literal at `span`, ignoring a trailing comma. */
export function arrayElementCount(masked: string, span: { start: number; end: number }): number {
  if (masked[span.start] !== '[') return 0
  let depth = 0
  let count = 0
  let content = false
  for (let i = span.start + 1; i < span.end - 1; i++) {
    const c = masked[i]
    if ('[{('.includes(c)) {
      depth++
      content = true
      continue
    }
    if (']})'.includes(c)) {
      depth--
      continue
    }
    if (depth === 0 && c === ',') {
      if (content) count++
      content = false
      continue
    }
    if (!/\s/.test(c)) content = true
  }
  return content ? count + 1 : count
}

/**
 * Every craft args object emitted in a fenced block, one per object.
 *
 * A CODE fence only (`isCodeFence`), and the object must declare `mechanicalChecks` or
 * `reviewLenses` — the two keys that make an args object the thing craft is dispatched with.
 */
export function craftArgsFences(text: string): CraftArgsFence[] {
  const out: CraftArgsFence[] = []
  for (const block of fencedBlocks(text)) {
    if (!isCodeFence(block)) continue
    const body = block.body
    const masked = maskLiterals(body)
    const literals = findObjectLiterals(body)
    for (const obj of literals) {
      if (!obj.keys.includes('mechanicalChecks') && !obj.keys.includes('reviewLenses')) continue
      // The body's first line is the line AFTER the opening delimiter, so `lineOf` over the body
      // plus the delimiter's own line is the file line.
      const fileLine = (index: number) => block.line + lineOf(body, index)
      const mech = findKeyValueSpan(body, masked, obj, 'mechanicalChecks')
      const lensSpan = findKeyValueSpan(body, masked, obj, 'reviewLenses')
      const lensKeys: string[] = []
      if (lensSpan) {
        for (const o of directElements(literals, lensSpan, 'key')) {
          const s = findKeyValueSpan(body, masked, o, 'key')
          const v = s ? stringLiteralsIn(body, s.start, s.end)[0] : undefined
          if (v !== undefined) lensKeys.push(v)
        }
      }

      const tasksSpan = findKeyValueSpan(body, masked, obj, 'tasks')
      const taskIds: string[] = []
      if (tasksSpan) {
        for (const o of directElements(literals, tasksSpan, 'id')) {
          const s = findKeyValueSpan(body, masked, o, 'id')
          const v = s ? stringLiteralsIn(body, s.start, s.end)[0] : undefined
          if (v !== undefined) taskIds.push(v)
        }
      }

      const seen = new Map<string, Set<string>>()
      const enumerate = (id: string, source: string) => {
        const at = seen.get(id) ?? new Set<string>()
        at.add(source)
        seen.set(id, at)
      }
      if (mech) {
        for (const cmd of stringLiteralsIn(body, mech.start, mech.end)) {
          for (const m of cmd.matchAll(/--lecture\s+(\d+):/g)) enumerate(m[1], INSTANCE_ID_SOURCES.mech)
        }
      }
      for (const k of lensKeys) {
        const m = /-(\d+)$/.exec(k)
        if (m) enumerate(m[1], INSTANCE_ID_SOURCES.lens)
      }
      const scoredSpan = findKeyValueSpan(body, masked, obj, 'scoredChecks')
      if (scoredSpan) {
        for (const o of directElements(literals, scoredSpan, 'items')) {
          const s = findKeyValueSpan(body, masked, o, 'items')
          if (!s) continue
          for (const item of stringLiteralsIn(body, s.start, s.end)) {
            const m = /^\s*(\d+)\s*(?:\||$)/.exec(item)
            if (m) enumerate(m[1], INSTANCE_ID_SOURCES.scored)
          }
        }
      }
      const pdSpan = findKeyValueSpan(body, masked, obj, 'projectDir')
      const pd = pdSpan ? stringLiteralsIn(body, pdSpan.start, pdSpan.end)[0] : undefined
      out.push({
        fenceLine: block.line,
        mechanicalCount: mech ? arrayElementCount(masked, mech) : null,
        mechanicalLine: mech ? fileLine(mech.start) : null,
        lensKeys: lensKeys.sort(),
        projectDir: pd === undefined ? null : pd,
        projectDirLine: pd === undefined ? null : fileLine(pdSpan!.start),
        taskIds,
        instanceIds: [...seen].map(([id, sources]) => ({ id, sources: [...sources].sort() })),
      })
    }
  }
  return out
}

/**
 * P10 one entry point — a craft args object declares ONE `mechanicalChecks` entry.
 *
 * A list of N commands loses one silently, and nothing reports a check it never knew about; one
 * entry point whose exit code is the mechanical verdict is also the only shape a reviewer can
 * affordably re-run. More than one entry is a finding unless a marker declares why.
 */
export function checkSingleEntryPoint(file: string, text: string, exemptions: readonly Exemption[]): Finding[] {
  const findings: Finding[] = []
  for (const f of craftArgsFences(text)) {
    if (f.mechanicalCount === null || f.mechanicalCount <= 1) continue
    const line = f.mechanicalLine ?? f.fenceLine
    if (isExemptAt(exemptions, 'entry-point', line)) continue
    findings.push({
      rule: 'P10 one entry point',
      severity: 'major',
      file,
      line,
      detail: `this craft-args fence declares ${f.mechanicalCount} mechanicalChecks entries, so the mechanical verdict is spread over ${f.mechanicalCount} commands`,
      remedy:
        'collapse them behind ONE entry point whose exit code is the verdict, or declare the exception with <!-- wc-probe: ignore-entry-point --> and say why — a list of independent commands drops one without reporting it',
    })
  }
  return findings
}

/**
 * P11 lens-set parity — two craft-args fences in one file declare the same lens set.
 *
 * A second fence is a near-copy of the first, and a lens present in one and absent from the other is
 * a dimension nobody judges on that branch. An intended difference is declared KEY BY KEY with
 * `<!-- wc-probe: lens-set-differs <key>... -->`; a difference no declaration names is a finding.
 *
 * NO EXEMPTION PARAMETER, on purpose. P11 polices one file per skill, so any whole-file suppression
 * — `ignore-lens-set-parity`, `ignore-all` — is the rule's off switch rather than a scoped
 * exception. `lens-set-parity` is therefore absent from `KNOWN_EXEMPTION_RULES`, which makes the
 * marker a P9 finding in its own right.
 */
export function checkLensSetParity(file: string, text: string): Finding[] {
  const findings: Finding[] = []
  const declarations = parseLensSetDiffers(file, text)
  for (const d of declarations.filter(x => x.malformed)) {
    findings.push({
      rule: 'P11 lens-set parity',
      severity: 'major',
      file,
      line: d.line,
      detail: 'this lens-set-differs declaration names no parseable lens key, so it declares nothing while reading as a declaration',
      remedy: 'write <!-- wc-probe: lens-set-differs <key> [<key>...] --> with the keys the two fences may differ by',
    })
  }
  const fences = craftArgsFences(text)
  if (fences.length < 2) return findings
  const declared = new Set(declarations.flatMap(d => d.keys))
  const first = fences[0]
  for (const f of fences.slice(1)) {
    const diff = [
      ...first.lensKeys.filter(k => !f.lensKeys.includes(k)),
      ...f.lensKeys.filter(k => !first.lensKeys.includes(k)),
    ]
    const undeclared = [...new Set(diff.filter(k => !declared.has(k)))].sort()
    if (undeclared.length === 0) continue
    findings.push({
      rule: 'P11 lens-set parity',
      severity: 'major',
      file,
      line: f.fenceLine,
      detail: `this craft-args fence declares lenses [${f.lensKeys.join(', ')}] where the fence at line ${first.fenceLine} declares [${first.lensKeys.join(', ')}]; no declaration names ${undeclared.map(k => `"${k}"`).join(', ')}`,
      remedy:
        `make the two lens sets identical, or declare the intended difference with <!-- wc-probe: lens-set-differs ${undeclared.join(' ')} --> — an absent reviewLenses array is not "no lenses", it is craft's own defaults, so a silent difference judges the two branches by different standards`,
    })
  }
  return findings
}

// ---------------------------------------------------------------- P12

/** The nearest ancestor of `from` holding a `.git` entry, or null when none does. */
export function repoRootOf(from: string): string | null {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/**
 * P12 dispatch routing — a file that emits a craft-args fence dispatches craft the way craft says.
 *
 * (a) CRITICAL. The file names some OTHER runner script and never names `craft-dispatch.sh`.
 *     Hand-rolling that line drops everything craft-dispatch owns on the way in: TIER 1 `plan-lint`,
 *     TIER 2 the `redCommand` probe, TIER 2b `plan-preflight`. None of those failures is visible
 *     afterwards — the run simply proceeds ungated — so the omission has to be caught in the text.
 *     Keyed on the SHAPE of a runner reference (any `<name>.sh|.ts|.mjs|.js`), never on one runner's
 *     filename: a name-keyed rule retires itself silently the day the runner is renamed.
 *
 * (b) MAJOR. A fence whose `projectDir` literal lies OUTSIDE the repository containing this file,
 *     with no `--run-dir` anywhere in the file: craft then writes `args`/`result`/`log` into a
 *     `.craft/` inside a tree the run was only meant to read.
 *
 * A file naming NEITHER entry point is deliberately not judged. Delegating without naming the entry
 * point is indistinguishable from documenting nothing, and inferring one produces confident findings
 * about a script nobody named.
 */
/**
 * A runner script named as the thing that starts the run. Deliberately shape-keyed, not name-keyed:
 * matched on the extension a runner carries, so a rename cannot walk out from under the rule.
 */
export const RUNNER_REF = /[\w-]+\.(?:sh|ts|mjs|js)\b/

/** The claim that makes a named script THIS workflow's dispatch rather than a script it mentions. */
export const DISPATCH_CLAIM = /\b(?:dispatch(?:es|ed|ing)?|invoke[sd]?|invoking|fan(?:s|ned)?[ -]out)\b/i

/**
 * The runner a file names as its dispatch, or null. A line has to CLAIM the dispatch — naming a
 * script while saying something else about it ("it ships no `workflow.js`") is not a routing choice.
 */
export function handRolledRunner(text: string): { name: string; line: number } | null {
  const prose = maskFences(text).split('\n')
  for (let i = 0; i < prose.length; i++) {
    if (!DISPATCH_CLAIM.test(prose[i])) continue
    const m = RUNNER_REF.exec(prose[i])
    if (m) return { name: m[0], line: i + 1 }
  }
  return null
}

/**
 * P12(a)'s view of "this file emits craft args", broader than `craftArgsFences` — which keys on the
 * lens and mechanical declarations P10/P11 measure. A fence LABELLED `craft-args`, or one carrying a
 * `tasks` array, arms a run this rule must judge even when it declares neither of those.
 */
const TASK_ROW_KEYS = ['acceptance', 'writablePaths', 'redCommand'] as const

export function emitsCraftArgs(text: string): boolean {
  if (craftArgsFences(text).length > 0) return true
  for (const block of fencedBlocks(text)) {
    const objs = findObjectLiterals(block.body)
    // The info string is read as one word, so a ```json craft-args fence arrives labelled `json`:
    // the task rows themselves are the signature, not the label.
    if (!objs.some(o => o.keys.includes('tasks'))) continue
    if (objs.some(o => TASK_ROW_KEYS.some(k => o.keys.includes(k)))) return true
  }
  return false
}

export function checkDispatchRouting(file: string, text: string, exemptions: readonly Exemption[]): Finding[] {
  const findings: Finding[] = []
  const fences = craftArgsFences(text)
  if (!emitsCraftArgs(text)) return findings

  const runner = !text.includes('craft-dispatch.sh') ? handRolledRunner(text) : null
  if (runner) {
    const line = runner.line
    if (!isExemptAt(exemptions, 'dispatch', line)) {
      findings.push({
        rule: 'P12 dispatch routing',
        severity: 'critical',
        file,
        line,
        detail:
          `this file emits a craft-args fence and names ${runner.name} as the dispatch, never craft-dispatch.sh, so the run skips the TIER 1 plan-lint gate, the TIER 2 redCommand probe and TIER 2b plan-preflight`,
        remedy:
          'dispatch through ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-dispatch.sh and put the args in the plan\'s craft:dispatch arming block, or declare the exception with <!-- wc-probe: ignore-dispatch --> — a hand-written runner line reports nothing about the gates it never ran',
      })
    }
  }

  const repo = repoRootOf(dirname(file))
  if (repo === null || text.includes('--run-dir')) return findings
  for (const f of fences) {
    const pd = f.projectDir
    if (pd === null || !pd.startsWith('/')) continue
    if (isAtOrAbove(repo, resolve(pd))) continue
    const line = f.projectDirLine ?? f.fenceLine
    if (isExemptAt(exemptions, 'dispatch', line)) continue
    findings.push({
      rule: 'P12 dispatch routing',
      severity: 'major',
      file,
      line,
      detail: `this fence dispatches with projectDir "${pd}", outside the repository ${repo} that contains this file, and no --run-dir appears anywhere in it, so craft writes its args, result and log into a .craft/ inside that foreign tree`,
      remedy:
        'pass --run-dir with an ABSOLUTE path outside the judged tree to craft-dispatch.sh, or declare the exception with <!-- wc-probe: ignore-dispatch -->',
    })
  }
  return findings
}

// ---------------------------------------------------------------- P13

/**
 * P13 task-row coverage — every instance a fence JUDGES has a task row that BUILDS it.
 *
 * A fan-out workflow names its instances three times over: as `--lecture NN:` specs in the one
 * mechanical command, as `scoredChecks[].items` lines, and as the numeric suffix of a per-instance
 * lens key. An instance named there and by no `tasks[].id` is gated but never built — the gate
 * reports on an artifact no implementer was dispatched to produce.
 *
 * A task id COVERS an instance when it contains that id as a whole run of digits, so `content-18`,
 * `r18-align` and `c18-notes` all cover `18` while `deck-190` does not cover `19`.
 *
 * A fence with no task rows is skipped, not flagged: `tasks: []` is what a `readOnly` charter
 * declares, and flagging it would fire on every audit block in the corpus.
 */
export function checkTaskRowCoverage(file: string, text: string, exemptions: readonly Exemption[]): Finding[] {
  const findings: Finding[] = []
  for (const f of craftArgsFences(text)) {
    if (f.taskIds.length === 0) continue
    if (isExemptAt(exemptions, 'task-coverage', f.fenceLine)) continue
    const covered = new Set(f.taskIds.flatMap(id => id.match(/\d+/g) ?? []))
    for (const inst of f.instanceIds) {
      if (covered.has(inst.id)) continue
      findings.push({
        rule: 'P13 task-row coverage',
        severity: 'major',
        file,
        line: f.fenceLine,
        detail: `the craft-args fence at line ${f.fenceLine} enumerates instance "${inst.id}" in ${inst.sources.join(', ')}, and no tasks[].id covers it — the ids declared are [${f.taskIds.join(', ')}]`,
        remedy: `give "${inst.id}" a task chain in this fence, or drop it from ${inst.sources.join(', ')}, or declare the exception with <!-- wc-probe: ignore-task-coverage --> — an instance the gate judges and no implementer builds fails on an artifact the run never wrote`,
      })
    }
  }
  return findings
}

// ---------------------------------------------------------------- driver

/**
 * What the target IS, which decides what the coverage floor demands of it.
 *
 * `skill` (default) demands a `SKILL.md`. `agents` is for a discovery directory, which holds none
 * by design; the floor does not vanish, it changes its question — an `agents` run matching no agent
 * file is that mode's vacuous pass and fails. Either way the un-run frontmatter rules are reported.
 */
export type ProbeExpect = 'skill' | 'agents'

export interface ProbeResult {
  target: string
  /** What the target was declared to be. Carried into the result so a JSON consumer can tell a
   *  clean `agents` run from a clean `skill` run — they certify different things. */
  expect: ProbeExpect
  findings: Finding[]
  /** Source files the walk selected. `filesScanned` short of this is coverage LOST, not coverage
   *  not needed — without the denominator a probe that opened nothing still printed CLEAN. */
  filesEligible: number
  filesScanned: number
  /** Eligible source files that could not be read. Each is also a finding: fail closed. */
  filesSkipped: string[]
  /** Files the walk FOUND and `SOURCE_EXT_RE` rejected. Present, readable, and unread. They are not
   *  findings — an image or a `.csv` fixture is not a defect — but they are named, because
   *  `filesEligible` counts only what the selector already admitted, so without this channel the
   *  coverage line reports full reach over a subset it chose in silence. */
  filesExcluded: string[]
  /** Directories the walk could not enumerate. */
  dirsSkipped: string[]
  /** Symlinks that do not resolve. Each is lost coverage, and each is also a finding. */
  brokenLinks: string[]
  /** Every declared exemption applied, per rule and scope. Reported, never silent — a suppressed
   *  check that nobody can see is indistinguishable from a check that passed. */
  exemptions: Exemption[]
  /** References skipped because they name a variable this process cannot resolve. Reported for the
   *  same reason exemptions are: a check that did not run must not read as a check that passed. */
  unresolvedRefs: UnresolvedRef[]
  /** Every file read from OUTSIDE `--target`, in read order. P5 follows a SKILL.md's scriptPath to
   *  the script that implements its documented shape, and that script routinely lives in another
   *  tree; a gate that silently reads outside its stated scope is a gate whose scope is not stated. */
  crossFileTargets: string[]
  /** Agent files pulled in from outside `--target` via `--agent`, judged with the skill's context. */
  agentsIncluded: string[]
  /** Whether a SKILL.md was among the eligible files. The `--expect agents` note claims P3 did not
   *  run, and must not say so when it did. */
  skillMdRead: boolean
  /** Back-compat: files carrying a whole-file P2 exemption. */
  pathCheckExempt: string[]
}

/**
 * The file extensions the gate collects as source. Exported because the write-time hook must
 * decide eligibility with the SAME regex — two copies is how the two surfaces came to disagree.
 *
 * WIDENED, and case-INSENSITIVE. It was case-sensitive and held no `.py`, `.json` or `.markdown`,
 * while `filesEligible` counted only what had already passed it — so a skill whose one broken
 * reference lived in `scripts/hook.py`, or in `references/NOTE.MD`, printed
 * `CLEAN — 1 of 1 eligible source files scanned`. The denominator chose its own subset and the
 * honesty line claimed full reach over it. Both are here now because both are read as source by
 * something else in this file already: `SCRIPT_EXT_RE` runs `.py` hook bodies, and P1 parses
 * `hooks.json` / `settings*.json` as registries.
 *
 * WIDENING IS NOT THE WHOLE FIX — a selector can only ever admit the extensions someone listed.
 * Every walked file this regex rejects is carried in `ProbeResult.filesExcluded` and named in the
 * notes channel, so what went unread is a statement rather than a silence.
 */
export // ACCEPTED, not overlooked: a non-Markdown file has no fence to demote by, so an illustrative
// `${CLAUDE_PLUGIN_ROOT}` path in something like `examples/stdio-server.json` lands as a critical.
// Measured across 25 real skills: ONE is affected (plugin-dev/mcp-integration, 2 findings), and
// those two references genuinely do not resolve. Narrowing P2 to "registry" JSON only would add a
// rule, a vocabulary and a silent class to chase a 1-in-25 case — the surface-adding reflex that
// produced the last five audit cycles. Left as a true-but-unhelpful finding by choice.
const SOURCE_EXT_RE = /\.(md|markdown|ts|mts|cts|js|mjs|cjs|sh|bash|py|json)$/i

/**
 * Run every predicate over `target`.
 *
 * `expect` sets what the coverage floor demands, never which rules run. `includeAgents` are guard
 * agents that belong to this skill but must live outside it; they are judged with the SKILL's
 * context, the only way `${CLAUDE_SKILL_DIR}` in their `hooks:` block resolves at all.
 */
export function runProbe(
  target: string,
  expect: ProbeExpect = 'skill',
  includeAgents: readonly string[] = [],
): ProbeResult {
  const root = resolve(target)
  const findings: Finding[] = []
  const unresolvedRefs: UnresolvedRef[] = []
  const registryExemptions: Exemption[] = []

  // Resolved and validated BEFORE P1 runs, because P1 must see them. Never skipped silently: a
  // `--agent` that names nothing is a gate the caller believes is running.
  const includedAgents: string[] = []
  for (const a of includeAgents) {
    const p = resolve(a)
    if (!existsSync(p)) {
      findings.push({
        rule: 'P0 coverage',
        severity: 'critical',
        file: p,
        detail: '--agent names a file that does not exist, so the agent rules never ran on it',
        remedy: 'fix the path — a guard file the gate cannot open is a guard the gate cannot certify',
      })
      continue
    }
    // No root: an `--agent` file lives OUTSIDE `--target`, so the target is not its discovery
    // root and judging it against one would call a real agent prose.
    if (classifySkillFile(p) !== 'agent') {
      findings.push({
        rule: 'P0 coverage',
        severity: 'critical',
        file: p,
        detail:
          '--agent names a file that does not classify as an agent (it must be a .md inside a directory named "agents"), so the agent rules did not run on it',
        remedy:
          'point --agent at the registered agent .md under .claude/agents or ~/.claude/agents — a file elsewhere registers no agent either',
      })
      continue
    }
    if (!isGuardDiscoveryPath(p)) {
      findings.push({
        rule: 'P0 coverage',
        severity: 'critical',
        file: p,
        detail:
          '--agent names an agent outside a hook-DELIVERING discovery location (.claude/agents or ~/.claude/agents), so judging its hooks: block would certify something that never runs: `hooks:`, `mcpServers:` and `permissionMode:` are ignored by the harness for a plugin-shipped agent',
        remedy:
          'pass a guard agent under .claude/agents or ~/.claude/agents. A plugin-shipped agent registers and dispatches, but its hooks: block is dead — put that plugin\'s hooks in its own hooks/hooks.json and probe the plugin instead',
      })
      continue
    }
    includedAgents.push(p)
  }
  const includedSet = new Set(includedAgents)

  findings.push(...checkHookRegistration(root, unresolvedRefs, registryExemptions, includedAgents))

  const dirsSkipped: string[] = []
  const brokenLinks: string[] = []
  const escapedLinks: string[] = []
  const files = collectFiles(root, [], dirsSkipped, new Set<string>(), brokenLinks, escapedLinks)
  for (const l of escapedLinks) {
    findings.push({
      rule: 'P0 coverage',
      severity: 'major',
      file: l,
      detail:
        'a symlink here resolves to this target or above it, so it was NOT followed — following it would re-enter the tree from outside and enumerate everything beside it, without bound',
      remedy: 'repoint the link below the target or remove it — an upward link makes the walk’s scope unstateable, and every finding under it names a path the target does not own',
    })
  }
  for (const l of brokenLinks) {
    findings.push({
      rule: 'P0 coverage',
      severity: 'critical',
      file: l,
      detail: 'a symlink here does not resolve, so whatever it pointed at went unchecked',
      remedy: 'repoint or remove the link — a dangling link reads to the walk exactly like a subtree with nothing wrong in it',
    })
  }
  for (const d of dirsSkipped) {
    findings.push({
      rule: 'P0 coverage',
      severity: 'critical',
      file: d,
      detail: 'directory could not be enumerated, so any source file under it went unchecked',
      remedy: 'make the directory readable or exclude it deliberately — an unreadable subtree silently shrinks every other rule’s reach',
    })
  }

  // Deduped by realpath. `filesEligible` is the denominator the P0 coverage floor exists to make
  // trustworthy — "N of N scanned" is the gate's own honesty metric — and concatenating the walk
  // with the included agents padded it: `--agent X --agent X`, or naming a file the walk already
  // held, inflated the count with no way for a reader to tell "8 files checked" from "7 files, one
  // checked twice". The findings themselves already deduped, so this was never a double-report of
  // rules; it was the coverage line lying about its own reach.
  // ONLY an included agent is ever dropped; every walk entry is kept. `classifySkillFile` keys on
  // the PATH, so one real file reachable under two names is classified differently under each
  // (V3-C) — collapsing the walk switches a rule off. Findings dedup downstream.
  const walked = files.filter(f => SOURCE_EXT_RE.test(f))
  const filesExcluded = files.filter(f => !SOURCE_EXT_RE.test(f))
  const realOrSelf = (f: string) => {
    try {
      return realpathSync(f)
    } catch {
      return f
    }
  }
  const walkedReal = new Set(walked.map(realOrSelf))
  const eligible = [...walked]
  for (const a of includedAgents) {
    const key = realOrSelf(a)
    if (walkedReal.has(key)) continue // already inside --target; naming it again is not more coverage
    walkedReal.add(key)
    eligible.push(a)
  }

  // THE FLOOR. A run that selected nothing has checked nothing, and every rule below reports CLEAN
  // by vacuous truth — the exact empty-set pass gate-laws L2(a) forbids, sitting in the one layer
  // that decides whether anything ran at all. `0 of 0 eligible source files scanned` used to exit 0.
  // `walked`, not `eligible`: an included agent lives outside --target by construction, so one
  // --agent lifted a target that contributed nothing above the floor and a stale or mistyped
  // --target was certified CLEAN.
  if (walked.length === 0) {
    findings.push({
      rule: 'P0 coverage',
      severity: 'critical',
      file: root,
      detail: `the walk selected no source files (${SOURCE_EXT_RE.source}) under this target, so every rule passed vacuously`,
      remedy: 'point --target at a directory that holds the skill, or fix what made its files unreadable — a probe that opened nothing is not a probe that found nothing',
    })
  } else if (!eligible.some(f => basename(f) === 'SKILL.md')) {
    // P3 keys off SKILL.md, so without one it never ran and its silence means nothing. P4 does NOT:
    // the shared `classifySkillFile` dispatches it for `skill` OR `agent`, so on an agents-only
    // target it runs. This branch used to claim both were un-run and then print P4 findings two
    // lines below — a coverage floor mis-describing its own coverage, which is the one thing a floor
    // exists not to do.
    const agentFiles = eligible.filter(f => classifySkillFile(f, root) === 'agent').length
    if (expect === 'agents') {
      // A missing SKILL.md is this mode's declared shape, not a hole: it is a note, not a finding.
      // The floor itself moved below, so it evaluates whether or not a SKILL.md is present.
    } else {
      findings.push({
        rule: 'P0 coverage',
        severity: 'major',
        file: root,
        detail: agentFiles > 0
          ? `no SKILL.md anywhere under this target, so the frontmatter rules never ran (the plugin-root rules DID run, on ${agentFiles} agent file(s))`
          : 'no SKILL.md anywhere under this target, so the frontmatter and plugin-root rules never ran',
        remedy:
          'probe a skill directory, or accept that this run says nothing about frontmatter validity — if this IS an agent-discovery directory, declare it with --expect agents',
      })
    }
  }

  // The agents-mode floor, OUTSIDE the no-SKILL.md arm. Nested inside it, a target that happened to
  // hold a SKILL.md skipped the whole arm, so `--expect agents` over a directory with no agent file
  // at all reported CLEAN — the vacuous pass this mode's own docstring promises to fail.
  if (expect === 'agents' && eligible.length > 0 && !eligible.some(f => classifySkillFile(f, root) === 'agent')) {
    findings.push({
      rule: 'P0 coverage',
      severity: 'critical',
      file: root,
      detail:
        `--expect agents was declared, but none of the ${eligible.length} eligible file(s) here classify as an agent (an agent .md must sit in a directory named "agents"), so the agent rules passed vacuously`,
      remedy:
        'point --target at a real discovery directory, or drop --expect agents — declaring a target you did not probe is worse than not probing it',
    })
  }

  const filesSkipped: string[] = []
  const exemptions: Exemption[] = []
  const pathCheckExempt: string[] = []
  let scanned = 0

  // A SKILL.md is BOTH a hook registry and a source file, so its markers arrive twice. Key on the
  // identity of the declaration, not on the order it was found in.
  const exemptionKey = (e: Exemption) => `${e.file}::${e.rule}::${e.scope}::${e.startLine}::${e.endLine}`
  const seenExemptions = new Set<string>()
  const recordExemptions = (list: readonly Exemption[]) => {
    for (const e of list) {
      if (seenExemptions.has(exemptionKey(e))) continue
      seenExemptions.add(exemptionKey(e))
      exemptions.push(e)
      findings.push(...checkExemptionVocabulary([e]))
    }
  }
  // Registry exemptions FIRST: a `hooks.json` is not an eligible source file, so this is the only
  // point at which a marker living in one can reach the reported list.
  recordExemptions(registryExemptions)

  // One cache per run, NEGATIVES INCLUDED: a target that could not be read must not be re-read once
  // per documented shape, and `has` rather than a truthiness test is what keeps that true.
  const contracts = new Map<string, ContractReturn | null>()
  const crossFileTargets: string[] = []
  // A file reached through a sideways delivery link has a path UNDER the target and content that is
  // not. That is the layout this machine ships (`~/.claude/skills/<name>` -> the repo), so it is
  // followed rather than refused — but a walk that reads outside its stated scope must say so, which
  // is exactly what this channel already exists to report for P5.
  {
    let rootReal: string
    try {
      rootReal = realpathSync(root)
    } catch {
      rootReal = root
    }
    for (const f of files) {
      let fr: string
      try {
        fr = realpathSync(f)
      } catch {
        continue
      }
      // `fr !== f` means "reached through a link"; `isAtOrAbove` decides whether it landed outside.
      // Routed through the helper for the root boundary: with `--target /` the old prefix `"//"`
      // matched nothing, so every linked file was falsely declared an out-of-scope read.
      if (fr !== f && !isAtOrAbove(rootReal, fr)) crossFileTargets.push(f)
    }
  }
  const contractFor = (t: ScriptTarget): ContractReturn | null => {
    const p = t.path!
    if (!contracts.has(p)) {
      if (!isAtOrAbove(root, p)) crossFileTargets.push(p)
      const src = readTextOrNull(p)
      contracts.set(p, src === null ? null : contractReturn(src, p))
    }
    return contracts.get(p)!
  }

  for (const file of eligible) {
    const text = readTextOrNull(file)
    if (text === null) {
      filesSkipped.push(file)
      findings.push({
        rule: 'P0 coverage',
        severity: 'critical',
        file,
        detail: 'source file could not be read (unreadable, oversized, or not text), so no rule ran against it',
        remedy: 'make the file readable, or move it out of the skill — a file nobody could open reads exactly like a file with nothing wrong in it',
      })
      continue
    }
    scanned++
    // Parsed ONCE, from the RAW file, and threaded into every predicate. A predicate that re-parses
    // from the text it was handed disagrees with this list about what is suppressed, and the list is
    // what gets reported — so the disagreement is invisible by construction.
    const fileExemptions = parseExemptions(file, text)
    recordExemptions(fileExemptions)
    if (fileExemptions.some(e => e.scope === 'file' && (e.rule === 'paths' || e.rule === 'all'))) pathCheckExempt.push(file)

    // The SAME test the predicates below use. This one was `endsWith('.md')` while every predicate
    // it dispatches to is `/i`, so a `.MD` was Markdown to P2 and code to P6/P7 in one run.
    const isMd = MARKDOWN_EXT_RE.test(file)
    const rawCtx = includedSet.has(file) ? includedAgentContext(file, root) : skillContextFor(file, root)
    // An AGENT is not a plugin, wherever it sits. `skillContextFor`'s fallback (measured, and
    // correct for a personal SKILL) was inventing a plugin root for in-target agents too, so the
    // same file drew a P2 in-target and a skip via --agent. Neither should resolve it.
    const ctx = classifySkillFile(file, root) === 'agent'
      ? { ...rawCtx, pluginRoot: findPluginRootOrNull(dirname(file)) }
      : rawCtx

    // P2 runs on EVERY source file, `.ts`/`.js` included. Its own docstring claims it covers "every
    // path reference inside a skill" and the layout this skill prescribes puts `scripts/*.ts` in
    // every generated skill — but it ran only on Markdown, and only when `ctx.skillDir` was set,
    // while the write-time hook ran it unconditionally. A guard script naming a path that does not
    // resolve was gate-CLEAN.
    findings.push(...checkPathResolution(file, text, ctx, fileExemptions, unresolvedRefs))

    // Dispatch through the SHARED classifier, so the gate and the write-time hook cannot disagree
    // about which rules a file is subject to.
    const kind = classifySkillFile(file, root)
    if (kind === 'skill') findings.push(...checkFrontmatter(file, text))
    if (kind === 'agent') findings.push(...checkAgentFrontmatter(file, text))
    if (kind === 'skill' || kind === 'agent') findings.push(...checkPluginRootInBody(file, text))

    if (isMd) {
      // P5 gets RAW text: in Markdown the documented shape is prose and the `Workflow({scriptPath})`
      // that names its implementation is fenced, so a fence-only view can never see both.
      findings.push(
        ...checkReturnShapeDrift(file, text, {
          exemptions: fileExemptions,
          ctx,
          contractFor,
          note: r => unresolvedRefs.push(r),
        }),
      )
      // P10/P11 read RAW text: both are per-FENCE rules, and the code view keeps no fence boundary.
      findings.push(...checkSingleEntryPoint(file, text, fileExemptions))
      findings.push(...checkLensSetParity(file, text))
      // P12 reads RAW text too: its fence half is per-fence, and its runner half is a claim the
      // file's PROSE makes, which the code view blanks.
      findings.push(...checkDispatchRouting(file, text, fileExemptions))
      findings.push(...checkTaskRowCoverage(file, text, fileExemptions))
      // P6/P7 judge what the call CONTAINS, so they read the code view.
      const code = maskNonFenced(text)
      findings.push(...checkBareWorkflowRefs(file, code, fileExemptions))
      findings.push(...checkRefsDeclaration(file, code, root, fileExemptions, ctx, unresolvedRefs))
    } else {
      findings.push(...checkReturnShapeDrift(file, text, { exemptions: fileExemptions, ctx }))
      findings.push(...checkBareWorkflowRefs(file, text, fileExemptions))
      findings.push(...checkRefsDeclaration(file, text, root, fileExemptions, ctx, unresolvedRefs))
    }
  }

  // ONE REAL FILE, ONE FINDING. A file reachable under two names inside the target — `agents ->
  // shared` — is now walked under both, which is what lets the agent rules run on the alias. The
  // cost is that a rule keyed on CONTENT fires once per name, so collapse findings that are the same
  // rule at the same line of the same real file. Rules that differ BY path (P4 via the alias) have a
  // different `rule` and survive; only the genuine duplicates go.
  const realOf = (p: string) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  }
  const findingKey = (f: Finding) => `${f.rule}::${f.severity}::${realOf(f.file)}::${f.line ?? ''}::${f.detail}`
  const seenFindings = new Set<string>()
  const deduped = findings.filter(f => {
    const k = findingKey(f)
    if (seenFindings.has(k)) return false
    seenFindings.add(k)
    return true
  })

  return {
    target: root,
    expect,
    agentsIncluded: includedAgents,
    skillMdRead: eligible.some(f => basename(f) === 'SKILL.md'),
    findings: deduped,
    filesEligible: eligible.length,
    filesScanned: scanned,
    filesSkipped,
    filesExcluded,
    dirsSkipped,
    brokenLinks,
    exemptions,
    unresolvedRefs,
    crossFileTargets,
    pathCheckExempt,
  }
}

// ---------------------------------------------------------------- CLI

export class ArgError extends Error {}
/** An explicit --help: a successful invocation, not a usage error. */
export class HelpRequested extends Error {}

export const USAGE =
  'usage: wc-probe.ts --target <dir> [--agent <file>]... [--expect skill|agents] [--json]'

/** Parsed once here so an unknown value fails at ARG time, before any agent or walk. */
export const PROBE_EXPECTS: readonly ProbeExpect[] = ['skill', 'agents']

export function parseArgs(argv: string[]): {
  target: string
  json: boolean
  expect: ProbeExpect
  agents: string[]
} {
  let target: string | null = null
  let json = false
  let expect: ProbeExpect = 'skill'
  const agents: string[] = []
  const setExpect = (v: string | null) => {
    if (v === null || !PROBE_EXPECTS.includes(v as ProbeExpect)) {
      throw new ArgError(`--expect must be one of ${PROBE_EXPECTS.join('|')} (got ${JSON.stringify(v)})`)
    }
    expect = v as ProbeExpect
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--expect') setExpect(argv[++i] ?? null)
    else if (a.startsWith('--expect=')) setExpect(a.slice('--expect='.length))
    else if (a === '--agent') {
      const v = argv[++i] ?? null
      if (v === null || v.startsWith('--')) throw new ArgError('--agent requires a file path')
      agents.push(v)
    } else if (a.startsWith('--agent=')) agents.push(a.slice('--agent='.length))
    else if (a === '--target') {
      target = argv[++i] ?? null
      if (target === null || target.startsWith('--')) throw new ArgError('--target requires a directory path')
    } else if (a.startsWith('--target=')) target = a.slice('--target='.length)
    else if (a === '-h' || a === '--help') throw new HelpRequested(USAGE)
    else throw new ArgError(`unknown argument ${JSON.stringify(a)} (${USAGE})`)
  }
  if (!target) throw new ArgError(`--target <dir> is required (${USAGE})`)
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
  const resolvedAgents = agents.map(a => {
    let r = a
    if (r === '~') r = homedir()
    else if (r.startsWith('~/')) r = join(homedir(), r.slice(2))
    return resolve(r)
  })
  return { target: resolved, json, expect, agents: resolvedAgents }
}

/** Coverage and exemption notes, printed in BOTH the CLEAN and the findings branch. */
/**
 * The LAST line, and the only one a truncated report is guaranteed to keep.
 *
 * The header sits at the top and every note after it, so a caller told to capture "the last ~2000
 * characters" (craft's mechanicalChecks instruction) drops the header and keeps an arbitrary tail of
 * notes. 69 notes on one file is ~14KB, so the count a reader needs was the first thing discarded.
 * The gate itself reads only the exit code, so an un-summarised note channel is consumed by nobody.
 */
function tailLine(result: ProbeResult): string {
  const n = result.unresolvedRefs.length + result.exemptions.length
  const bits = [`${result.findings.length} finding(s)`]
  if (result.unresolvedRefs.length) bits.push(`${result.unresolvedRefs.length} NOT CHECKED`)
  if (result.exemptions.length) bits.push(`${result.exemptions.length} suppressed`)
  if (result.filesExcluded?.length) bits.push(`${result.filesExcluded.length} file(s) not scanned`)
  return `wc-probe: END — ${bits.join(', ')}${n ? ' (see notes above; only findings gate)' : ''}`
}

function notesFor(result: ProbeResult): string[] {
  const lines: string[] = []
  // Only when a SKILL.md really was absent. Printed unconditionally on the mode, it told the reader
  // the frontmatter rules had not run while P3 findings were listed two lines below — the same
  // shape as the floor defect the branch above already fixed.
  if (result.expect === 'agents' && !result.skillMdRead) {
    lines.push(
      '  note: --expect agents — no SKILL.md read, so the frontmatter rules (P3) did not run; this run says nothing about frontmatter validity',
    )
  }
  for (const e of result.exemptions) {
    const where = e.scope === 'file' ? 'whole file' : `lines ${e.startLine}-${e.endLine}`
    lines.push(`  note: rule "${e.rule}" SUPPRESSED for ${e.file} (${where}, declared)`)
  }
  for (const u of result.unresolvedRefs) {
    lines.push(
      `  note: rule "${u.rule}" NOT CHECKED for ${JSON.stringify(u.token)} in ${u.file}${u.line ? `:${u.line}` : ''} — ${u.reason}`,
    )
  }
  for (const p of result.crossFileTargets) lines.push(`  note: READ OUTSIDE --target (P5 followed a scriptPath): ${p}`)
  // An included agent lives outside --target, so the coverage denominator alone cannot show it.
  for (const p of result.agentsIncluded) lines.push(`  note: INCLUDED via --agent (judged with this skill's context): ${p}`)
  for (const f of result.filesSkipped) lines.push(`  note: NOT SCANNED (unreadable): ${f}`)
  // Named one by one, not summarised by extension: the reader's question is "which file did this
  // run say nothing about", and a count answers it for nobody.
  for (const f of result.filesExcluded) {
    lines.push(`  note: NOT SCANNED (extension outside ${SOURCE_EXT_RE.source}): ${f}`)
  }
  for (const d of result.dirsSkipped) lines.push(`  note: NOT ENUMERATED (unreadable directory): ${d}`)
  for (const l of result.brokenLinks) lines.push(`  note: NOT FOLLOWED (dangling symlink): ${l}`)
  return lines
}

export function formatText(result: ProbeResult): string {
  const lines: string[] = []
  // The excluded count rides ON the coverage line, not only in the notes below it. "7 of 7" is the
  // sentence a reader quotes as full reach, and it is a claim about the numerator over a
  // denominator the selector picked; a qualifier one line away is a qualifier nobody carries.
  const coverage =
    `${result.filesScanned} of ${result.filesEligible} eligible source files scanned` +
    (result.filesExcluded.length > 0
      ? `, ${result.filesExcluded.length} present-but-excluded file(s) NOT scanned (named below)`
      : '')
  if (result.findings.length === 0) {
    lines.push(`wc-probe: CLEAN — ${coverage} under ${result.target}`)
    lines.push(...notesFor(result))
    lines.push(tailLine(result))
    return lines.join('\n')
  }
  lines.push(`wc-probe: ${result.findings.length} finding(s) — ${coverage} under ${result.target}`)
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

export function main(argv: string[]): number {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    if (e instanceof HelpRequested) {
      console.log(e.message)
      return 0
    }
    console.error(`wc-probe: ${(e as Error).message}`)
    return 2
  }
  let result: ProbeResult
  try {
    result = runProbe(opts.target, opts.expect, opts.agents)
  } catch (e) {
    // 3, not 2: the arguments were fine and the probe still did not run. A caller that cannot tell
    // those apart reads a gate that crashed as a gate that passed its argument check.
    console.error(`wc-probe: failed to probe ${opts.target}: ${(e as Error).message}`)
    return 3
  }
  // Serialize the WHOLE result. Hand-building a subset literal here is how `pathCheckExempt` came to
  // be dropped. NOTE: the audit branch runs the TEXT mode (SKILL.md passes no --json), which is why
  // every coverage and suppression note is printed in both modes rather than only in the JSON.
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatText(result))
  return result.findings.length > 0 ? 1 : 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
