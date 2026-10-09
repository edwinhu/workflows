/**
 * Retractable floors and the default stall limit.
 *
 * A floor used to be permanent, and only a subject could be reopened: in board-structuring's
 * s220-deterrence run (2026-10-08) an operator note withdrawing a floor was ignored, status still
 * counted it and every pass kept honouring it. A `reopen` naming the floor's `key` with a
 * `rerunReason` now retracts it, read by journal position, and a later floor on the same key is live
 * again. The same run spent passes that only re-ran the check and filed an attempt, because
 * `--stall-after` defaulted to 0; it now defaults to 3.
 *
 * Run: bun test skills/grind/scripts/grind-floor-retract.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { grindEnv } from './grind-test-env'
import { tmpDir, useTmp } from '../../../tests/helpers/tmp.ts'

useTmp()

const GRIND = `${import.meta.dir}/grind.sh`

function script(dir: string, name: string, body: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

function grind(args: string[]) {
  return spawnSync('bash', [GRIND, ...args], { encoding: 'utf8', timeout: 60_000, env: grindEnv() })
}

function records(journal: string): any[] {
  if (!existsSync(journal)) return []
  return readFileSync(journal, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
    try { return [JSON.parse(l)] } catch { return [] }
  })
}
const kinds = (journal: string, kind: string) => records(journal).filter(r => r.kind === kind)

const append = (journal: string, rec: object) => grind(['append', '--journal', journal, JSON.stringify(rec)])

/** One pass with a runner that saves the prompt it was handed, so the GRIND_FLOORS block is read
 *  from what an iteration actually sees. */
function onePassPrompt(d: string, journal: string): string {
  const saved = join(d, 'prompt-seen.txt')
  const runner = script(d, 'runner.sh', [
    `while [ $# -gt 0 ]; do [ "$1" = "-p" ] && { printf '%s' "$2" > ${saved}; break; }; shift; done`,
    'exit 0',
  ].join('\n'))
  const check = script(d, 'check.sh', 'exit 1')
  writeFileSync(join(d, 'prompt.txt'), 'work')
  const r = grind(['run', '--journal', journal, '--check', check, '--runner', runner,
    '--prompt-file', join(d, 'prompt.txt'), '--max-iters', '1', '--sleep', '0', '--notify', 'none',
    '--no-events'])
  expect(r.status).toBe(4)
  return readFileSync(saved, 'utf8')
}

const floorsBlock = (prompt: string) => prompt.split('GRIND_SUBJECTS:')[0]

describe('grind.sh — a reopen naming a floor key retracts that floor', () => {
  test('floor → reopen(key) leaves the floor out of floors, status and the prompt', () => {
    const d = tmpDir('grind-retract-')
    const j = join(d, 'journal.jsonl')
    expect(append(j, { kind: 'floor', key: 'numeric-estimates', why: 'positive-only outcomes' }).status).toBe(0)
    expect(append(j, { kind: 'floor', key: 'keep-me', why: 'still dead' }).status).toBe(0)
    expect(grind(['floors', '--journal', j]).stdout).toContain('numeric-estimates')

    const r = append(j, { kind: 'reopen', key: 'numeric-estimates', rerunReason: 'operator: estimate on the provisional pool' })
    expect(r.status).toBe(0)

    const floors = grind(['floors', '--journal', j])
    expect(floors.status).toBe(0)
    expect(floors.stdout).not.toContain('numeric-estimates')
    expect(floors.stdout).toContain('keep-me')
    expect(grind(['status', '--journal', j]).stdout).toMatch(/^floors:\s+1$/m)

    const block = floorsBlock(onePassPrompt(d, j))
    expect(block).not.toContain('numeric-estimates')
    expect(block).toContain('keep-me')
  })

  test('a floor filed again after the reopen is live again', () => {
    const d = tmpDir('grind-refloor-')
    const j = join(d, 'journal.jsonl')
    append(j, { kind: 'floor', key: 'K1', why: 'first' })
    append(j, { kind: 'reopen', key: 'K1', rerunReason: 'new source arrived' })
    expect(grind(['floors', '--journal', j]).stdout).not.toContain('K1')

    expect(append(j, { kind: 'floor', key: 'K1', why: 'dead again after the new source' }).status).toBe(0)
    const floors = grind(['floors', '--journal', j])
    expect(floors.stdout).toContain('K1\tdead again after the new source')
    expect(grind(['status', '--journal', j]).stdout).toMatch(/^floors:\s+1$/m)
    expect(floorsBlock(onePassPrompt(d, j))).toContain('K1')
  })

  test('a reopen with a key but no rerunReason is refused and writes nothing', () => {
    const d = tmpDir('grind-retract-noreason-')
    const j = join(d, 'journal.jsonl')
    append(j, { kind: 'floor', key: 'K1', why: 'dead' })
    const before = readFileSync(j, 'utf8')

    for (const rec of [{ kind: 'reopen', key: 'K1' }, { kind: 'reopen', key: 'K1', rerunReason: '  ' }]) {
      const r = append(j, rec)
      expect(r.status).toBe(2)
      expect(r.stderr).toContain('rerunReason')
    }
    // Neither a key nor a subject: refused too.
    expect(append(j, { kind: 'reopen', rerunReason: 'something changed' }).status).toBe(2)
    expect(readFileSync(j, 'utf8')).toBe(before)
    expect(grind(['floors', '--journal', j]).stdout).toContain('K1')
  })
})

