#!/usr/bin/env bun
/**
 * authoring-lint.ts — the authoring rules a string settles, over the lines a change ADDED.
 *
 * Usage:  bun authoring-lint.ts --target <dir> [--json]
 * Exit:   0 = no findings, 1 = findings, 2 = argument error.
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
 * Test files and fixtures are skipped: they carry the violating strings on purpose.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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

/** absolute file -> added line numbers (null = every line). */
export function addedLines(target: string): Map<string, Set<number> | null> {
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

export function lint(target: string): Finding[] {
  const findings: Finding[] = []
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
  const findings = lint(resolve(target))
  if (argv.includes('--json')) console.log(JSON.stringify({ findings }))
  else for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}\n    ${f.text}`)
  console.error(`authoring-lint: ${findings.length} finding(s) over the added lines under ${target}`)
  process.exit(findings.length ? 1 : 0)
}
