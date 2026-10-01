/**
 * grind.sh — a gate that stays red must say why, and a run that waits on it must say so out loud.
 *
 * On 2026-09-23 a loop's --gate counted every farm.sh on the machine, so unrelated projects running
 * farm-outs held it shut from 18:30 to 23:20 — 110 `wait` records that named no reason and reached
 * nobody, and the operator only discovered the stall by asking. A silent indefinite wait is the
 * defect: the gate already prints its reason, and the run already knows how to notify, so the wait
 * record carries the gate's last output line as `why` and --wait-alert N fires the same notification
 * channel every N consecutive waits without ending the run.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-wait.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grindEnv } from './grind-test-env'

const GRIND = `${import.meta.dir}/grind.sh`

/** The bound a `why` line is cut to, so one chatty gate can never overrun the atomic write bound
 *  that makes the journal lock-free. */
const WHY_MAX = 200

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

function run(args: string[], env?: Record<string, string>) {
  return spawnSync('bash', [GRIND, 'run', '--runner', 'claude-code', ...args], {
    encoding: 'utf8', timeout: 60_000, env: env ?? grindEnv(),
  })
}

/** Every parseable record, in order. Unparseable lines are skipped, which is the reader contract —
 *  so a record mangled by an unescaped quote shows up here as a MISSING record, not a bad one. */
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

/** How many lines the journal holds that no reader can parse. Zero is the contract for every record
 *  the loop writes itself, whatever the gate printed. */
