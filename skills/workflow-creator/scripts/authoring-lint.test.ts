// authoring-lint.ts: each rule fires on an added line and stays quiet on the compliant form, and a
// violation already committed is not the change's.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(180_000)
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lint, lintLine } from './authoring-lint.ts'

const LINT = join(import.meta.dir, 'authoring-lint.ts')
const trash: string[] = []
afterAll(() => trash.forEach(d => rmSync(d, { recursive: true, force: true })))

// Assembled so this file holds no literal climb for a probe to resolve.
const CLIMB = '${CLAUDE_SKILL_DIR}' + '/../other-skill/SKILL.md'
const STATE = '.planning/.state/' + 'writing.json'

test('each rule fires on its violating line and not on the compliant one', () => {
  expect(lintLine('skills/a/SKILL.md', `Read ${CLIMB}.`)[0]).toStartWith('L1')
  expect(lintLine('skills/a/SKILL.md', 'Read ' + '${CLAUDE_PLUGIN_ROOT}' + '/skills/other-skill/SKILL.md.')).toEqual([])
  expect(lintLine('skills/a/SKILL.md', 'Run ' + '${CLAUDE_SKILL_DIR}' + '/scripts/x.ts')).toEqual([])
  expect(lintLine('skills/a/SKILL.md', '| Excuse | Reality |')[0]).toStartWith('L2')
  expect(lintLine('skills/a/SKILL.md', '| Your Drive | Why You Skip | What Actually Happens |')[0]).toStartWith('L2')
  expect(lintLine('skills/a/SKILL.md', '| About to | Do instead |')).toEqual([])
  expect(lintLine('.claude-plugin/plugin.json', '  "dependencies": ["typst"],')[0]).toStartWith('L3')
  expect(lintLine('.claude-plugin/plugin.json', '  "version": "1.0.0",')).toEqual([])
  expect(lintLine('skills/a/SKILL.md', `write \`${STATE}\``)[0]).toStartWith('L4')
  expect(lintLine('skills/a/SKILL.md', 'printf done > .planning/WRITING_CLARIFIED.json')[0]).toStartWith('L4')
  expect(lintLine('skills/a/SKILL.md', 'record it in `.planning/.state/episode.json`')).toEqual([])
  // the climb in a TS file is a string another check owns, not skill prose
  expect(lintLine('hooks/x.ts', `const p = '${CLIMB}'`)).toEqual([])
})

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'authoring-lint-'))
  trash.push(d)
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { timeout: 30_000, encoding: 'utf8' })
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  mkdirSync(join(d, 'skills', 'a'), { recursive: true })
  writeFileSync(join(d, 'skills', 'a', 'SKILL.md'), `---\nname: a\ndescription: d\n---\n\nLegacy: ${CLIMB}\n`)
  git('add', '-A'); git('commit', '-qm', 'base')
  return d
}

test('diff scope: a committed climb is not reported; an added one is, with its line', () => {
  const d = repo()
  expect(lint(join(d, 'skills', 'a'))).toEqual([])
  writeFileSync(join(d, 'skills', 'a', 'SKILL.md'), `---\nname: a\ndescription: d\n---\n\nLegacy: ${CLIMB}\nNew: ${CLIMB}\n`)
  writeFileSync(join(d, 'skills', 'a', 'notes.md'), `| Excuse | Reality |\n`)
  const f = lint(join(d, 'skills', 'a'))
  expect(f.map(x => `${x.file}:${x.line} ${x.rule.slice(0, 2)}`).sort()).toEqual(['SKILL.md:7 L1', 'notes.md:1 L2'])
})

test('WORK_RUN_BASELINE scopes the lint to the run: WIP present at dispatch is out, the run\'s own line is in; unset keeps HEAD scope', () => {
  const d = repo()
  const sk = join(d, 'skills', 'a')
  const md = (...extra: string[]) => `---\nname: a\ndescription: d\n---\n\nLegacy: ${CLIMB}\n${extra.join('\n')}\n`
  writeFileSync(join(sk, 'SKILL.md'), md(`WIP: ${CLIMB}`))
  const base = spawnSync('bash', [join(import.meta.dir, '..', '..', 'work', 'scripts', 'tree-snapshot.sh'), d], { encoding: 'utf8' }).stdout.trim()
  expect(base).toMatch(/^[0-9a-f]{40,64}$/)
  writeFileSync(join(sk, 'SKILL.md'), md(`WIP: ${CLIMB}`, 'Run: compliant'))
  const prev = process.env.WORK_RUN_BASELINE
  try {
    process.env.WORK_RUN_BASELINE = base
    expect(lint(sk)).toEqual([])
    writeFileSync(join(sk, 'SKILL.md'), md(`WIP: ${CLIMB}`, `Run: ${CLIMB}`))
    expect(lint(sk).map(x => `${x.file}:${x.line}`)).toEqual(['SKILL.md:8'])
    delete process.env.WORK_RUN_BASELINE
    expect(lint(sk).map(x => `${x.file}:${x.line}`)).toEqual(['SKILL.md:7', 'SKILL.md:8'])
    process.env.WORK_RUN_BASELINE = 'not-a-tree'
    expect(lint(sk).map(x => `${x.file}:${x.line}`)).toEqual(['SKILL.md:7', 'SKILL.md:8'])
  } finally {
    if (prev === undefined) delete process.env.WORK_RUN_BASELINE
    else process.env.WORK_RUN_BASELINE = prev
  }
})

