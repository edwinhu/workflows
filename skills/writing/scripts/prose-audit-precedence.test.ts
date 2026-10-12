// scripts/prose-audit.py's load order names the system of a span several tables match at equal severity
// and length. Discovering the tables from checks/writing/ must keep the order the hand-named lists had,
// and a table dropped into the directory must be audited without taking a span from a system that
// already reports it.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from '../../../tests/helpers/tmp.ts'

setDefaultTimeout(120_000)
const mkTmp = useTmp()
const ROOT = join(import.meta.dir, '..', '..', '..')
// wikipedia-structural and wikipedia-communication both match `Certainly!` (soft, 10 characters); Strunk too.
const OPENER = 'Certainly! The sample covers every listed firm.\n'

function spans(draft: string, checksPath?: string): { system: string; labels: string[] }[] {
  const env: Record<string, string | undefined> = { ...process.env, WORKFLOW_CHECKS_PATH: checksPath }
  if (!checksPath) delete env.WORKFLOW_CHECKS_PATH
  const r = spawnSync('uv', ['run', '--quiet', '--with', 'lxml,pyyaml', 'python3', join(ROOT, 'scripts', 'prose-audit.py'), '--json', draft],
    { encoding: 'utf8', timeout: 100_000, env })
  expect([0, 1], `${r.stdout}${r.stderr}`).toContain(r.status)
  return JSON.parse(r.stdout).spans
}

test('a span three tables match is reported under the system that reported it before discovery', () => {
  const draft = join(mkTmp('pa-order-'), 'draft.md')
  writeFileSync(draft, OPENER)
  const [span, ...rest] = spans(draft)
  expect(rest).toEqual([])
  expect(span.system).toBe('wikipedia-structural')
  expect(span.labels).toEqual([
    'wikipedia-structural: structure: chatbot opener at start of paragraph',
    "wikipedia-communication: chatbot opener: 'Certainly!'",
    "writing-general: S&W §V: 'Certainly' as intensifier — often empty",
  ])
})

test('a dropped table is audited but takes no span from a system that already reports it', () => {
  const d = mkTmp('pa-drop-')
  const table = join(d, 'plug', 'checks', 'writing', 'constraints')
  mkdirSync(table, { recursive: true })
  writeFileSync(join(table, 'aa-opener.py'), 'AUDIT_SYSTEM = "aa-dropped"\n_PATTERNS = [(r"^Certainly!", "dropped opener")]\n')
  const draft = join(d, 'draft.md')
  writeFileSync(draft, OPENER)
  const [span] = spans(draft, [join(d, 'plug'), ROOT].join(delimiter))
  expect(span.labels).toContain('aa-dropped: dropped opener')
  expect(span.system).toBe('wikipedia-structural')
})