function unparseableLines(journal: string): number {
  if (!existsSync(journal)) return 0
  return readFileSync(journal, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .filter(l => {
      try {
        JSON.parse(l)
        return false
      } catch {
        return true
      }
    }).length
}

/** A run whose gate never opens: every pass is a wait until the pass budget ends it. */
function waiting(d: string, gateBody: string, extra: string[] = []) {
  const journal = join(d, 'journal.jsonl')
  writeFileSync(join(d, 'prompt.txt'), 'work')
  return {
    journal,
    args: [
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--gate', script(d, 'gate.sh', gateBody),
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '0',
      ...extra,
    ],
  }
}

/** A notifier that appends ONE line per call, so the count of calls is as visible as their content. */
function counting(dir: string): { path: string; out: string; lines: () => string[] } {
  const out = join(dir, 'notified.txt')
  const path = script(
    dir,
    'notify.sh',
    `printf '%s|%s|%s\\n' "$GRIND_STATE" "$GRIND_WAITS" "$GRIND_WHY" >> ${out}`,
  )
  return {
    path,
    out,
    lines: () => (existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(l => l.trim()) : []),
  }
}

describe('grind.sh — a wait record says WHY the gate is shut', () => {
  test('a gate printing to stdout puts its last non-empty line in every wait record', () => {
    const d = workdir('grind-why-stdout')
    const { journal, args } = waiting(
      d,
      ["printf 'checking grid...\\n'", "printf 'grid busy: 3 jobs\\n'", "printf '\\n'", 'exit 1'].join('\n'),
      ['--max-iters', '3'],
    )

    const r = run(args)

    expect(r.status).toBe(4)
    const waits = kinds(journal, 'wait')
    expect(waits.length).toBe(3)
    for (const w of waits) expect(w.why).toBe('grid busy: 3 jobs')
  })

  test('a gate printing to stderr is read the same way — the output is combined, not just stdout', () => {
    const d = workdir('grind-why-stderr')
    const { journal, args } = waiting(
      d,
      ["printf 'grid busy: 3 jobs\\n' >&2", 'exit 1'].join('\n'),
      ['--max-iters', '2'],
    )

    const r = run(args)

    expect(r.status).toBe(4)
    const waits = kinds(journal, 'wait')
    expect(waits.length).toBe(2)
    for (const w of waits) expect(w.why).toBe('grid busy: 3 jobs')
  })

  test('a silent gate leaves why absent or empty rather than inventing one', () => {
    const d = workdir('grind-why-silent')
    const { journal, args } = waiting(d, 'exit 1', ['--max-iters', '2'])

    const r = run(args)

    expect(r.status).toBe(4)
    const waits = kinds(journal, 'wait')
    expect(waits.length).toBe(2)
    for (const w of waits) expect(w.why ?? '').toBe('')
  })

  test('quotes and backslashes in the gate output leave the record parseable', () => {
    // The gate is arbitrary shell owned by whoever wrote the loop. Its output is data, and pasting
    // data into a hand-built JSON string is how a journal stops being readable at 3am.
    const d = workdir('grind-why-quotes')
    const gateLine = 'blocked by "farm.sh" at C:\\jobs\\x'
    const { journal, args } = waiting(
      d,
      [`printf '%s\\n' 'blocked by "farm.sh" at C:\\jobs\\x'`, 'exit 1'].join('\n'),
      ['--max-iters', '2'],
    )

    const r = run(args)

    expect(r.status).toBe(4)
    expect(unparseableLines(journal)).toBe(0)
    const waits = kinds(journal, 'wait')
    expect(waits.length).toBe(2)
    for (const w of waits) expect(w.why).toBe(gateLine)
  })

  test('a 500-character line is truncated to the why bound, not written whole', () => {
    const d = workdir('grind-why-long')
    const { journal, args } = waiting(
      d,
      ['line=$(printf \'x%.0s\' {1..500})', `printf '%s\\n' "$line"`, 'exit 1'].join('\n'),
      ['--max-iters', '2'],
    )

    const r = run(args)

    expect(r.status).toBe(4)
    expect(unparseableLines(journal)).toBe(0)
    const waits = kinds(journal, 'wait')
    expect(waits.length).toBe(2)
    for (const w of waits) {
      expect(w.why.length).toBeLessThanOrEqual(WHY_MAX)
      expect(w.why.length).toBeGreaterThan(0)
      expect(w.why).toMatch(/^x+$/)
    }
  })
})

describe('grind.sh --wait-alert — a long wait is announced while it is still happening', () => {
  test('fires at every Nth consecutive wait, and the run continues to its own ending', () => {
    // 7 waits with --wait-alert 3 is two alerts (at 3 and at 6) and then the budget ending. An alert
    // at 7 would mean the threshold counts something other than the consecutive streak.
    const d = workdir('grind-alert-every-n')
    const n = counting(d)
    const { journal, args } = waiting(d, "printf 'grid busy: 3 jobs\\n'\nexit 1", [
      '--max-iters', '7',
      '--wait-alert', '3',
      '--notify', n.path,
    ])

    const r = run(args)

    expect(r.status).toBe(4)
    expect(kinds(journal, 'wait').length).toBe(7)

    const lines = n.lines()
    const alerts = lines.filter(l => l.startsWith('waiting|'))
    expect(alerts).toEqual(['waiting|3|grid busy: 3 jobs', 'waiting|6|grid busy: 3 jobs'])
    // The alert does not end the run: the terminal notification still arrives, last.
    expect(lines.at(-1)).toMatch(/^budget\|/)
    expect(lines.length).toBe(3)
  })

  test('the streak resets when the gate opens — 2, then a pass, then 2 is never 3', () => {
    const d = workdir('grind-alert-reset')
    const n = counting(d)
    const journal = join(d, 'journal.jsonl')
    writeFileSync(join(d, 'prompt.txt'), 'work')
    const counter = join(d, 'gate.count')
    writeFileSync(counter, '0')
    // Red, red, GREEN, red, red.
    const gate = script(
      d,
      'gate.sh',
      [
        `c=$(cat ${counter}); c=$((c+1)); printf '%s' "$c" > ${counter}`,
        `printf 'grid busy\\n'`,
        `[ "$c" = "3" ] && exit 0`,
        `exit 1`,
      ].join('\n'),
    )

    const r = run([
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--gate', gate,
      '--runner', script(d, 'runner.sh', 'exit 0'),
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '0',
      '--max-iters', '5',
      '--wait-alert', '3',
      '--notify', n.path,
    ])

    expect(r.status).toBe(4)
    expect(kinds(journal, 'wait').length).toBe(4)
    expect(kinds(journal, 'iter').length).toBe(1)
    expect(n.lines().filter(l => l.startsWith('waiting|'))).toEqual([])
  })

  test('the default threshold is 6 consecutive waits', () => {
    const d = workdir('grind-alert-default')
    const n = counting(d)
    const { journal, args } = waiting(d, "printf 'grid busy\\n'\nexit 1", [
      '--max-iters', '6',
      '--notify', n.path,
    ])

    const r = run(args)

    expect(r.status).toBe(4)
    expect(kinds(journal, 'wait').length).toBe(6)
    expect(n.lines().filter(l => l.startsWith('waiting|'))).toEqual(['waiting|6|grid busy'])
  })

  test('--wait-alert 0 disables the alert entirely', () => {
    const d = workdir('grind-alert-off')
    const n = counting(d)
    const { journal, args } = waiting(d, "printf 'grid busy\\n'\nexit 1", [
      '--max-iters', '7',
      '--wait-alert', '0',
      '--notify', n.path,
    ])

    const r = run(args)

    expect(r.status).toBe(4)
    expect(kinds(journal, 'wait').length).toBe(7)
    expect(n.lines().filter(l => l.startsWith('waiting|'))).toEqual([])
  })

  test('a waiting alert that fails changes neither the exit code nor the loop', () => {
    // Same rule as the terminal notification: telling someone is not part of the work, and a broken
    // notifier at wait 3 must not decide the outcome of a week-long loop.
    const d = workdir('grind-alert-broken')
    const { journal, args } = waiting(d, "printf 'grid busy\\n'\nexit 1", [
      '--max-iters', '5',
      '--wait-alert', '2',
      '--notify', script(d, 'notify.sh', 'exit 1'),
    ])

    const r = run(args)

    expect(r.status).toBe(4)
    expect(kinds(journal, 'wait').length).toBe(5)
    expect(records(journal).at(-1)?.kind).toBe('budget')
  })
})

const SYSTEM_TOOLS = ['bash', 'sh', 'env', 'jq', 'date', 'dirname', 'basename', 'realpath', 'readlink',
  'mkdir', 'sleep', 'cat', 'head', 'tail', 'wc', 'sed', 'awk', 'grep', 'tr', 'cut', 'rm', 'mv', 'touch',
  'kill', 'ps', 'timeout', 'setsid', 'mktemp']

/** A PATH holding only the system tools plus the stubs given, so the real agent-msg and herdr on
 *  this machine can never be reached from a test. */
function stubPath(dir: string, stubs: string[]): { env: Record<string, string>; log: string } {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'calls.txt')
  for (const name of stubs) script(bin, name, `printf '%s %s\\n' ${name} "$*" >> ${log}`)
  for (const tool of SYSTEM_TOOLS) {
    const real = spawnSync('bash', ['-c', `PATH=/usr/bin:/bin command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    if (real && !existsSync(join(bin, tool))) symlinkSync(real, join(bin, tool))
  }
  return { env: { PATH: bin, HOME: dir }, log }
}

describe('grind.sh --wait-alert — the default notifier carries the wait', () => {
  test('agent-msgs the notify-to session with the streak and the why, and the run keeps going', () => {
    const d = workdir('grind-alert-agentmsg')
    const { journal, args } = waiting(d, "printf 'grid busy: 3 jobs\\n'\nexit 1", [
      '--max-iters', '3',
      '--wait-alert', '2',
      '--notify-to', 'orchestrator',
    ])
    const { env, log } = stubPath(d, ['agent-msg'])

    const r = run(args, { ...env, CLAUDE_CODE_SESSION_ID: 'sess-launch' })

    expect(r.status).toBe(4)
    expect(kinds(journal, 'wait').length).toBe(3)

    const calls = readFileSync(log, 'utf8').split('\n').filter(l => l.trim())
    const waitingCalls = calls.filter(l => /waiting/i.test(l))
    expect(waitingCalls.length).toBe(1)
    expect(waitingCalls[0]).toMatch(/^agent-msg send orchestrator /)
    expect(waitingCalls[0]).toContain('2')
    expect(waitingCalls[0]).toContain('grid busy: 3 jobs')

    // The loop did not stop at the alert: it ran on and its ending was announced too.
    expect(calls.at(-1)).toMatch(/^agent-msg send orchestrator .*budget/)
  })
})