test('outside git every line counts; exit codes are 0, 1 and 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'authoring-lint-nogit-'))
  trash.push(d)
  writeFileSync(join(d, 'SKILL.md'), '---\nname: a\ndescription: d\n---\n\nclean\n')
  const run = (...a: string[]) => spawnSync('bun', [LINT, ...a], { timeout: 120_000, encoding: 'utf8' }).status
  expect(run('--target', d)).toBe(0)
  writeFileSync(join(d, 'SKILL.md'), `clean\n${CLIMB}\n`)
  expect(run('--target', d)).toBe(1)
  expect(run('--target', join(d, 'missing'))).toBe(2)
  expect(run()).toBe(2)
})

// ---- L5 / L6: a workflow's constraints are reached by a check.sh, its Jev rules named by a skill ----------

import { gateLaw } from './authoring-lint.ts'

function plugin(opts: { check?: string; skill?: string; extra?: Record<string, string> }): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-law-'))
  trash.push(d)
  const w = (p: string, body: string) => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), body) }
  w('bin/workflow-check', '#!/usr/bin/env python3\n')
  w('checks/ds/constraints/ds-join-audits.py', '')
  w('checks/ds/constraints/_helper.py', '')
  w('checks/ds/rules/M1.py', '')
  w('checks/ds/rules/uncalibrated/DQ1.py', '')
  w('checks/_jev/evidence.py', '')
  w('skills/ds/SKILL.md', opts.skill ?? 'The plan opens with frontmatter `workflow: ds`.\n')
  w('skills/ds/scripts/check.sh', opts.check ?? 'python3 "$HERE/../../../bin/workflow-check" ds --project-dir . --constraints-only\n')
  for (const [p, body] of Object.entries(opts.extra ?? {})) w(p, body)
  return d
}

test('L5: a workflow whose constraints no check.sh reaches is flagged; a comment naming the runner is not a call', () => {
  expect(gateLaw(plugin({}))).toEqual([])
  const f = gateLaw(plugin({ check: 'echo hand-listed legs\n# bin/workflow-check ds --constraints-only\n' }))
  expect(f.map(x => x.rule.slice(0, 2))).toEqual(['L5'])
  expect(f[0]!.file).toBe('checks/ds/constraints')
})

test('L5: a nested workflow is reached through a check.sh that passes the register as an expansion', () => {
  const nested = { 'checks/writing/constraints/w.py': '', 'checks/writing/legal/constraints/v.py': '', 'skills/writing/SKILL.md': 'workflow: writing\n' }
  const reached = plugin({ extra: { ...nested, 'skills/writing/scripts/check.sh': 'case "$S" in legal) WF="writing/$S" ;; *) WF="writing" ;; esac\npython3 bin/workflow-check "$WF" --constraints-only\n' } })
  expect(gateLaw(reached)).toEqual([])
  const unreached = plugin({ extra: { ...nested, 'skills/writing/scripts/check.sh': 'python3 bin/workflow-check writing --constraints-only\n' } })
  expect(gateLaw(unreached).map(x => x.file)).toEqual(['checks/writing/legal/constraints'])
})

test('L6: a workflow with wired Jev rules that no SKILL.md names is flagged; uncalibrated/ and helpers count for nothing', () => {
  expect(gateLaw(plugin({ skill: 'no workflow named here\n' })).map(x => `${x.rule.slice(0, 2)} ${x.file}`)).toEqual(['L6 checks/ds/rules'])
  expect(gateLaw(plugin({ skill: "ruleChecks: { cmd: 'bun rule-check.ts --workflow ds' }\n" }))).toEqual([])
  expect(gateLaw(plugin({ extra: { 'checks/elide/rules/uncalibrated/EL-X.py': '', 'checks/elide/rules/_elide.py': '' } }))).toEqual([])
})

test('L5/L6 hold only of a tree that ships the runner', () => {
  const d = plugin({ check: 'echo nothing\n', skill: 'nothing\n' })
  rmSync(join(d, 'bin'), { recursive: true, force: true })
  expect(gateLaw(d)).toEqual([])
})

test('the law holds of this plugin as it stands', () => {
  expect(gateLaw(join(import.meta.dir, '..', '..', '..'))).toEqual([])
})

test('L4: a _CLARIFIED.json named as retired history is not a sentinel; the same name as a live write is', () => {
  expect(lintLine('skills/a/SKILL.md', 'the WORK_CLARIFIED.json sentinel was retired')).toEqual([])
  expect(lintLine('skills/a/SKILL.md', 'the DEV_CLARIFIED.json sentinel is written')[0]).toStartWith('L4')
  // the two canonical state files are not "non-canonical"; any other .state file is
  expect(lintLine('skills/a/SKILL.md', 'read .planning/.state/review.json')).toEqual([])
  expect(lintLine('skills/a/SKILL.md', 'read .planning/.state/other.json')[0]).toStartWith('L4')
})
