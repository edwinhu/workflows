// check.sh's writing-gate leg runs every writing constraint (bin/workflow-check writing --constraints-only)
// over the project's changed files. The prose tables read a .docx through scripts/prose_extract.py, which
// needs lxml, so a changed Word file must be read and judged like any other draft: a finding at its path,
// never a constraint that could not run.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from '../../../tests/helpers/tmp.ts'

setDefaultTimeout(180_000)
const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..', '..', '..')
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** A writing project with a clean drafts/ section and an untracked Word export carrying a chatbot opener. */
function project(): string {
  const d = mkTmp('wchk-docx-')
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8', timeout: 60_000 })
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(d, 'README.md'), 'x\n'); git('add', '-A'); git('commit', '-qm', 'i')
  mkdirSync(join(d, 'drafts')); mkdirSync(join(d, 'exports'))
  writeFileSync(join(d, 'drafts', 'Intro.md'), 'Plain opening paragraph here.\n\nA second plain paragraph follows it.\n')
  writeFileSync(join(d, 'refs.bib'), '')
  writeFileSync(join(d, 'plan.md'), '# Plan\n')
  // word/document.xml with one paragraph: the part prose_extract reads a .docx from.
  const xml = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Certainly! The sample covers every listed firm.</w:t></w:r></w:p></w:body></w:document>`
  const z = spawnSync('python3', ['-c', 'import sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], "w") as z:\n    z.writestr("word/document.xml", sys.argv[2])',
    join(d, 'exports', 'Intro.docx'), xml], { encoding: 'utf8', timeout: 60_000 })
  expect(z.status, z.stderr).toBe(0)
  return d
}

test('check.sh judges a changed .docx with the writing constraints: its finding is reported, the leg is not could-not-run', () => {
  const p = project()
  const r = spawnSync('bash', [join(ROOT, 'skills', 'writing', 'scripts', 'check.sh'), '--project', p, '--bib', join(p, 'refs.bib'),
    '--plan', join(p, 'plan.md'), '--plan-hash', 'h', '--style', 'general'],
    { encoding: 'utf8', timeout: 170_000, env: { ...process.env, WORKFLOW_CHECKS_PATH: ROOT } })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  expect(out).toContain('exports/Intro.docx:1: wikipedia-structural-patterns')
  expect(out).toMatch(/^leg writing-gate exit=1$/m)
})
