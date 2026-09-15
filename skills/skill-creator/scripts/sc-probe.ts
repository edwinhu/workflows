#!/usr/bin/env bun
/**
 * sc-probe.ts — deterministic SKILL-SHAPE probe.
 *
 * Usage:  bun sc-probe.ts --target <plugin-root-or-skill-dir> [--json]
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
 * WHAT IT COMPUTES, AND WHAT IT REFUSES TO DO
 *
 * `skills/skill-creator/SKILL.md` states the rules; nothing computed them, so this session enforced
 * them by hand across 55 skills and got three of them wrong twice. This probe is the computation.
 *
 * It NEVER EXECUTES A BANG. Resolution is static: the command's first word against PATH and the
 * filesystem. A probe that ran what it found would run every skill's load-time side effects at
 * audit time — the ancestor of this probe's sibling did exactly that and downloaded 112 MB.
 *
 * It does not follow a symlinked skill directory. Those are vendored upstream (`docx`, `pdf`,
 * `pptx`, `xlsx` reach an `external/` submodule) and are not ours to judge; each is reported on the
 * NOT CHECKED channel rather than silently skipped.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANTS, AND THE DEFECT EACH ONE IS NAMED AFTER
 *
 * Every invariant is backed by a defect measured in these four plugins. An invariant that flags
 * something nobody has got wrong is noise, so there are only these.
 *
 * S1  EVERY skill carries the TOC bang. Unconditionally: `skill-toc` prints "(this skill carries no
 *     references/ or scripts/)" and exits 0 for a skill with neither, so there is no skill for
 *     which the line is wrong, and a rule with no exceptions is one a later `references/` cannot
 *     silently fall out of.
 *     Defect: a skill load injects `Base directory for this skill: <path>` and the SKILL.md body,
 *     and NOTHING lists either folder — so anything the prose does not name is invisible. Measured
 *     2026-09-14: 16 of 219 reference files across 10 skills, and 48 of 156 scripts.
 *
 * S2  No bang may abort the skill load. Four ways it can, each of which happened:
 *     (a) `bang-in-prose` — a bang written out in documentation EXECUTES. Both creator skills were
 *         taken offline by their own documentation of bangs; `skill-creator`'s example ran
 *         `skill-toc` on a directory holding only SKILL.md (exit 2), `workflow-creator`'s sentence
 *         executed a command named `cmd`.
 *         WHERE IT FIRES, measured 2026-09-15 against claude@2.1.257 by loading a probe skill:
 *
 *             bare line, or mid-sentence ....................... FIRES
 *             ``` fenced block ................................ FIRES
 *             ~~~ fenced block ................................ FIRES
 *             four-space indented block ....................... FIRES
 *             inline code span `…` (anywhere inside it) ....... inert
 *
 *         So a fence does NOT protect a bang and an inline code span DOES — which is the reverse of
 *         what reading the markdown suggests, and why this is measured rather than reasoned. Write a
 *         documentation bang in an inline span, or as the placeholder `<bang>`.
 *     (b) `bang-shell-var` — `${CLAUDE_SKILL_DIR}` is substituted into the command TEXT before a
 *         shell ever sees it. The shell variable `$CLAUDE_SKILL_DIR` does not exist, so a bang
 *         passing it hands the script an empty argument. First fix of the 53-skill outage was this
 *         bug: skill-toc received `.`, exited 2, and aborted the load identically.
 *     (c) `bang-unresolvable` — a non-zero exit aborts the load, and command-not-found is 127.
 *         `skill-toc` was not on PATH in any session started before plugin-utils existed, which
 *         made 53 skills unloadable at once. A bang naming a command that can be absent needs a
 *         fallback branch (`command -v` … `||` … `[ -x`) that degrades to an echo.
 *     (d) `bang-unbalanced` — a backtick inside the command truncates it at the parser, bash dies
 *         on the fragment, and the WHOLE skill load aborts. The truncation is invisible after the
 *         fact; unbalanced quotes in the extracted command are its signature.
 *
 * S3  Every path the body names must resolve FROM THE SKILL'S OWN DIRECTORY, because that is the
 *     only base a loaded skill is given: the harness injects `Base directory for this skill: <path>`
 *     and nothing else. A bare `references/x.md` therefore means the SKILL's references/, and when
 *     the file actually lives in the PLUGIN's shared `references/` one directory up, the reader
 *     resolves it to a path that does not exist. Reported as its own case, because the remedy
 *     differs: a dead path gets deleted, a shared one gets spelled `${CLAUDE_PLUGIN_ROOT}/…` or
 *     reached by a command.
 *     Defect: the piecewise-path class, which cost four separate repairs this session — a rename
 *     leaves the prose pointing at a file that is no longer there and nothing notices, because a
 *     skill body is prose to every tool that reads it.
 *     Paths inside a FENCED block are not judged: a fence is an example, and `scripts/my_script.py`
 *     in a usage template is a placeholder, not a claim that the file exists.
 *
 * S4  A constraint doc in a SHARED corpus declares `applies-to:`; one in a skill-local corpus does
 *     not, because its DIRECTORY is already the scope. Plus, either way, only keys a LOADER reads.
 *
 *     Shared vs local is decided by position: `constraints/` at the plugin root is reachable by
 *     every skill, so membership needs declaring; `skills/<skill>/constraints/` belongs to the one
 *     skill that holds it, and `applies-to` there restates the path. Measured 2026-09-15 — typst's
 *     22 shared rules resolve to 15/15/4/2 across 11 consumers, and workflows' 30 to between 1 and
 *     26 across six phases, so the field does real work; teaching's 14 skill-local exam rules
 *     returned the IDENTICAL set under either declared scope, so it chose nothing.
 *     Which keys those are is DERIVED, not listed here: a loader is any file in the plugin whose
 *     own source mentions `applies-to`, and a key counts as read when one of them names it as a
 *     string literal. A hardcoded allowlist would be the same kind of second representation the
 *     rule exists to remove, and it would go stale the first time a loader learned a key.
 *     Defect: `type:` reached 17 of 21 files and `testable:` 3 of 21, read by no code at all, and a
 *     `description:` drifted from the rule sitting under it with no check able to see it.
 *
 * S5  ADVISORY: no count of a corpus written in prose.
 *     Defect: `rules/typst.md` claimed 22 constraints over a corpus of 21; `workshop-reviewer` said
 *     "fifteen" where the corpus held 20. A number in prose is a second representation of a fact
 *     the filesystem already holds, and it drifts on the next addition. Advisory because a count
 *     can be legitimate (a version, a timeout, a line ceiling) and only a reader can tell.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
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

/** S5's channel. Reported, printed, and deliberately NOT counted by the exit code. */
export interface Advisory {
  rule: string
  file: string
  line?: number
  detail: string
}

