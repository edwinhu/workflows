/**
 * ralph.sh — a Ralph loop that runs OUTSIDE any chat session, with one append-only journal as its
 * entire memory.
 *
 * These tests are the specification. They exist because the three properties below are the ones an
 * unattended week-long loop actually fails on, and each was observed on a live run:
 *
 *  1. A loop that calls the model every pass spends most invocations learning a grid job is still
 *     queued. `--gate` is a shell precondition; while it is red NO model call is spent.
 *  2. A loop that reads its own agent's output to decide whether to stop is self-grading. The
 *     continue/stop decision is `--check`'s exit code and nothing else.
 *  3. An amnesiac loop re-diagnoses the same dead work item every iteration, forever. Keys recorded
 *     as `floor` are delivered into every later prompt as an exclusion list.
 *
 * Plus the property that makes an append-only log worth having: a record that cannot be written in
 * one atomic write is REFUSED, never split, and a reader tolerates a final line truncated by a crash.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case.
 *
 * Run: bun test /home/eh/projects/workflows/skills/ralph/scripts/ralph.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RALPH = `${import.meta.dir}/ralph.sh`

/** The single-write bound a record must fit in. POSIX guarantees an O_APPEND write of at most
 *  PIPE_BUF bytes lands whole, which is what lets the loop and the agent share one file with no
 *  lock — exactly the farm.sh discipline (one printf-append, no flock). */
const ATOMIC_BOUND = 4096

const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function workdir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  scratch.push(d)
  return d
}

function script(dir: string, name: string, body: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

function ralph(args: string[], cwd?: string) {
  return spawnSync('bash', [RALPH, ...args], { encoding: 'utf8', cwd, timeout: 60_000 })
}

/** Every parseable record, in order. Unparseable lines are skipped, which is the reader contract. */
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

const kinds = (journal: string, kind: string) => records(journal).filter(r => r.kind === kind)

/** A check that fails `n` times and then succeeds, so the loop runs exactly `n` iterations. */
function failNTimes(dir: string, n: number): string {
  const counter = join(dir, 'check.count')
  writeFileSync(counter, '0')
  return script(
    dir,
    'check.sh',
    `c=$(cat ${counter}); c=$((c+1)); echo $c > ${counter}; [ "$c" -gt ${n} ]`,
  )
}

describe('ralph.sh run — the loop', () => {
  test('exits 0 when the check goes green, having run exactly one iteration per red check', () => {
    const d = workdir('ralph-green')
    const journal = join(d, 'journal.jsonl')
    const check = failNTimes(d, 3)
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'do one unit of work')

    const r = ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '10',
      '--sleep', '0',
    ])

    expect(r.status).toBe(0)
    expect(kinds(journal, 'iter').length).toBe(3)
    expect(records(journal).at(-1)?.kind).toBe('done')
  })

  test('a failing --gate suppresses the model call entirely — no runner invocation, no iter record', () => {
    const d = workdir('ralph-gate')
    const journal = join(d, 'journal.jsonl')
    const marker = join(d, 'runner-was-called')
    const check = script(d, 'check.sh', 'exit 1')
    const gate = script(d, 'gate.sh', 'exit 1')
    const runner = script(d, 'runner.sh', `touch ${marker}`)
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--gate', gate,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '2',
      '--sleep', '0',
    ])

    // The gate never opens, so the loop exhausts its iteration budget without spending a call.
    expect(r.status).toBe(4)
    expect(existsSync(marker)).toBe(false)
    expect(kinds(journal, 'iter').length).toBe(0)
    expect(kinds(journal, 'wait').length).toBeGreaterThan(0)
  })

  test('--stall-after stops the loop when no iteration records progress', () => {
    const d = workdir('ralph-stall')
    const journal = join(d, 'journal.jsonl')
    const check = script(d, 'check.sh', 'exit 1')
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--stall-after', '2',
      '--max-iters', '10',
      '--sleep', '0',
    ])

    expect(r.status).toBe(3)
    expect(kinds(journal, 'iter').length).toBe(2)
    expect(records(journal).at(-1)?.kind).toBe('stalled')
  })
})