describe('grind.sh run — stall detection is on by default', () => {
  test('with no --stall-after, three passes without progress end the run stalled', () => {
    const d = tmpDir('grind-stall-default-')
    const j = join(d, 'journal.jsonl')
    const check = script(d, 'check.sh', 'echo "CHECK FAIL: main not estimated"; exit 1')
    // The s220 shape: each pass sees the same failure and files an attempt and a note, never progress.
    const runner = script(d, 'runner.sh', [
      `bash ${GRIND} append --journal ${j} '{"kind":"attempt","subject":"results","note":"same CHECK FAIL"}'`,
      `bash ${GRIND} append --journal ${j} '{"kind":"note","key":"gate","note":"check still red"}'`,
      'exit 0',
    ].join('\n'))
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = grind(['run', '--journal', j, '--check', check, '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'), '--max-iters', '10', '--sleep', '0', '--notify', 'none',
      '--no-events'])

    expect(r.status).toBe(3)
    expect(kinds(j, 'iter').length).toBe(3)
    expect(records(j).at(-1)?.kind).toBe('stalled')
  })

  test('a progress record resets the default stall count', () => {
    const d = tmpDir('grind-stall-progress-')
    const j = join(d, 'journal.jsonl')
    const counter = join(d, 'n')
    writeFileSync(counter, '0')
    const check = script(d, 'check.sh', 'exit 1')
    // Progress on passes 1 and 2 only, so the stall streak starts at pass 3 and fires before pass 6.
    const runner = script(d, 'runner.sh', [
      `n=$(( $(cat ${counter}) + 1 )); echo $n > ${counter}`,
      `[ "$n" -le 2 ] && bash ${GRIND} append --journal ${j} '{"kind":"progress","key":"p'$n'"}'`,
      'exit 0',
    ].join('\n'))
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = grind(['run', '--journal', j, '--check', check, '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'), '--max-iters', '10', '--sleep', '0', '--notify', 'none',
      '--no-events'])

    expect(r.status).toBe(3)
    expect(kinds(j, 'iter').length).toBe(5)
  })

  test('an explicit --stall-after 0 still disables it', () => {
    const d = tmpDir('grind-stall-off-')
    const j = join(d, 'journal.jsonl')
    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = grind(['run', '--journal', j, '--check', check, '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'), '--stall-after', '0', '--max-iters', '5', '--sleep', '0',
      '--notify', 'none', '--no-events'])

    expect(r.status).toBe(4)
    expect(kinds(j, 'iter').length).toBe(5)
    expect(kinds(j, 'stalled').length).toBe(0)
  })
})