/**
 * Something the probe declined to judge. Recorded and printed rather than dropped, for the same
 * reason every exemption is: a check that silently did not run is indistinguishable from one that
 * passed.
 */
export interface UnresolvedRef {
  rule: string
  file: string
  line?: number
  token: string
  reason: string
}

export interface Bang {
  file: string
  line: number
  /** The command text as the parser would extract it: `!\`` up to the next backtick. */
  command: string
  /** Written out in documentation inside a FENCE — which does not protect it; it still fires. */
  inProse: boolean
  /** Inside an INLINE code span, which is the one place a bang is inert. */
  inert: boolean
}

export interface SkillDir {
  /** Absolute path to the directory holding SKILL.md. */
  dir: string
  /** Relative to the target. */
  name: string
  skillMd: string
  references: string[]
  scripts: string[]
  /** Executable/source files sitting beside SKILL.md, which skill-toc also indexes. */
  rootCode: string[]
  bangs: Bang[]
  hasToc: boolean
}

export interface ProbeResult {
  target: string
  findings: Finding[]
  advisories: Advisory[]
  unresolvedRefs: UnresolvedRef[]
  skills: { name: string; references: number; scripts: number; rootCode: number; bangs: number; hasToc: boolean }[]
  constraintDocs: number
  filesScanned: number
  dirsSkipped: string[]
}

