/**
 * grind.sh — the prompt it builds must fit in one argv string.
 *
 * The prompt is handed to the runner as a single argument after -p. Linux caps ONE argument at
 * MAX_ARG_STRLEN = 131072 bytes regardless of how much room the rest of the argv has, so an
 * oversized prompt does not degrade: every exec fails outright with `Argument list too long`, the
 * runner is never entered, and the loop burns its whole iteration budget calling nothing.
 *
 * Observed in production: a journal holding 58 floors with `why` texts up to 3.1KB each put ~100KB
 * of floor reasons into GRIND_FLOORS alone. build_prompt prints every floor's full `why` with no
 * length cap, while GRIND_SUBJECTS already cuts its `last=` excerpt to 200 characters — so the one
 * block that is guaranteed to grow monotonically (floors are never retired) is the one block with
 * no bound on it.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-prompt-size.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GRIND = `${import.meta.dir}/grind.sh`

/** Linux MAX_ARG_STRLEN: the hard cap on a SINGLE argv entry (32 * PAGE_SIZE). */
const MAX_ARG_STRLEN = 131072
/** A floor line — key, tab, reason — is cut here, the way a subject's `last=` is cut to 200. */
const FLOOR_LINE_MAX = 300

/** The production shape: many floors, each with a reason far longer than any cap. */
const FLOORS = 60
const WHY_LEN = 3000

const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function workdir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  scratch.push(d)
  return d
}

function script(dir: string, name: string, bodyText: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${bodyText}\n`)
  chmodSync(p, 0o755)
  return p
}

function append(journal: string, rec: Record<string, unknown>) {
  const r = spawnSync('bash', [GRIND, 'append', '--journal', journal, JSON.stringify(rec)], {
    encoding: 'utf8', timeout: 30_000,
  })
  if (r.status !== 0) throw new Error(`append refused: ${r.stderr}`)
}

function run(args: string[]) {
  return spawnSync('bash', [GRIND, 'run', ...args], { encoding: 'utf8', timeout: 120_000 })
}

/**
 * A one-iteration run whose check never goes green, with a stub runner that files the prompt it was
 * given under prompt-<iteration>.txt. If the exec fails the file is simply absent, which is the
 * distinction this suite turns on: a missing prompt file means the runner was never reached.
 */
function loop(d: string) {
  const journal = join(d, 'journal.jsonl')
  writeFileSync(join(d, 'prompt.txt'), 'work the goal')
  const runner = script(d, 'runner.sh', `printf '%s' "$2" > ${join(d, 'prompt')}-"$GRIND_ITERATION".txt`)
  return {
    journal,
    promptPath: (i: number) => `${join(d, 'prompt')}-${i}.txt`,
    prompt: (i: number) => readFileSync(`${join(d, 'prompt')}-${i}.txt`, 'utf8'),
    args: [
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '0',
      '--max-iters', '1',
    ],
  }
}

/** The GRIND_FLOORS block: its header line plus the indented floor lines that follow it. */
function floorsBlock(prompt: string): string[] {
  const lines = prompt.split('\n')
  const start = lines.findIndex(l => l.startsWith('GRIND_FLOORS:'))
  if (start < 0) return []
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length && lines[i].startsWith('  '); i++) out.push(lines[i])
  return out
}

const key = (n: number) => `floor-${String(n).padStart(2, '0')}`
/** Each reason ends in a key-specific sentinel, so a truncation that keeps only the head is visible. */
const why = (n: number) => `${'w'.repeat(WHY_LEN - 20)} SENTINEL-${key(n)}`

function seed(journal: string) {
  for (let n = 0; n < FLOORS; n++) append(journal, { kind: 'floor', key: key(n), why: why(n) })
}

describe('grind.sh — GRIND_FLOORS is bounded, so the prompt still fits in one argv entry', () => {
  test('60 floors with 3KB reasons: every key survives, no floor line exceeds 300 bytes', () => {
    const d = workdir('grind-floorcap-lines')
    const { journal, args, prompt, promptPath } = loop(d)
    seed(journal)

    const r = run(args)

    expect(r.status).toBe(4)
    // The runner must have been ENTERED. An `Argument list too long` exec failure leaves no prompt
    // file at all, so this assertion is what separates "the cap is missing" from "the cap is wrong".
    expect(
      existsSync(promptPath(1)),
      `the runner was never invoked; grind.sh said: ${r.stderr}`,
    ).toBe(true)

    const block = floorsBlock(prompt(1))
    expect(block.length).toBe(FLOORS + 1)

    // Bounding the block must not drop floors: a floor missing from the prompt is a closed key the
    // next iteration re-diagnoses, which is the failure floors exist to prevent.
    const listed = block.slice(1).map(l => l.slice(2).split('\t')[0])
    for (let n = 0; n < FLOORS; n++) expect(listed).toContain(key(n))

    const oversized = block
      .slice(1)
      .filter(l => Buffer.byteLength(l, 'utf8') > FLOOR_LINE_MAX)
      .map(l => `${l.slice(2).split('\t')[0]} (${Buffer.byteLength(l, 'utf8')} bytes)`)
    expect(oversized, `floor lines over ${FLOOR_LINE_MAX} bytes: ${oversized.join(', ')}`).toEqual([])
  })

  test('the whole prompt stays under MAX_ARG_STRLEN', () => {
    const d = workdir('grind-floorcap-total')
    const { journal, args, prompt, promptPath } = loop(d)
    seed(journal)

    const r = run(args)

    expect(r.status).toBe(4)
    expect(
      existsSync(promptPath(1)),
      `the runner was never invoked; grind.sh said: ${r.stderr}`,
    ).toBe(true)
    expect(Buffer.byteLength(prompt(1), 'utf8')).toBeLessThan(MAX_ARG_STRLEN)
  })
})