describe('ralph.sh — floors are an exclusion list, delivered to every later prompt', () => {
  test('a key recorded as a floor reaches later prompts and is listed by the floors subcommand', () => {
    const d = workdir('ralph-floor')
    const journal = join(d, 'journal.jsonl')
    const promptDir = join(d, 'prompts')
    const check = script(d, 'check.sh', 'exit 1')
    writeFileSync(join(d, 'prompt.txt'), 'do one unit of work')

    // The runner is handed the prompt after `-p`. It records that prompt, and on its first
    // invocation files a floor — the journal path is read out of the prompt, which is how an
    // amnesiac iteration learns where to write.
    const runner = script(
      d,
      'runner.sh',
      [
        `mkdir -p ${promptDir}`,
        `n=$(ls ${promptDir} | wc -l)`,
        `prompt=""; while [ $# -gt 0 ]; do [ "$1" = "-p" ] && { prompt="$2"; break; }; shift; done`,
        `printf '%s' "$prompt" > ${promptDir}/$n.txt`,
        `j=$(printf '%s' "$prompt" | sed -n 's/^RALPH_JOURNAL: //p' | head -1)`,
        `[ "$n" = "0" ] && bash ${RALPH} append --journal "$j" '{"kind":"floor","key":"CIK-1081400","why":"declared nowhere"}'`,
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

    expect(r.status).toBe(4)

    // The floors subcommand derives the set from the journal — there is no second file.
    const floors = ralph(['floors', '--journal', journal])
    expect(floors.status).toBe(0)
    expect(floors.stdout).toContain('CIK-1081400')

    // Every iteration after the one that filed it is handed the key, so it is never re-attempted.
    const second = readFileSync(join(promptDir, '1.txt'), 'utf8')
    expect(second).toContain('RALPH_FLOORS:')
    expect(second).toContain('CIK-1081400')

    // And the prompt carries the journal path, which is the agent's only write channel.
    expect(second).toContain(`RALPH_JOURNAL: ${journal}`)
  })
})

describe('ralph.sh append — the atomicity rule', () => {
  test('refuses a record larger than one atomic write instead of splitting it', () => {
    const d = workdir('ralph-big')
    const journal = join(d, 'journal.jsonl')

    const ok = ralph(['append', '--journal', journal, '{"kind":"progress","key":"small"}'])
    expect(ok.status).toBe(0)
    const sizeAfterSmall = statSync(journal).size

    const huge = JSON.stringify({ kind: 'progress', key: 'x'.repeat(ATOMIC_BOUND + 512) })
    expect(huge.length).toBeGreaterThan(ATOMIC_BOUND)
    const r = ralph(['append', '--journal', journal, huge])

    expect(r.status).not.toBe(0)
    // Refused means absent: not truncated to fit, not split across two lines.
    expect(statSync(journal).size).toBe(sizeAfterSmall)
    expect(records(journal).length).toBe(1)
  })

  test('rejects a record that is not one JSON object on one line', () => {
    const d = workdir('ralph-bad')
    const journal = join(d, 'journal.jsonl')

    expect(ralph(['append', '--journal', journal, 'not json']).status).not.toBe(0)
    expect(ralph(['append', '--journal', journal, '{"kind":"a"}\n{"kind":"b"}']).status).not.toBe(0)
    expect(records(journal).length).toBe(0)
  })
})

describe('ralph.sh — a journal truncated by a crash is resumable', () => {
  test('skips an unparseable final line and continues the iteration numbering', () => {
    const d = workdir('ralph-trunc')
    const journal = join(d, 'journal.jsonl')

    // Two whole records, then a line a crash cut mid-write: no closing brace, no newline.
    writeFileSync(
      journal,
      '{"kind":"iter","i":1}\n' +
        '{"kind":"iter_end","i":1,"exit":0}\n' +
        '{"kind":"iter","i":2}\n' +
        '{"kind":"iter_end","i":2,"ex',
    )

    const check = failNTimes(d, 1)
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    const r = ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '5',
      '--sleep', '0',
    ])

    expect(r.status).toBe(0)
    // Numbering continues past the highest whole record rather than restarting at 1.
    const iters = kinds(journal, 'iter').map(x => x.i)
    expect(iters).toContain(3)
    expect(iters.filter(i => i === 1).length).toBe(1)
  })
})

describe('ralph.sh status — derived from the journal, with no pidfile', () => {
  test('reports the run after it finishes, reading only the journal', () => {
    const d = workdir('ralph-status')
    const journal = join(d, 'journal.jsonl')
    const check = failNTimes(d, 1)
    const runner = script(d, 'runner.sh', 'exit 0')
    writeFileSync(join(d, 'prompt.txt'), 'work')

    ralph([
      'run',
      '--journal', journal,
      '--check', check,
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--max-iters', '5',
      '--sleep', '0',
    ])

    const s = ralph(['status', '--journal', journal])
    expect(s.status).toBe(0)
    expect(s.stdout).toContain('done')

    // The journal is the only file the loop writes.
    const stray = readFileSync(journal, 'utf8')
    expect(stray.length).toBeGreaterThan(0)
    expect(existsSync(`${journal}.pid`)).toBe(false)
    expect(existsSync(join(d, 'ralph.state'))).toBe(false)
  })
})

describe('ralph.sh — usage', () => {
  test('bare invocation prints a usage listing every subcommand and exits 2', () => {
    const r = ralph([])
    expect(r.status).toBe(2)
    const usage = `${r.stdout}${r.stderr}`
    for (const sub of ['run', 'append', 'floors', 'status', 'tail', 'stop']) {
      expect(usage).toContain(sub)
    }
  })
})
