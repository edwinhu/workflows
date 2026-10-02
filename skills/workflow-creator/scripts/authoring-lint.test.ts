// authoring-lint.ts: each rule fires on an added line and stays quiet on the compliant form, and a
// violation already committed is not the change's.
import { afterAll, expect, test } from 'bun:test'
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
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' })
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

test('outside git every line counts; exit codes are 0, 1 and 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'authoring-lint-nogit-'))
  trash.push(d)
  writeFileSync(join(d, 'SKILL.md'), '---\nname: a\ndescription: d\n---\n\nclean\n')
  const run = (...a: string[]) => spawnSync('bun', [LINT, ...a], { encoding: 'utf8' }).status
  expect(run('--target', d)).toBe(0)
  writeFileSync(join(d, 'SKILL.md'), `clean\n${CLIMB}\n`)
  expect(run('--target', d)).toBe(1)
  expect(run('--target', join(d, 'missing'))).toBe(2)
  expect(run()).toBe(2)
})
