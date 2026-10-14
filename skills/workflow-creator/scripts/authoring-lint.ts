#!/usr/bin/env bun
/**
 * authoring-lint.ts — the authoring rules a string settles, over the lines a change ADDED.
 *
 * Usage:  bun authoring-lint.ts --target <dir> [--json]
 * Exit:   0 = no findings, 1 = findings, 2 = argument error or internal failure (could not look).
 *
 * Diff-scoped: inside a git work tree a file's added lines are `git diff -U0 HEAD` plus every line of
 * an untracked file; outside one, every line of every file counts. The corpus carries legacy instances
 * of L1 (74 measured 2026-10-02), and a whole-file lint would gate every edit on all of them.
 *
 * L1  the skill-dir variable followed by `/..` in a .md — climbing out of the skill's own directory
 *     means the target is a sibling skill or the plugin root, which the plugin-root variable names
 *     (.claude/CLAUDE.md, Path Variables).
 * L2  a new excuse/reality or "Your Drive" table header — both formats are retired; fact rows replace
 *     them (references/enforcement-checklist.md patterns 2 and 9).
 * L3  `"dependencies"` added to a plugin.json — on 2026-09-15 it made all three plugins fail to load
 *     (skills/skill-creator/SKILL.md, Where a thing goes).
 * L4  a file under .planning's .state dir other than review.json or episode.json, or a
 *     `*_CLARIFIED.json` sentinel, named in an added line (.claude/CLAUDE.md, State Files).
 *
 * L5  a workflow under checks/ with constraints that no skills/<skill>/scripts/check.sh reaches through
 *     `workflow-check <wf>`: its constraints never run in /work (plan-lint R24 asks a plan's
 *     mechanicalChecks to reach that call, and a check.sh is how a skill's plans do).
 * L6  a workflow under checks/ with wired Jev rules that no skills/<skill>/SKILL.md names (`workflow:
 *     <wf>`, `--workflow <wf>`, `workflow-check <wf>`): work-dispatch.sh scores a workflow's rules only
 *     for a plan that names it, so no skill naming it means its rules run nowhere.
 *     L5 and L6 are structural, not diff-scoped: they hold of the tree, and only in a tree that ships
 *     the runner (bin/workflow-check). Membership is the directory; nothing here lists a workflow.
 *
 * Test files and fixtures are skipped: they carry the violating strings on purpose.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { covers, runnerTargets, scriptReaches } from '../../work/scripts/plan-lint.ts'
import { changedRanges } from '../../work/scripts/rule-check.ts'

export interface Finding { rule: string; file: string; line: number; text: string }

const SKIP = new Set(['.git', 'node_modules', '__pycache__'])
const TEXT_EXT = /\.(md|json|ts|js|mjs|py|sh|ya?ml|toml|txt)$/i
const TEST_PATH = /(^|\/)(tests?|__tests__|fixtures)\/|[._-](test|spec)\.[A-Za-z]+$|\.fixture$/

export function lintLine(file: string, text: string): string[] {
  const out: string[] = []
  const md = /\.md$/i.test(file)
  if (md && /\$\{CLAUDE_SKILL_DIR\}\/\.\./.test(text)) out.push('L1 ${CLAUDE_SKILL_DIR} climbs out of its skill; name the target with ${CLAUDE_PLUGIN_ROOT}')
  if (md && /^\s*\|/.test(text) && (/\bexcuse\b/i.test(text) && /\breality\b/i.test(text) || /\byour drive\b/i.test(text)))
    out.push('L2 retired enforcement table (excuse/reality or Your Drive); state a fact row instead')
  if (/(^|\/)plugin\.json$/.test(file) && /"dependencies"\s*:/.test(text)) out.push('L3 "dependencies" in plugin.json takes the plugin down when the marketplace is unregistered')
  for (const m of text.matchAll(/\.planning\/\.state\/([\w.<>${}-]+)/g))
    if (!/^(review|episode)\.json$/.test(m[1]!)) out.push(`L4 non-canonical state file ${m[1]} in the .state dir (only review.json and episode.json)`)
  if (/\b[A-Z][A-Z<>X_-]*_CLARIFIED\.json\b/.test(text) && !/retired|retire/i.test(text)) out.push('L4 a _CLARIFIED.json sentinel; record the phase in episode.json or observe the tool call')
  return out
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    if (SKIP.has(n)) return []
    const p = join(dir, n)
    const st = statSync(p)
    return st.isDirectory() ? walk(p) : TEXT_EXT.test(n) ? [p] : []
  })
}

/** absolute file -> added line numbers (null = every line). With a valid WORK_RUN_BASELINE (the tree work-checks.sh
 *  exports) "added" means added since that tree, so WIP already present at dispatch is not the run's; else over HEAD. */
