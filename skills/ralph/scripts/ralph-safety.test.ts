/**
 * ralph.sh — the four unattended-safety defects the amnesia-safety lens found in round 1, each
 * turned into the failing test that closes it.
 *
 * All four share one theme: the loop trusts records the AGENT wrote. An amnesiac iteration is not
 * hostile, it is uninformed — it reconstructs the record shape from its prompt and gets it slightly
 * wrong, or it decides the task looks impossible and says so in the only channel it has. The loop
 * must survive both without losing state or ending itself.
 *
 *  1. A scan that yields nothing must NOT read as a virgin journal. SCAN_NEXT_I was initialised to
 *     the literal 1 and then overwritten from jq, so a failed scan left an all-digits value and the
 *     "refusing to reset state" guard could never fire. A journal that briefly fails to parse would
 *     silently restart the iteration counter and drop every floor.
 *  2. `append` validated only "one JSON object", so a floor missing its key was accepted with exit
 *     0 and then dropped by the reader, which filters on `.key != null`. The agent believes the key
 *     is closed; the next prompt says it is open; the loop re-diagnoses it forever.
 *  3. and 4. `append` constrained `kind` not at all, so an agent could write `stop`, `done` or any
 *     other record the LOOP owns — ending the run, or making `status` report a finish that never
 *     happened. The agent's channel must carry observations, never verdicts.
 *
 * The fix for 2, 3 and 4 is one rule: `append` takes a whitelist of agent kinds and enforces the
 * fields each one needs. Loop-owned kinds are refused.
 *
 * Run: bun test /home/eh/projects/workflows/skills/ralph/scripts/ralph-safety.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RALPH = `${import.meta.dir}/ralph.sh`

/** Records the loop owns. An agent that could write one of these could end or misreport the run. */
const LOOP_OWNED = ['start', 'iter', 'iter_end', 'wait', 'done', 'stalled', 'budget', 'stop']

/** Records the agent may write: observations about the work, never verdicts about the run. */
const AGENT_OWNED = ['progress', 'floor', 'attempt', 'note']

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

function ralph(args: string[]) {
  return spawnSync('bash', [RALPH, ...args], { encoding: 'utf8', timeout: 60_000 })
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

describe('a scan that fails must not be mistaken for a virgin journal', () => {
  test('refuses to run an iteration when the journal cannot be read, rather than restarting at 1', () => {
    const d = workdir('ralph-scanfail')
    const journal = join(d, 'journal.jsonl')
    const marker = join(d, 'runner-was-called')

    // A journal with real history: floors filed, iterations spent.
    writeFileSync(
      journal,
      [
        '{"kind":"start","pid":1234}',
        '{"kind":"iter","i":1}',
        '{"kind":"floor","key":"CIK-1081400","why":"declared nowhere"}',
        '{"kind":"iter","i":2}',
        '{"kind":"iter","i":3}',
        '',
      ].join('\n'),
    )
    // …which the scan then cannot read. Unreadable is the cheap deterministic stand-in for any
    // transient parse failure; the loop cannot tell them apart and must not guess.
    chmodSync(journal, 0o000)

    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', `touch ${marker}`)
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '3',
      '--sleep', '0',
    ])

    chmodSync(journal, 0o644)

    // Refused, not "started over": handing iteration 1 to a fresh agent would re-attempt work the
    // journal already records, and would do it with an empty floor list.
    expect(r.status).toBe(2)
    expect(existsSync(marker)).toBe(false)
    expect(records(journal).filter(x => x.kind === 'iter' && x.i === 1).length).toBe(1)
  })
})

describe('append enforces the shape each agent record needs', () => {
  test('refuses a floor with no key, instead of accepting a record the reader will drop', () => {
    const d = workdir('ralph-floorkey')
    const journal = join(d, 'journal.jsonl')

    const r = ralph([
      'append',
      '--journal', journal,
      '{"kind":"floor","why":"no machine-readable text","note":"1934-paper-scans"}',
    ])

    expect(r.status).not.toBe(0)
    expect(records(journal).length).toBe(0)

    // An empty key is the same defect wearing a different hat.
    expect(ralph(['append', '--journal', journal, '{"kind":"floor","key":""}']).status).not.toBe(0)
    expect(records(journal).length).toBe(0)

    // The well-formed record still lands.
    expect(ralph(['append', '--journal', journal, '{"kind":"floor","key":"CIK-79179"}']).status).toBe(0)
    expect(ralph(['floors', '--journal', journal]).stdout).toContain('CIK-79179')
  })

  test('accepts every agent-owned kind', () => {
    const d = workdir('ralph-agentkinds')
    const journal = join(d, 'journal.jsonl')
    for (const kind of AGENT_OWNED) {
      const rec = kind === 'floor'
        ? '{"kind":"floor","key":"K1"}'
        : `{"kind":"${kind}","key":"K1"}`
      expect(ralph(['append', '--journal', journal, rec]).status).toBe(0)
    }
    expect(records(journal).length).toBe(AGENT_OWNED.length)
  })
})

describe('the agent may report observations, never verdicts about the run', () => {
  test('refuses every loop-owned kind, so no appended record can end or misreport the run', () => {
    const d = workdir('ralph-reserved')
    const journal = join(d, 'journal.jsonl')

    for (const kind of LOOP_OWNED) {
      const r = ralph(['append', '--journal', journal, `{"kind":"${kind}","i":12}`])
      expect({ kind, status: r.status }).toEqual({ kind, status: 2 })
    }
    expect(records(journal).length).toBe(0)
  })

  test('a run is not ended by a stop record the agent tried to append', () => {
    const d = workdir('ralph-forgestop')
    const journal = join(d, 'journal.jsonl')
    const check = script(d, 'check.sh', 'exit 1')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    // Iteration 1's agent decides the task looks impossible and tries to stop the run.
    const runner = script(
      d,
      'runner.sh',
      [
        `prompt=""; while [ $# -gt 0 ]; do [ "$1" = "-p" ] && { prompt="$2"; break; }; shift; done`,
        `j=$(printf '%s' "$prompt" | sed -n 's/^RALPH_JOURNAL: //p' | head -1)`,
        `bash ${RALPH} append --journal "$j" '{"kind":"stop","why":"this looks impossible"}' || true`,
        `exit 0`,
      ].join('\n'),
    )

    const r = ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '3',
      '--sleep', '0',
    ])

    // The budget is what ends this run — exit 4 — not the agent's opinion, which is exit 5.
    expect(r.status).toBe(4)
    expect(records(journal).filter(x => x.kind === 'stop').length).toBe(0)
    expect(records(journal).filter(x => x.kind === 'iter').length).toBe(3)
  })

  test('status cannot be made to report a finish the agent invented', () => {
    const d = workdir('ralph-forgedone')
    const journal = join(d, 'journal.jsonl')

    ralph(['append', '--journal', journal, '{"kind":"progress","key":"K1"}'])
    expect(ralph(['append', '--journal', journal, '{"kind":"done","i":12,"note":"finished"}']).status).toBe(2)

    const s = ralph(['status', '--journal', journal])
    expect(s.status).toBe(0)
    expect(s.stdout).not.toContain('done')
  })
})

describe('the operator still owns stop', () => {
  test('the stop subcommand ends a run the agent could not', () => {
    const d = workdir('ralph-opstop')
    const journal = join(d, 'journal.jsonl')

    expect(ralph(['stop', '--journal', journal]).status).toBe(0)
    expect(records(journal).filter(x => x.kind === 'stop').length).toBe(1)

    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = ralph([
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
