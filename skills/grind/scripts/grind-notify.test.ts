/**
 * grind.sh --notify — tell someone when an unattended run ends.
 *
 * A loop that runs for days and then exits silently has to be polled to be useful, and polling is
 * the cost this whole design removes. The run already knows how it ended; it should say so.
 *
 * The flag takes a COMMAND, not a transport. grind has no business knowing about herdr, beeper,
 * notify-send or ntfy, and a loop that hardcodes one is a loop that cannot be used on a machine
 * that has another. The command is handed the outcome in the environment:
 *
 *   RALPH_STATE    done | stalled | budget | stopped
 *   RALPH_EXIT     the loop's exit code
 *   RALPH_JOURNAL  the journal path, so the notifier can quote a figure from it
 *
 * It fires on EVERY terminal state, not just success. A stall at 3am is the one you most want to
 * hear about, because it means the loop stopped early with the goal unmet.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-notify.test.ts
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

/** A notifier that records exactly what the loop told it, and nothing else. */
function notifier(dir: string): { path: string; out: string } {
  const out = join(dir, 'notified.txt')
  const path = script(
    dir,
    'notify.sh',
    `printf '%s %s %s\\n' "$RALPH_STATE" "$RALPH_EXIT" "$RALPH_JOURNAL" > ${out}`,
  )
  return { path, out }
}

function run(args: string[]) {
  return spawnSync('bash', [GRIND, 'run', ...args], { encoding: 'utf8', timeout: 60_000 })
}

describe('grind.sh --notify', () => {
  test('fires on a clean finish, naming the state and the exit code', () => {
    const d = workdir('grind-notify-done')
    const journal = join(d, 'journal.jsonl')
    const n = notifier(d)
    const check = script(d, 'check.sh', 'exit 0')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = run([
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--notify', n.path,
      '--max-iters', '3',
      '--sleep', '0',
    ])

    expect(r.status).toBe(0)
    expect(existsSync(n.out)).toBe(true)
    expect(readFileSync(n.out, 'utf8').trim()).toBe(`done 0 ${journal}`)
  })

  test('fires on a stall too — the outcome you most need to hear about', () => {
    const d = workdir('grind-notify-stall')
    const journal = join(d, 'journal.jsonl')
    const n = notifier(d)
    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = run([
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--notify', n.path,
      '--stall-after', '2',
      '--max-iters', '10',
      '--sleep', '0',
    ])

    expect(r.status).toBe(3)
    expect(readFileSync(n.out, 'utf8').trim()).toBe(`stalled 3 ${journal}`)
  })

  test('fires when the pass budget runs out', () => {
    const d = workdir('grind-notify-budget')
    const journal = join(d, 'journal.jsonl')
    const n = notifier(d)
    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = run([
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--notify', n.path,
      '--max-iters', '2',
      '--stall-after', '0',
      '--sleep', '0',
    ])

    expect(r.status).toBe(4)
    expect(readFileSync(n.out, 'utf8').trim()).toBe(`budget 4 ${journal}`)
  })

  test('a notifier that fails does not change the run own verdict', () => {
    // Telling someone is not part of the work. A broken notifier must not turn a finished run into
    // a failed one, for the same reason journal writes are swallowed: reporting must never be the
    // thing that breaks a week-long loop.
    const d = workdir('grind-notify-broken')
    const journal = join(d, 'journal.jsonl')
    const bad = script(d, 'notify.sh', 'exit 9')
    const check = script(d, 'check.sh', 'exit 0')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = run([
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--notify', bad,
      '--max-iters', '3',
      '--sleep', '0',
    ])

    expect(r.status).toBe(0)
  })

  test('without --notify nothing is spawned and the run is unchanged', () => {
    const d = workdir('grind-notify-absent')
    const journal = join(d, 'journal.jsonl')
    const n = notifier(d)
    const check = script(d, 'check.sh', 'exit 0')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = run([
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '3',
      '--sleep', '0',
    ])

    expect(r.status).toBe(0)
    expect(existsSync(n.out)).toBe(false)
  })
})
