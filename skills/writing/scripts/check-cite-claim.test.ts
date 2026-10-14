// check.sh's cite-claim leg must fail when a section's probe verdict is missing or unparseable:
// an absent verdict read as a clean one is a citation gate that examined fewer sections than exist.
import { expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { useTmp } from '../../../tests/helpers/tmp.ts'

setDefaultTimeout(60_000)
const mkTmp = useTmp()
const CHECK = join(import.meta.dir, 'check.sh')

/** Three drafts; a stub `uv` answers the probe per draft: JSON for all but `bad`, which gets `badOut` ('' = nothing). */
function run(badOut: string, badExit = 0) {
  const d = mkTmp('wchk-cite-')
  mkdirSync(join(d, 'drafts')); mkdirSync(join(d, 'bin'))
  for (const s of ['A', 'B', 'C']) writeFileSync(join(d, 'drafts', `${s}.md`), 'x\n')
  writeFileSync(join(d, 'refs.bib'), ''); writeFileSync(join(d, 'plan.md'), '# Plan\n')
  const stub = `#!/usr/bin/env bash
case "$*" in
  *writing_gate_probe.py*)
    case "$*" in
      *C.md*) printf '%s' '${badOut}'; exit ${badExit} ;;
      *) echo '{"pass": true, "citesChecked": 2}'; exit 0 ;;
    esac ;;
  *writing_section_index.py*) echo '{"ok": true, "sections": [1]}'; exit 0 ;;
  *) exit 0 ;;
esac
`
  writeFileSync(join(d, 'bin', 'uv'), stub); chmodSync(join(d, 'bin', 'uv'), 0o755)
  return spawnSync('bash', [CHECK, '--project', d, '--bib', join(d, 'refs.bib'), '--plan', join(d, 'plan.md'),
    '--plan-hash', 'h', '--style', 'general'],
    { encoding: 'utf8', timeout: 50_000, env: { ...process.env, PATH: `${join(d, 'bin')}:${process.env.PATH}` } })
}
const legExit = (r: { stdout: string }) => Number(/^leg cite-claim exit=(\d+)/m.exec(r.stdout)?.[1])

test('every probe verdict parsed: the leg passes', () => {
  expect(legExit(run('{"pass": true, "citesChecked": 1}'))).toBe(0)
})
test('a probe that exits 0 with unparseable output fails the leg', () => {
  const r = run('warning: not json')
  expect(r.stderr).toContain('cite-claim: 2 section(s) examined of 3')
  expect(legExit(r)).not.toBe(0)
})
test('a probe that prints nothing fails the leg', () => {
  expect(legExit(run(''))).not.toBe(0)
})
