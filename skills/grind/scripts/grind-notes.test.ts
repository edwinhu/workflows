/**
 * grind.sh — an operator note appended to the journal reaches the next iteration's prompt.
 *
 * The journal is the loop's only memory, and `note` is the one agent-owned kind that exists purely
 * to say something to a later pass. But the prompt injected GRIND_FLOORS and the journal PATH only,
 * so nothing ever read the notes: measured 2026-09-25, a note appended at 06:55 was skipped by every
 * iteration through 10:12 (iterations 96-107), because no iteration opens the file it is handed.
 * Steering a running loop is therefore the same one pass that collects the floors — notes are read
 * at the top of each iteration and printed after GRIND_FLOORS.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-notes.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grindEnv } from './grind-test-env'

const GRIND = `${import.meta.dir}/grind.sh`

/** The newest N notes reach the prompt; older ones are dropped rather than growing it without end. */
const NOTE_CAP = 10

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

/** Append one record through the agent's own channel, exactly as an operator would from a shell. */
function append(journal: string, rec: Record<string, unknown>) {
  const r = spawnSync('bash', [GRIND, 'append', '--journal', journal, JSON.stringify(rec)], {
    env: grindEnv(),
    encoding: 'utf8', timeout: 30_000,
  })
  if (r.status !== 0) throw new Error(`append refused: ${r.stderr}`)
}

/**
 * A run whose check never goes green, with a stub runner that files every prompt it is given under
 * prompt-<iteration>.txt. `extraRunner` is bash appended to that stub, which is how an iteration
 * stands in for the operator appending a note mid-run: it re-reads GRIND_SH and GRIND_JOURNAL out of
 * the prompt it was handed, the same two lines a real iteration uses.
 */
function loop(d: string, iters: number, extraRunner = '') {
  const journal = join(d, 'journal.jsonl')
  writeFileSync(join(d, 'prompt.txt'), 'work the goal')
  const runner = script(
    d,
    'runner.sh',
    [
      `printf '%s' "$2" > ${join(d, 'prompt')}-"$GRIND_ITERATION".txt`,
      `sh=$(printf '%s' "$2" | sed -n 's/^GRIND_SH: //p' | head -n 1)`,
      `j=$(printf '%s' "$2" | sed -n 's/^GRIND_JOURNAL: //p' | head -n 1)`,
      extraRunner,
      'exit 0',
    ].join('\n'),
  )
  return {
    journal,
    prompt: (i: number) => readFileSync(`${join(d, 'prompt')}-${i}.txt`, 'utf8'),
    args: [
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '0',
      '--max-iters', String(iters),
    ],
  }
}

function run(args: string[]) {
  return spawnSync('bash', [GRIND, 'run', '--runner', 'claude-code', ...args], { encoding: 'utf8', timeout: 60_000, env: grindEnv() })
}

/** The GRIND_NOTES block: its header line plus the indented note lines that follow it. */
function notesBlock(prompt: string): string[] {
  const lines = prompt.split('\n')
  const start = lines.findIndex(l => l.startsWith('GRIND_NOTES:'))
  if (start < 0) return []
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length && lines[i].startsWith('  '); i++) out.push(lines[i])
  return out
}

describe('grind.sh — operator notes are injected into every iteration prompt', () => {
  test('a note appended before the run reaches the first iteration', () => {
    const d = workdir('grind-notes-before')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'note', key: 'scope', note: 'skip the 2004 filings, they are being re-parsed' })

    const r = run(args)

    expect(r.status).toBe(4)
    const block = notesBlock(prompt(1))
    expect(block[0]).toContain('GRIND_NOTES:')
    expect(block[0]).not.toContain('none')
    expect(block).toContain('  scope\tskip the 2004 filings, they are being re-parsed')
  })

  test('a note appended BETWEEN iterations reaches the next one', () => {
    // The defect measured on 2026-09-25: an operator steering a running loop was ignored for
    // eleven iterations. Iteration 1 stands in for that operator here.
    const d = workdir('grind-notes-midrun')
    const { args, prompt } = loop(
      d,
      2,
      `[ "$GRIND_ITERATION" = "1" ] && bash "$sh" append --journal "$j" '{"kind":"note","key":"pivot","note":"rank by row count, not by age"}'`,
    )

    const r = run(args)

    expect(r.status).toBe(4)
    expect(notesBlock(prompt(1))).toEqual(['GRIND_NOTES: none.'])
    expect(notesBlock(prompt(2))).toContain('  pivot\trank by row count, not by age')
  })

  test('with no notes the prompt says so rather than omitting the block', () => {
    const d = workdir('grind-notes-none')
    const { args, prompt } = loop(d, 1)

    const r = run(args)

    expect(r.status).toBe(4)
    expect(notesBlock(prompt(1))).toEqual(['GRIND_NOTES: none.'])
  })

  test('only the newest 10 notes appear, newest last', () => {
    const d = workdir('grind-notes-cap')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= 12; n++) append(journal, { kind: 'note', key: `k${n}`, note: `note ${n}` })

    const r = run(args)

    expect(r.status).toBe(4)
    const block = notesBlock(prompt(1))
    const lines = block.slice(1)
    expect(lines.length).toBe(NOTE_CAP)
    expect(lines[0]).toBe('  k3\tnote 3')
    expect(lines.at(-1)).toBe('  k12\tnote 12')
    expect(block.join('\n')).not.toContain('note 1\t')
    expect(lines).not.toContain('  k1\tnote 1')
    expect(lines).not.toContain('  k2\tnote 2')
  })
})