const SKIP_DIRS = new Set([
  '.git', '.jj', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv',
  '.next', '.cache', 'dist', 'coverage', '.pixi', '.mypy_cache', '.ruff_cache',
  'scratch', '.worktrees', 'worktrees', 'external',
])

/** What `skill-toc` itself indexes in a skill root. Kept in sync with plugin-utils/bin/skill-toc. */
export const CODE_EXT = new Set(['.py', '.ts', '.sh', '.mjs', '.js', '.tsx'])

// ---------------------------------------------------------------- walking

export function lineOf(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') n++
  return n
}

export function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Every SKILL.md under `dir`, skipping SKIP_DIRS and never descending a symlinked directory. */
export function findSkillFiles(dir: string, out: string[] = [], skipped: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    skipped.push(dir)
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) {
      // A symlinked skill directory is vendored upstream. Reported by the caller, never followed.
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) skipped.push(full)
      continue
    }
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      findSkillFiles(full, out, skipped, depth + 1)
    } else if (e.name === 'SKILL.md') out.push(full)
  }
  return out
}

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  let st
  try {
    st = statSync(dir)
  } catch {
    return []
  }
  if (!st.isDirectory()) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && filter(e.name))
      .map(e => join(dir, e.name))
      .sort()
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- bangs

/**
 * Regions of `text` inside a FENCED or INDENTED code block — where a bang still executes.
 *
 * Returned as [start, end) index pairs. An unclosed fence runs to end of file, which is what the
 * parser sees too.
 */
export function fencedRegions(text: string): [number, number][] {
  const out: [number, number][] = []
  const lines = text.split('\n')
  let offset = 0
  let openAt: number | null = null
  let marker = ''
  for (const line of lines) {
    const m = line.match(/^[ \t]*(```|~~~)/)
    if (m) {
      if (openAt === null) {
        openAt = offset
        marker = m[1]
      } else if (m[1] === marker) {
        out.push([openAt, offset + line.length])
        openAt = null
      }
    } else if (openAt === null && /^ {4,}\S/.test(line)) {
      // An indented code block. Measured to fire, so each such line is its own region.
      out.push([offset, offset + line.length])
    }
    offset += line.length + 1
  }
  if (openAt !== null) out.push([openAt, text.length])
  return out
}

/**
 * Regions covered by an INLINE code span, computed line by line so an unpaired backtick cannot
 * swallow the rest of the file.
 *
 * A bang anywhere inside one of these is INERT — measured, and the only protection there is.
 */
export function inlineSpans(text: string): [number, number][] {
  const out: [number, number][] = []
  const fences = fencedRegions(text)
  let offset = 0
  for (const line of text.split('\n')) {
    if (fences.some(([a, b]) => offset >= a && offset < b)) {
      offset += line.length + 1
      continue // inside a fence, a backtick is not a span delimiter
    }
    let open: number | null = null
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '`') continue
      if (open === null) open = i
      else {
        out.push([offset + open, offset + i + 1])
        open = null
      }
    }
    offset += line.length + 1
  }
  return out
}

const inAnySpan = (spans: [number, number][], i: number) => spans.some(([a, b]) => i >= a && i < b)

/**
 * Every bang in `text`, extracted the way the parser does: `!\`` up to the NEXT backtick, on the
 * same line. Anything after that backtick is not part of the command, which is precisely why a
 * backtick inside a command truncates it.
 */
export function parseBangs(file: string, text: string): Bang[] {
  const out: Bang[] = []
  const fences = fencedRegions(text)
  const spans = inlineSpans(text)
  const re = /!`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = m.index + 2
    const nl = text.indexOf('\n', start)
    const limit = nl === -1 ? text.length : nl
    const close = text.indexOf('`', start)
    if (close === -1 || close > limit) continue // not a bang: an unterminated `!\`` on one line
    const command = text.slice(start, close)
    out.push({
      file,
      line: lineOf(text, m.index),
      command,
      inProse: inAnySpan(fences, m.index),
      inert: inAnySpan(spans, m.index),
    })
    re.lastIndex = close + 1
  }
  return out
}