export function addedLines(target: string): Map<string, Set<number> | null> {
  target = realpathSync(target)
  const base = process.env.WORK_RUN_BASELINE
  if (base && /^[0-9a-f]{40,64}$/.test(base)) {
    const ranges = changedRanges(target, base)
    if (ranges) {
      const out = new Map<string, Set<number> | null>()
      const prefix = resolve(target) + '/'
      for (const [f, rs] of Object.entries(ranges)) {
        if (!f.startsWith(prefix)) continue
        const lines = new Set<number>()
        for (const [lo, hi] of rs) if (Number.isInteger(lo)) for (let k = lo; k <= hi; k++) lines.add(k)
        out.set(f, lines)
      }
      return out
    }
  }
  const git = (...a: string[]) => spawnSync('git', ['-C', target, '-c', 'core.quotepath=off', ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const top = git('rev-parse', '--show-toplevel')
  const out = new Map<string, Set<number> | null>()
  const diff = top.status === 0 ? git('diff', '--no-color', '--no-ext-diff', '-U0', 'HEAD', '--', '.') : null
  if (!diff || diff.status !== 0) {
    for (const f of walk(target)) out.set(f, null)
    return out
  }
  const root = top.stdout.trim()
  let cur: Set<number> | null = null
  for (const ln of diff.stdout.split('\n')) {
    if (ln.startsWith('+++ ')) {
      cur = ln === '+++ /dev/null' ? null : new Set<number>()
      if (cur) out.set(resolve(root, ln.slice(6)), cur)
      continue
    }
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ln)
    if (m && cur) {
      const start = Number(m[1])
      const n = m[2] === undefined ? 1 : Number(m[2])
      for (let k = start; k < start + n; k++) cur.add(k)
    }
  }
  const untracked = git('ls-files', '--others', '--exclude-standard', '--full-name', '--', '.')
  for (const f of untracked.stdout.split('\n').filter(Boolean)) out.set(resolve(root, f), null)
  return out
}

/** Runnable checks in a constraints/ or rules/ directory: `.py` files not starting with `_` or `.`. */
const runnable = (d: string): number =>
  existsSync(d) ? readdirSync(d).filter(f => /^[^_.].*\.py$/.test(f) && statSync(join(d, f)).isFile()).length : 0

/** Every workflow under <target>/checks/ (a `_` directory is not one; nested ones keep their `/`). */
export function layoutWorkflows(target: string): { wf: string; constraints: number; rules: number }[] {
  const out: { wf: string; constraints: number; rules: number }[] = []
  const walkWf = (rel: string) => {
    for (const n of readdirSync(join(target, 'checks', rel)).sort()) {
      const p = rel ? `${rel}/${n}` : n
      if (/^[_.]/.test(n) || n === 'constraints' || n === 'rules' || n === '__pycache__' || !statSync(join(target, 'checks', p)).isDirectory()) continue
      out.push({ wf: p, constraints: runnable(join(target, 'checks', p, 'constraints')), rules: runnable(join(target, 'checks', p, 'rules')) })
      walkWf(p)
    }
  }
  walkWf('')
  return out
}

/** Does a SKILL.md name `wf` for a plan: `workflow: <wf>`, `--workflow <wf>` or `workflow-check <wf>`?
 *  A placeholder (`writing/<domain>`) names every workflow nested under its prefix. */
function namesWorkflow(text: string, wf: string): boolean {
  const named = [...runnerTargets(text), ...[...text.matchAll(/(?:--workflow[=\s]+|\bworkflow:\s*)["'`]?([^\s"'`,]+)/g)].map(m => m[1]!)]
  return named.some(t => covers(t, wf) || (t.includes('<') && wf.startsWith(t.slice(0, t.indexOf('<')))))
}

/** L5/L6: every workflow's constraints are reached by some check.sh, every workflow's rules named by some skill. */
export function gateLaw(target: string): Finding[] {
  if (!existsSync(join(target, 'bin', 'workflow-check')) || !existsSync(join(target, 'checks'))) return []
  const skills = existsSync(join(target, 'skills')) ? readdirSync(join(target, 'skills')) : []
  const read = (rel: string) => (existsSync(join(target, rel)) ? readFileSync(join(target, rel), 'utf8') : null)
  // each check.sh with its directory, so the scripts it runs or sources are followed to the runner
  const checks = skills.map(k => ({ text: read(`skills/${k}/scripts/check.sh`), dir: join(target, 'skills', k, 'scripts') }))
    .filter((c): c is { text: string; dir: string } => c.text !== null)
  const docs = skills.map(k => read(`skills/${k}/SKILL.md`)).filter((t): t is string => t !== null)
  const out: Finding[] = []
  for (const { wf, constraints, rules } of layoutWorkflows(target)) {
    if (constraints && !checks.some(c => scriptReaches(c.text, wf, c.dir)))
      out.push({ rule: 'L5 a workflow with constraints that no check.sh reaches; its constraints never run in /work', file: `checks/${wf}/constraints`, line: 1, text: `expected: a skills/*/scripts/check.sh calling workflow-check ${wf}` })
    if (rules && !docs.some(t => namesWorkflow(t, wf)))
      out.push({ rule: 'L6 a workflow with wired Jev rules that no skill names; its rules run nowhere', file: `checks/${wf}/rules`, line: 1, text: `expected: a skills/*/SKILL.md naming workflow: ${wf} (or --workflow ${wf})` })
  }
  return out
}

export function lint(target: string): Finding[] {
  target = realpathSync(target)
  const findings: Finding[] = [...gateLaw(target)]
  for (const [file, lines] of addedLines(target)) {
    if (!TEXT_EXT.test(file) || TEST_PATH.test(relative(target, file)) || !existsSync(file)) continue
    const text = readFileSync(file, 'utf8').split('\n')
    text.forEach((t, i) => {
      if (lines && !lines.has(i + 1)) return
      for (const rule of lintLine(file, t)) findings.push({ rule, file: relative(target, file), line: i + 1, text: t.trim().slice(0, 200) })
    })
  }
  return findings
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const ti = argv.indexOf('--target')
  const target = ti >= 0 ? argv[ti + 1] : undefined
  if (!target || !existsSync(target) || !statSync(target).isDirectory()) {
    console.error('usage: authoring-lint.ts --target <dir> [--json]')
    process.exit(2)
  }
  try {
    const findings = lint(realpathSync(target))
    if (argv.includes('--json')) console.log(JSON.stringify({ findings }))
    else for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}\n    ${f.text}`)
    console.error(`authoring-lint: ${findings.length} finding(s) over the added lines under ${target}`)
    process.exit(findings.length ? 1 : 0)
  } catch (e) {
    console.error(`authoring-lint: internal failure — ${(e as Error).stack ?? e}`)
    process.exit(2)
  }
}
