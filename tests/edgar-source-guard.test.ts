/**
 * hooks/edgar-source-guard.ts: a script edited to contain a sec.gov filing URL gets advisory
 * context pointing at the WRDS route. Never a deny, prose never flags, other sec.gov URLs never
 * flag. Each case spawns the settings-hook script, as tests/farm-detach-guard.test.ts does.
 */
import { expect, test, setDefaultTimeout } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(150_000)

const REPO = dirname(import.meta.dir)
const HOOK = join(REPO, 'hooks', 'edgar-source-guard.ts')
const mkTmp = useTmp()
const dir = mkTmp('edgar-guard-')

const ARCHIVES = 'https://www.sec.gov/Archives/edgar/data/1034196/000110465920000437/d1d8k.htm'
const SUBMISSIONS = 'https://data.sec.gov/submissions/CIK0001034196.json'

function run(path: string, tool = 'Write', content?: string): { code: number | null; stdout: string; context: string | null } {
  if (content !== undefined) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  const r = spawnSync('bun', [HOOK], {
    timeout: 60_000,
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: tool, cwd: dir, session_id: 's', tool_input: { file_path: path } }),
  })
  const stdout = (r.stdout ?? '').trim()
  const out = stdout ? JSON.parse(stdout) : null
  // Advisory: never a deny, whatever the input.
  expect(stdout).not.toContain('permissionDecision')
  expect(stdout).not.toContain('"deny"')
  return { code: r.status, stdout, context: out?.hookSpecificOutput?.additionalContext ?? null }
}

let n = 0
const file = (name: string) => join(dir, `c${n++}`, name)

test('every filing URL form flags a Python script, with the full advisory text', () => {
  for (const line of [
    `url = "${ARCHIVES}"`,
    `requests.get("${SUBMISSIONS}")`,
    'x = "HTTPS://WWW.SEC.GOV/ARCHIVES/edgar/data/1/2.txt"',
    'x = "sec.gov/archives/edgar"',
    String.raw`re.compile(r"sec\.gov/Archives/edgar")`,
    String.raw`re.compile(r"data\.sec\.gov\/submissions")`,
    String.raw`re.compile(r"sec\.gov\/Archives")`,
  ]) {
    const p = file('a.py')
    const r = run(p, 'Write', `import requests\n${line}\n`)
    expect(r.code, line).toBe(0)
    expect(r.context, line).toBe(
      `EDGAR SOURCE: ${p} has sec.gov filing URLs (line 2). Filing lists, text and exhibits come from WRDS: ` +
        'load the `workflows:edgar` skill before running or extending this. sec.gov is only for a single-filing ' +
        'spot check or filings newer than WRDS. Advisory; nothing was blocked.',
    )
  }
})

test('script suffixes flag, case-insensitively', () => {
  const line = `u = "${ARCHIVES}"\n`
  for (const name of [
    'a.py', 'a.PY', 'a.pyw', 'a.ipynb', 'a.sh', 'a.bash', 'a.zsh', 'a.fish', 'a.r', 'a.R', 'a.Rmd', 'a.qmd', 'a.jl',
    'a.js', 'a.mjs', 'a.cjs', 'a.ts', 'a.tsx', 'a.mts', 'a.go', 'a.rs', 'a.rb', 'a.pl', 'a.sas', 'a.do', 'a.sql', 'a.java',
  ]) {
    expect(run(file(name), 'Write', line).context, name).toContain('EDGAR SOURCE')
  }
})

test('an extensionless file flags only when it starts with a shebang', () => {
  expect(run(file('fetch'), 'Write', `#!/bin/sh\ncurl ${ARCHIVES}\n`).context).toContain('line 2')
  expect(run(file('notes'), 'Write', `curl ${ARCHIVES}\n`).context).toBeNull()
})

test('prose and other file types never flag', () => {
  for (const name of ['a.md', 'a.txt', 'a.typ', 'a.json', 'a.html', 'a.tex', 'a.csv', 'a.py.md']) {
    expect(run(file(name), 'Write', `see ${ARCHIVES} and ${SUBMISSIONS}\n`).context, name).toBeNull()
  }
})

test('other sec.gov URLs never flag', () => {
  const text = [
    'https://www.sec.gov/files/rules/final/2020/33-10890.pdf',
    'https://www.sec.gov/rules/final/2020.htm',
    'https://data.sec.gov/api/xbrl/companyfacts/CIK0001034196.json',
    'https://efts.sec.gov/LATEST/search-index?q=x',
    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany',
    'archives are fine, submissions too',
  ].join('\n')
  const r = run(file('a.py'), 'Write', text + '\n')
  expect(r.code).toBe(0)
  expect(r.stdout).toBe('')
})

test('line numbers: all listed up to five, then +N more', () => {
  const lines = Array.from({ length: 30 }, (_, i) => ([2, 9, 30].includes(i + 1) ? `u${i} = "${ARCHIVES}"` : `x${i} = 1`))
  expect(run(file('a.py'), 'Write', lines.join('\n') + '\n').context).toContain('(line 2, 9, 30)')
  const many = Array.from({ length: 8 }, (_, i) => `u${i} = "${ARCHIVES}"`)
  expect(run(file('b.py'), 'Write', many.join('\n') + '\n').context).toContain('(line 1, 2, 3, 4, 5, +3 more)')
})

test('an Edit of an unrelated line still flags a file that already has the URL', () => {
  const p = file('a.py')
  const r = run(p, 'Edit', `u = "${ARCHIVES}"\n${'x = 1\n'.repeat(40)}y = 2\n`)
  expect(r.context).toContain('line 1)')
})

test('a clean script is silent', () => {
  const r = run(file('a.py'), 'Edit', 'import pandas\nprint(1)\n')
  expect(r.code).toBe(0)
  expect(r.stdout).toBe('')
})

test('tools other than Edit and Write are silent, even on a flagged file', () => {
  const p = file('a.py')
  run(p, 'Write', `u = "${ARCHIVES}"\n`)
  for (const tool of ['Read', 'Bash', 'MultiEdit', 'NotebookEdit']) expect(run(p, tool).stdout, tool).toBe('')
})

test('a missing file, an empty path and a missing file_path are silent', () => {
  expect(run(join(dir, 'nope', 'gone.py')).stdout).toBe('')
  expect(run('').stdout).toBe('')
  const r = spawnSync('bun', [HOOK], {
    encoding: 'utf8', timeout: 60_000, input: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
  })
  expect([r.status, r.stdout]).toEqual([0, ''])
})

test("the guard's own source and its entry point are not flagged by it", () => {
  for (const f of ['hooks/guards/edgar-source.ts', 'hooks/edgar-source-guard.ts']) {
    const p = join(REPO, f)
    expect(readFileSync(p, 'utf8').length).toBeGreaterThan(0)
    expect(run(p).stdout, f).toBe('')
  }
})
