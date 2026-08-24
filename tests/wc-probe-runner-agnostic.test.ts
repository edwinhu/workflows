import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const PROBE = join(import.meta.dir, '..', 'skills', 'workflow-creator', 'scripts', 'wc-probe.ts')

// P12(a) must fire on a hand-rolled dispatch whatever the runner is called. Keyed on the
// runner's filename it only ever caught the runner that happened to exist when it was written.
function probeOn(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'wcprobe-'))
  const skill = join(dir, 'handrolled'); mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'),
    `---\nname: handrolled\ndescription: "x"\n---\n\n# handrolled\n\n${body}\n\n` +
    '```json craft-args\n{"tasks":[{"id":"T1","name":"n","work":"w","writablePaths":["a"],"acceptance":"gate","refs":[]}]}\n```\n')
  // --target, not a bare positional: wc-probe's CLI takes no positional argument, and the
  // round-1 version of this test passing one is why an undeclared positional was added to
  // parseArgs at all. The test caused the scope creep it was then used to justify.
  const res = spawnSync('bun', [PROBE, '--target', skill], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  return (res.stdout || '') + (res.stderr || '')
}

test('P12(a) fires on a hand-rolled dispatch naming farm.sh', () => {
  expect(probeOn('Dispatch with `farm.sh` and the args file.')).toMatch(/P12|craft-dispatch/)
})

test('the P12(a) rule no longer depends on the literal string farm.ts', () => {
  const src = readFileSync(PROBE, 'utf8')
  expect(src.replace(/\\/g, '')).not.toContain('farm.ts')
})