/** The first word of a bang command, with `${CLAUDE_SKILL_DIR}` substituted as the parser does. */
export function bangCommandWord(command: string, skillDir: string): string | null {
  const text = command.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, skillDir)
  const m = text.match(/^\s*([^\s;|&(]+)/)
  if (!m) return null
  let w = m[1].replace(/^["']|["']$/g, '')
  // A leading assignment (`d=...`) is not the command.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
    const rest = text.slice(text.indexOf(w) + w.length).match(/^[^\s;|&]*[\s;|&]+([^\s;|&(]+)/)
    if (!rest) return null
    w = rest[1].replace(/^["']|["']$/g, '')
  }
  return w || null
}

/** Does the command degrade instead of aborting when something it names is absent? */
export function hasFallback(command: string): boolean {
  return /command -v|\|\||\[ -x|\[ -f|\[ -r|;\s*then|2>\/dev\/null/.test(command)
}

const SHELL_BUILTINS = new Set(['cd', 'echo', 'test', 'exec', 'command', 'set', 'for', 'if', 'while', 'true', 'false', ':'])

export function resolvesOnPath(word: string): boolean {
  if (SHELL_BUILTINS.has(word)) return true
  if (word.includes('/')) return existsSync(word)
  const path = process.env.PATH ?? ''
  return path.split(':').filter(Boolean).some(d => {
    try {
      return statSync(join(d, word)).isFile()
    } catch {
      return false
    }
  })
}

/** Unbalanced quotes are the signature of a command the parser truncated at an inner backtick. */
export function quotesBalanced(command: string): boolean {
  let single = 0
  let dbl = 0
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === "'" && dbl % 2 === 0) single++
    else if (c === '"' && single % 2 === 0) dbl++
  }
  return single % 2 === 0 && dbl % 2 === 0
}

// ---------------------------------------------------------------- the checks

export function checkBangs(skill: SkillDir): Finding[] {
  const findings: Finding[] = []
  for (const b of skill.bangs) {
    // An inline code span is the one place a bang does not fire. Nothing to judge: it is neither a
    // live bang nor a load hazard.
    if (b.inert) continue
    if (b.inProse) {
      findings.push({
        rule: 'S2a bang written out in documentation executes at load',
        severity: 'critical',
        file: b.file,
        line: b.line,
        detail: `a bang carrying ${JSON.stringify(b.command)} sits in a fenced or indented code block — measured against claude@2.1.257, a fence does NOT protect a bang, so this EXECUTES on every load of this skill`,
        remedy: 'wrap it in an INLINE code span (the one place a bang is inert), or write the placeholder notation `<bang>`',
      })
      continue // the other three rules judge live bangs, and this one is not meant to be live
    }
    if (!quotesBalanced(b.command)) {
      findings.push({
        rule: 'S2d bang command truncated at an inner backtick',
        severity: 'critical',
        file: b.file,
        line: b.line,
        detail: `the extracted command ${JSON.stringify(b.command)} has unbalanced quotes — the parser stops at the FIRST backtick after \`!\`, so an inner backtick truncates the command and bash dies on the fragment, aborting the whole skill load`,
        remedy: 'remove every backtick from inside the bang command',
      })
    }
    if (/\$CLAUDE_SKILL_DIR(?![A-Za-z0-9_])/.test(b.command)) {
      findings.push({
        rule: 'S2b bang uses $CLAUDE_SKILL_DIR as a shell variable',
        severity: 'critical',
        file: b.file,
        line: b.line,
        detail: '`${CLAUDE_SKILL_DIR}` is substituted into the command TEXT before any shell sees it; the shell variable of that name does not exist, so this expands to the empty string',
        remedy: 'use the braced form `${CLAUDE_SKILL_DIR}`, or assign it first (`d=${CLAUDE_SKILL_DIR}; … "$d"`)',
      })
    }
    const word = bangCommandWord(b.command, skill.dir)
    if (word && !resolvesOnPath(word) && !hasFallback(b.command)) {
      findings.push({
        rule: 'S2c bang names a command that can be absent, with no fallback',
        severity: 'critical',
        file: b.file,
        line: b.line,
        detail: `${JSON.stringify(word)} does not resolve here, and the command has no degrading branch — a non-zero exit aborts the skill load, and command-not-found is 127`,
        remedy: 'guard it (`command -v x >/dev/null 2>&1 && exec x …; echo "(x unavailable: …)"`) so an absent tool degrades to a notice instead of taking the skill offline',
      })
    }
  }
  return findings
}

export function checkDiscoverability(skill: SkillDir, body: string): Finding[] {
  if (skill.hasToc) return []
  const owned = [...skill.references, ...skill.scripts, ...skill.rootCode]
  const unnamed = owned.filter(f => !body.includes(basename(f)))
  const invisible = unnamed.length
    ? `${unnamed.length} of ${owned.length} file(s) it owns are named by nothing at all: ${unnamed.slice(0, 6).map(f => relative(skill.dir, f)).join(', ')}${unnamed.length > 6 ? `, +${unnamed.length - 6} more` : ''}`
    : owned.length
      ? `its ${owned.length} file(s) are named in the prose today, which a rename or an addition silently ends`
      : 'it owns no references/ or scripts/ today, and the bang costs one line and prints so'
  return [{
    rule: 'S1 no TOC bang',
    severity: unnamed.length ? 'major' : 'minor',
    file: skill.skillMd,
    detail: `a skill load injects the base DIRECTORY and the body, never either folder's contents — ${invisible}`,
    remedy: 'add the canonical `skill-toc` TOC bang as the first line after the title',
  }]
}

const PATH_RE = /\$\{CLAUDE_SKILL_DIR\}\/([A-Za-z0-9._\-/]+)|(?:^|[\s(`"'])((?:references|scripts|constraints)\/[A-Za-z0-9._\-/]+\.[A-Za-z0-9]+)/g

export function checkPathRefs(
  skill: SkillDir,
  body: string,
  pluginRoot: string,
  elsewhere: Advisory[] = [],
): Finding[] {
  const findings: Finding[] = []
  const seen = new Set<string>()
  const fences = fencedRegions(body)
  let m: RegExpExecArray | null
  PATH_RE.lastIndex = 0
  while ((m = PATH_RE.exec(body)) !== null) {
    const rel = (m[1] ?? m[2]).replace(/[.,;:)]+$/, '')
    if (rel.includes('*') || rel.includes('<')) continue
    // A fenced block is an EXAMPLE. `scripts/my_script.py` there is a placeholder.
    if (inAnySpan(fences, m.index)) continue
    if (seen.has(rel)) continue
    seen.add(rel)
    const abs = resolve(skill.dir, rel)
    if (existsSync(abs)) continue
    // A path the prose hands to SOMEONE ELSE — another skill's references, or the user's own
    // project — is not this skill's to own, and whether it exists is not decidable from here. Said
    // on the advisory channel rather than dropped, because the reader still cannot open it.
    // Scoped to the whole LINE, not a window before the path: a table cell puts the qualifier
    // after the default value it qualifies.
    const lineStart = body.lastIndexOf('\n', m.index) + 1
    const lineEnd = body.indexOf('\n', m.index)
    const line = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd)
    if (/\bskill'?s\b|`[a-z0-9-]+`\s+skill\b|\bproject'?s?\b|\boutside this repo\b|\bbeside the source\b/i.test(line)) {
      elsewhere.push({
        rule: 'S3 the body names a path belonging to another skill or the user\'s project',
        file: skill.skillMd,
        line: lineOf(body, m.index),
        detail: `${rel} — not resolvable from this skill's base directory, and not this skill's to own; a reader cannot open it without knowing where the other one lives`,
      })
      continue
    }
    const shared = resolve(pluginRoot, rel)
    if (shared !== abs && existsSync(shared)) {
      findings.push({
        rule: 'S3 the body names a shared path as though it were the skill\'s own',
        severity: 'major',
        file: skill.skillMd,
        line: lineOf(body, m.index),
        detail: `${rel} exists at the plugin root (${shared}) but not in this skill — and a loaded skill is given only its OWN base directory, so a reader resolves this to ${abs}, which is not there`,
        remedy: 'spell it `${CLAUDE_PLUGIN_ROOT}/' + rel + '`, or reach it by a command on PATH — the shared corpus is not addressable by a skill-relative path',
      })
      continue
    }
    findings.push({
      rule: 'S3 the body names a path that does not exist',
      severity: 'major',
      file: skill.skillMd,
      line: lineOf(body, m.index),
      detail: `${rel} resolves to ${abs}, which is not on disk, and is not at the plugin root either`,
      remedy: 'fix the path, or delete the reference — a skill body is prose to every tool that reads it, so a rename leaves this pointing at nothing and nothing notices',
    })
  }
  return findings
}

export function frontmatterKeys(text: string): { key: string; line: number }[] {
  if (!text.startsWith('---')) return []
  const end = text.indexOf('\n---', 3)
  if (end < 0) return []
  const head = text.slice(4, end)
  const out: { key: string; line: number }[] = []
  const re = /^([a-zA-Z][\w-]*):/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(head)) !== null) out.push({ key: m[1], line: lineOf(text, m.index + 4) })
  return out
}

/**
 * Keys some constraint loader in `target` actually reads.
 *
 * A loader is identified by its source mentioning `applies-to` — the one key every loader must
 * handle — and a key counts as read when a loader names it as a string literal. Derived rather than
 * declared, so a loader learning a new key does not need this probe edited.
 */
/**
 * The plugin root enclosing `dir` — the nearest ancestor holding `.claude-plugin/`, else `dir`.
 *
 * S4 must be answered over the PLUGIN, never over the probe target: `teaching/skills/exams` holds
 * 14 constraints whose `name:` key is read by `teaching/scripts/load-constraints.py`, two levels up.
 * Deriving from the target alone reported all 14 as declaring a key nothing reads, while the finding
 * text said "no loader in this plugin" — the message and the computation disagreeing is what gave
 * it away.
 */
export function pluginRootOf(dir: string): string {
  let cur = resolve(dir)
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(cur, '.claude-plugin'))) return cur
    const up = dirname(cur)
    if (up === cur) break
    cur = up
  }
  return resolve(dir)
}

export function keysSomethingReads(target: string): Set<string> {
  const out = new Set<string>(['applies-to'])
  const loaders: string[] = []
  const walk = (dir: string, depth = 0) => {
    if (depth > 8) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1)
      } else if (/\.(py|ts|mts|js|mjs|sh)$/.test(e.name)) {
        const t = readTextOrNull(full)
        if (t && t.includes('applies-to')) loaders.push(t)
      }
    }
  }
  walk(target)
  for (const src of loaders) {
    for (const m of src.matchAll(/["'`]([a-zA-Z][\w-]{1,40})["'`]/g)) out.add(m[1])
  }
  return out
}

export function checkConstraintDocs(files: readonly string[], allowed: Set<string> = new Set(['applies-to'])): Finding[] {
  const findings: Finding[] = []
  for (const f of files) {
    const text = readTextOrNull(f)
    if (text === null) continue
    const keys = frontmatterKeys(text)
    const names = keys.map(k => k.key)
    // Only a SHARED corpus needs the scope declared; a skill-local one is scoped by its path.
    const shared = !/[/\\]skills[/\\][^/\\]+[/\\]constraints[/\\]/.test(f)
    if (shared && !names.includes('applies-to')) {
      findings.push({
        rule: 'S4 shared constraint declares no applies-to:',
        severity: 'major',
        file: f,
        detail: 'this corpus sits at the plugin root, so every skill can reach it and nothing else says which ones it governs — a rule in scope for nothing is not the same as a rule in scope for everything, and silence reads as the second',
        remedy: 'add `applies-to: [<scope>, …]`, or move the rule into the one skill that owns it, where the directory is the scope',
      })
    }
    for (const k of keys) {
      if (allowed.has(k.key)) continue
      findings.push({
        rule: 'S4 constraint declares a key nothing reads',
        severity: 'major',
        file: f,
        line: k.line,
        detail: `\`${k.key}:\` — no constraint loader in this plugin names it, so nothing reads it; the rule's name is its filename and whether it is mechanised is whether the .py beside it exists`,
        remedy: `delete \`${k.key}:\`, or make something read it`,
      })
    }
  }
  return findings
}

const WORD_NUM = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty'
const COUNT_RE = new RegExp(`\\b(\\d{1,3}|${WORD_NUM})\\s+(constraints?|rules?|checkers?|modules?|references?|skills?|lenses)\\b`, 'gi')

export function checkProseCounts(file: string, body: string): Advisory[] {
  const out: Advisory[] = []
  let m: RegExpExecArray | null
  COUNT_RE.lastIndex = 0
  while ((m = COUNT_RE.exec(body)) !== null) {
    out.push({
      rule: 'S5 a corpus count written in prose',
      file,
      line: lineOf(body, m.index),
      detail: `"${m[0]}" — a number in prose is a second representation of a fact the filesystem already holds, and it drifts on the next addition (rules/typst.md claimed 22 over a corpus of 21)`,
    })
  }
  return out
}

// ---------------------------------------------------------------- the probe

export interface ProbeOptions {
  /** Directories holding constraint docs, relative to the target. Default: every `constraints/`. */
  constraintDirs?: string[]
}

function findConstraintDirs(target: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out
  let entries
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink() || SKIP_DIRS.has(e.name)) continue
    const full = join(target, e.name)
    if (e.name === 'constraints') out.push(full)
    else findConstraintDirs(full, out, depth + 1)
  }
  return out
}

export function runProbe(target: string, _opts: ProbeOptions = {}): ProbeResult {
  const findings: Finding[] = []
  const advisories: Advisory[] = []
  const unresolvedRefs: UnresolvedRef[] = []
  const dirsSkipped: string[] = []
  const skills: ProbeResult['skills'] = []
  let filesScanned = 0

  const skillFiles = findSkillFiles(target, [], dirsSkipped)
  for (const d of dirsSkipped) {
    unresolvedRefs.push({
      rule: 'all',
      file: d,
      token: basename(d),
      reason: 'a symlinked directory — vendored upstream, and not this plugin\'s to judge',
    })
  }

  for (const skillMd of skillFiles) {
    const body = readTextOrNull(skillMd)
    if (body === null) {
      unresolvedRefs.push({ rule: 'all', file: skillMd, token: basename(skillMd), reason: 'unreadable' })
      continue
    }
    filesScanned++
    const dir = dirname(skillMd)
    const skill: SkillDir = {
      dir,
      name: relative(target, dir) || basename(dir),
      skillMd,
      references: listFiles(join(dir, 'references'), n => n.endsWith('.md')),
      scripts: listFiles(join(dir, 'scripts'), () => true),
      rootCode: listFiles(dir, n => CODE_EXT.has(extname(n))),
      bangs: parseBangs(skillMd, body),
      hasToc: /!`[^`]*skill-toc/.test(body),
    }
    findings.push(...checkBangs(skill))
    findings.push(...checkDiscoverability(skill, body))
    findings.push(...checkPathRefs(skill, body, target, advisories))
    advisories.push(...checkProseCounts(skillMd, body))
    skills.push({
      name: skill.name,
      references: skill.references.length,
      scripts: skill.scripts.length,
      rootCode: skill.rootCode.length,
      bangs: skill.bangs.length,
      hasToc: skill.hasToc,
    })
  }

  const constraintDocs: string[] = []
  // An ALL-CAPS basename in constraints/ is a register or a readme, not a rule — typst's
  // DROPPED.md is the retirement register its own suite reads. Rules are lowercase by convention
  // in every one of these plugins.
  for (const d of findConstraintDirs(target)) {
    constraintDocs.push(...listFiles(d, n => n.endsWith('.md') && n.slice(0, -3) !== n.slice(0, -3).toUpperCase()))
  }
  findings.push(...checkConstraintDocs(constraintDocs, keysSomethingReads(pluginRootOf(target))))
  filesScanned += constraintDocs.length

  return { target, findings, advisories, unresolvedRefs, skills, constraintDocs: constraintDocs.length, filesScanned, dirsSkipped }
}

// ---------------------------------------------------------------- CLI

export class ArgError extends Error {}
export class HelpRequested extends Error {}

export const USAGE = 'usage: sc-probe.ts --target <plugin-root-or-skill-dir> [--json]'

export function parseArgs(argv: string[]): { target: string; json: boolean } {
  let target: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--target') {
      target = argv[++i] ?? null
      if (target === null || target.startsWith('--')) throw new ArgError('--target requires a directory path')
    } else if (a.startsWith('--target=')) target = a.slice('--target='.length)
    else if (a === '-h' || a === '--help') throw new HelpRequested(USAGE)
    else throw new ArgError(`unknown argument ${JSON.stringify(a)} (${USAGE})`)
  }
  if (!target) throw new ArgError(`--target <plugin-root-or-skill-dir> is required (${USAGE})`)
  let resolved = target
  if (resolved === '~') resolved = homedir()
  else if (resolved.startsWith('~/')) resolved = join(homedir(), resolved.slice(2))
  resolved = resolve(resolved)
  if (!existsSync(resolved)) throw new ArgError(`--target does not exist: ${resolved}`)
  let st
  try {
    st = lstatSync(resolved)
  } catch {
    throw new ArgError(`--target is not readable: ${resolved}`)
  }
  if (!statSync(resolved).isDirectory()) throw new ArgError(`--target is not a directory: ${resolved}`)
  void st
  return { target: resolved, json }
}

export function formatText(result: ProbeResult): string {
  const lines: string[] = []
  const coverage = `${result.skills.length} skill(s), ${result.constraintDocs} constraint doc(s)`
  lines.push(
    result.findings.length === 0
      ? `sc-probe: CLEAN — ${coverage} under ${result.target}`
      : `sc-probe: ${result.findings.length} finding(s) — ${coverage} under ${result.target}`,
  )
  for (const u of result.unresolvedRefs) {
    lines.push(`  note: NOT CHECKED ${JSON.stringify(u.token)} in ${u.file} — ${u.reason}`)
  }
  for (const a of result.advisories) {
    lines.push(`  advisory: ${a.rule} — ${a.file}${a.line ? `:${a.line}` : ''} — ${a.detail}`)
  }
  for (const f of result.findings) {
    lines.push('')
    lines.push(`[${f.severity}] ${f.rule}`)
    lines.push(`  file:   ${f.file}${f.line ? `:${f.line}` : ''}`)
    lines.push(`  detail: ${f.detail}`)
    lines.push(`  remedy: ${f.remedy}`)
  }
  lines.push('')
  const bits = [`${result.findings.length} finding(s)`]
  if (result.advisories.length) bits.push(`${result.advisories.length} advisory (does not gate)`)
  if (result.unresolvedRefs.length) bits.push(`${result.unresolvedRefs.length} NOT CHECKED`)
  const withToc = result.skills.filter(s => s.hasToc).length
  lines.push(`sc-probe: END — ${bits.join(', ')} | ${result.skills.length} skill(s), ${withToc} with a TOC bang`)
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
    console.error(`sc-probe: ${(e as Error).message}`)
    return 2
  }
  let result: ProbeResult
  try {
    result = run(opts.target)
  } catch (e) {
    // 3, not 2: the arguments were fine and the probe still did not run.
    console.error(`sc-probe: failed to probe ${opts.target}: ${(e as Error).message}`)
    return 3
  }
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatText(result))
  return result.findings.length > 0 ? 1 : 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}
