// The per-edit Jev mod's pure half (hooks/jev/rules.ts): file -> rule set, the lines an edit
// changed, the threshold and the one line a violation becomes, and where the mod runs. The mod
// itself, under the engine's own host, is hooks/mod-tests/jev.test.ts (scripts/mod-test.sh).
import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  BLOCK_AT, RULE_DIRS, ancestors, changedFromInput, contextLines, enabled, merge, rangesFromDiff, ruleSetFor, workflowOf,
} from '../hooks/jev/rules.ts'

const ROOT = join(import.meta.dir, '..')
const ds = async () => 'ds'
const dev = async () => 'dev'
const none = async () => null

test('prose is writing, tests and shell scripts are dev, .py is ds only under a ds workflow', async () => {
  expect(await ruleSetFor('/p/drafts/intro.md', none)).toBe('writing')
  expect(await ruleSetFor('/p/paper.typ', none)).toBe('writing')
  expect(await ruleSetFor('/p/paper.tex', ds)).toBe('writing')
  expect(await ruleSetFor('/p/scripts/run.sh', none)).toBe('dev')
  expect(await ruleSetFor('/p/src/a.test.ts', none)).toBe('dev')
  expect(await ruleSetFor('/p/tests/test_merge.py', ds)).toBe('dev')
  expect(await ruleSetFor('/p/pkg/merge_test.go', none)).toBe('dev')
  expect(await ruleSetFor('/p/src/build.py', ds)).toBe('ds')
  expect(await ruleSetFor('/p/src/build.py', dev)).toBeNull()
  expect(await ruleSetFor('/p/src/build.py', none)).toBeNull()
  expect(await ruleSetFor('/p/src/app.ts', ds)).toBeNull()
  expect(await ruleSetFor('/p/data.json', none)).toBeNull()
})

test("a talk's deck and notes are typst; other .typ stays writing unless the cursor says workshop", async () => {
  const workshop = async () => 'workshop'
  expect(await ruleSetFor('/p/presentation/slides.typ', none)).toBe('typst')
  expect(await ruleSetFor('/p/presentation/notes.typ', none)).toBe('typst')
  expect(await ruleSetFor('/p/talk/notes-seminar.typ', none)).toBe('typst')
  expect(await ruleSetFor('/p/presentation/fragments.typ', none)).toBe('typst')
  expect(await ruleSetFor('/p/paper/body.typ', none)).toBe('writing')
  expect(await ruleSetFor('/p/paper/body.typ', workshop)).toBe('typst')
  expect(await ruleSetFor('/p/drafts/notes.md', none)).toBe('writing')
  // a lecture deck's per-lecture file is neither named slides* nor under presentation/
  expect(await ruleSetFor('/c/slides/05-10b5/15.typ', none)).toBe('writing')
})

test('the workflow walk asks each directory up to $HOME, nearest first', async () => {
  expect(ancestors('/home/u/p/src', '/home/u')).toEqual(['/home/u/p/src', '/home/u/p', '/home/u'])
  expect(ancestors('/opt/x', '/home/u')).toEqual(['/opt/x', '/opt', '/'])
  const asked: string[] = []
  await ruleSetFor('/home/u/p/src/build.py', async d => (asked.push(d), null))
  expect(asked).toEqual(['/home/u/p/src'])
  expect(workflowOf('---\nworkflow: ds\n---\n# plan')).toBe('ds')
  expect(workflowOf('---\nstyle: econ\n---')).toBeNull()
})

test('every rule set points at a wired directory; its uncalibrated/ is below the glob', () => {
  for (const dir of Object.values(RULE_DIRS)) {
    const wired = readdirSync(join(ROOT, dir)).filter(f => /^[^_].*\.py$/.test(f) && f !== 'evidence.py')
    expect(wired.length).toBeGreaterThan(0)
    expect(dir).not.toContain('uncalibrated')
  }
})

test('changed lines: Write is the whole file, an edit the span its new string occupies', () => {
  const text = 'alpha\nbeta\nnew one\nnew two\nomega\n'
  expect(changedFromInput('Write', { content: text }, text)).toEqual([[1, 5]])
  expect(changedFromInput('Edit', { old_string: 'c\nd', new_string: 'new one\nnew two' }, text)).toEqual([[3, 4]])
  expect(changedFromInput('Edit', { old_string: 'x', new_string: 'beta\n' }, text)).toEqual([[2, 2]])
  expect(changedFromInput('MultiEdit', { edits: [{ new_string: 'alpha' }, { new_string: 'omega' }] }, text)).toEqual([[1, 1], [5, 5]])
  // every occurrence: a string repeated elsewhere widens the span rather than misses it
  expect(changedFromInput('Edit', { new_string: 'new' }, text)).toEqual([[3, 4]])
  // a deletion or a string not in the file: the input cannot say, so the mod asks git
  expect(changedFromInput('Edit', { old_string: 'beta\n', new_string: '' }, text)).toBeNull()
  expect(changedFromInput('Edit', { new_string: 'zzz' }, text)).toBeNull()
})

test('git -U0 hunks become new-side spans; a pure deletion is the line after it', () => {
  const diff = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -3,0 +4,2 @@\n+x\n+y\n@@ -9 +11 @@\n-q\n+r\n@@ -20,2 +22,0 @@\n-s\n-t\n'
  expect(rangesFromDiff(diff)).toEqual([[4, 5], [11, 11], [23, 23]])
  expect(merge([[1, 2]], [[3, 4], [9, 9]])).toEqual([[1, 4], [9, 9]])
})

test('only rules at p >= 0.85 become a line, highest first; nothing when all pass', () => {
  expect(BLOCK_AT).toBe(0.85)
  const v = [
    { rule: 'W-ATTRIB', p: 0.849, statement: 'A claim rests on an unnamed authority' },
    { rule: 'W-HEDGE', p: 0.93, statement: 'The prose hedges more than its evidence warrants' },
    { rule: 'W-SIGNPOST', p: 0.97, statement: 'The prose ANNOUNCES instead of SAYING' },
  ]
  expect(contextLines(v, 'notes/a.md', [[3, 4], [9, 9]])).toEqual([
    'Jev W-SIGNPOST: notes/a.md:3-4,9 — The prose ANNOUNCES instead of SAYING (p=0.97)',
    'Jev W-HEDGE: notes/a.md:3-4,9 — The prose hedges more than its evidence warrants (p=0.93)',
  ])
  expect(contextLines(v.map(x => ({ ...x, p: 0.2 })), 'notes/a.md', [[1, 1]])).toEqual([])
})

test('interactive by default; headless only with JEV_EDIT_MOD=1; JEV_EDIT_MOD=0 everywhere off', () => {
  expect(enabled(undefined, true)).toBe(true)
  expect(enabled(undefined, false)).toBe(false)
  expect(enabled('', false)).toBe(false)
  expect(enabled('1', false)).toBe(true)
  expect(enabled('0', true)).toBe(false)
  expect(enabled('0', false)).toBe(false)
})
