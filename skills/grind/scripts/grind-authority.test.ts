/**
 * grind.sh — who may end a run, and who may say how it ended.
 *
 * Round 2 closed the `append` channel: an agent can no longer write a `stop` or a `done` record.
 * Two ways round it survived, both found by the amnesia-safety lens as residue:
 *
 *  1. `cmd_stop` writes the same record through `journal_append` directly, and every iteration's
 *     prompt prints `RALPH_SH` — the absolute path to the script that owns the stop channel. An
 *     iteration that reads SKILL.md, sees `grind.sh stop`, and concludes the task looks impossible
 *     ends a run the operator started.
 *  2. `status` reports the run's outcome from the POSITIONAL last record. The agent can still append
 *     `progress`, legitimately, after the loop has written `done` — and the only window a human has
 *     into a detached run then stops showing how it ended.
 *
 * THE THREAT MODEL IS AN UNINFORMED AGENT, NOT AN ADVERSARY, and that bound is deliberate. An
 * iteration runs bash; it can always `kill` the pid it reads out of the journal, and no in-band
 * check can stop it. What is reachable, and what these tests require, is that the loop's own
 * machinery never *invites* the mistake: an iteration that runs the documented stop command in good
 * faith is refused, and the refusal is visible rather than silent. SKILL.md must say this plainly,
 * because a guard whose limits are undocumented reads as a guarantee it is not.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-authority.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GRIND = `${import.meta.dir}/grind.sh`

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

function grind(args: string[], env?: Record<string, string>) {
  return spawnSync('bash', [GRIND, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...(env ?? {}) },
  })
}

function records(journal: string): any[] {
  if (!existsSync(journal)) return []
  return readFileSync(journal, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .flatMap(l => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
}

describe('an iteration cannot end the run with the documented stop command', () => {
  test('the stop subcommand is refused from inside an iteration, and the run ends on its budget', () => {
    const d = workdir('grind-authstop')
    const journal = join(d, 'journal.jsonl')
    const check = script(d, 'check.sh', 'exit 1')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    // Iteration 1 reads the prompt, finds RALPH_SH and RALPH_JOURNAL, and runs the stop command it
    // saw documented — the good-faith mistake, not an attack.
    const runner = script(
      d,
      'runner.sh',
      [
        `prompt=""; while [ $# -gt 0 ]; do [ "$1" = "-p" ] && { prompt="$2"; break; }; shift; done`,
        `j=$(printf '%s' "$prompt" | sed -n 's/^RALPH_JOURNAL: //p' | head -1)`,
        `s=$(printf '%s' "$prompt" | sed -n 's/^RALPH_SH: //p' | head -1)`,
        `[ -n "$s" ] || s=${GRIND}`,
        `bash "$s" stop --journal "$j" --why 'this looks impossible' >>${join(d, 'stop.out')} 2>&1 || true`,
        `exit 0`,
      ].join('\n'),
    )

    const r = grind([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '3',
      '--sleep', '0',
    ])

    // 4 is budget exhausted. 5 would mean the agent ended a run the operator started.
    expect(r.status).toBe(4)
    expect(records(journal).filter(x => x.kind === 'stop').length).toBe(0)
    expect(records(journal).filter(x => x.kind === 'iter').length).toBe(3)

    // The refusal is visible. A guard that fails silently teaches the next agent nothing.
    expect(existsSync(join(d, 'stop.out'))).toBe(true)
    expect(readFileSync(join(d, 'stop.out'), 'utf8')).toMatch(/refus|iteration|operator/i)
  })

  test('the operator, outside any iteration, still stops a run', () => {
    const d = workdir('grind-opstop2')
    const journal = join(d, 'journal.jsonl')

    expect(grind(['stop', '--journal', journal]).status).toBe(0)
    expect(records(journal).filter(x => x.kind === 'stop').length).toBe(1)

    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = grind([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '3',
      '--sleep', '0',
    ])
    expect(r.status).toBe(5)
  })
})

describe('status reports the loop, not whatever landed last', () => {
  test('an agent record appended after a terminal one does not erase it from status', () => {
    const d = workdir('grind-statuslast')
    const journal = join(d, 'journal.jsonl')

    writeFileSync(
      journal,
      [
        '{"kind":"start","pid":4242}',
        '{"kind":"iter","i":1}',
        '{"kind":"done","i":1}',
        '',
      ].join('\n'),
    )

    // Legitimate, and the agent is entitled to write it: a late progress note from the iteration
    // that was still finishing when the check went green.
    expect(grind(['append', '--journal', journal, '{"kind":"progress","key":"K1"}']).status).toBe(0)

    const s = grind(['status', '--journal', journal])
    expect(s.status).toBe(0)
    expect(s.stdout).toContain('done')
  })

  test('a run still in flight is not reported as finished', () => {
    const d = workdir('grind-statusrunning')
    const journal = join(d, 'journal.jsonl')

    writeFileSync(
      journal,
      ['{"kind":"start","pid":4242}', '{"kind":"iter","i":1}', ''].join('\n'),
    )
    expect(grind(['append', '--journal', journal, '{"kind":"progress","key":"K1"}']).status).toBe(0)

    const s = grind(['status', '--journal', journal])
    expect(s.status).toBe(0)
    expect(s.stdout).not.toContain('done')
  })
})
