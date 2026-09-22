/**
 * grind.sh --notify — tell someone when an unattended run ends.
 *
 * A loop that runs for days and then exits silently has to be polled to be useful, and polling is
 * the cost this whole design removes. The run already knows how it ended; it should say so.
 *
 * With no flag the loop notifies by default: agent-msg to the session that launched it (or to
 * --notify-to), plus a herdr popup only when herdr is on PATH. --notify CMD replaces the default,
 * and --notify none turns it off. A custom command is handed the outcome in the environment:
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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, symlinkSync } from 'node:fs'
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

function run(args: string[], env?: Record<string, string>) {
  return spawnSync('bash', [GRIND, 'run', ...args], {
    encoding: 'utf8', timeout: 60_000, env: env ?? process.env,
  })
}

const SYSTEM_TOOLS = ['bash', 'sh', 'env', 'jq', 'date', 'dirname', 'basename', 'realpath', 'readlink',
  'mkdir', 'sleep', 'cat', 'head', 'tail', 'wc', 'sed', 'awk', 'grep', 'tr', 'cut', 'rm', 'mv', 'touch',
  'kill', 'ps', 'timeout', 'setsid', 'mktemp']

/** A PATH holding only the system tools plus the stubs given, so the real agent-msg and herdr
 *  on this machine can never be reached from a test. */
function stubPath(dir: string, stubs: string[]): { env: Record<string, string>; log: string } {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'calls.txt')
  for (const name of stubs) script(bin, name, `printf '%s %s\\n' ${name} "$*" >> ${log}`)
  // /usr/bin itself carries herdr on some machines, so link only the tools the loop runs.
  for (const tool of SYSTEM_TOOLS) {
    const real = spawnSync('bash', ['-c', `PATH=/usr/bin:/bin command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    if (real && !existsSync(join(bin, tool))) symlinkSync(real, join(bin, tool))
  }
  return { env: { PATH: bin, HOME: dir }, log }
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

  function finishing(d: string) {
    const journal = join(d, 'journal.jsonl')
    writeFileSync(join(d, 'prompt.txt'), 'work')
    return {
      journal,
      args: [
        '--journal', journal,
        '--check', script(d, 'check.sh', 'exit 0'),
        '--runner', script(d, 'runner.sh', 'exit 0'),
        '--prompt-file', join(d, 'prompt.txt'),
        '--max-iters', '3', '--sleep', '0',
      ],
    }
  }

  test('by default it agent-msgs the launching session, and pops herdr when herdr is present', () => {
    const d = workdir('grind-notify-default')
    const { journal, args } = finishing(d)
    const { env, log } = stubPath(d, ['agent-msg', 'herdr'])

    const r = run(args, { ...env, CLAUDE_CODE_SESSION_ID: 'sess-launch' })

    expect(r.status).toBe(0)
    const calls = readFileSync(log, 'utf8')
    expect(calls).toMatch(/^agent-msg send sess-launch .*done/m)
    expect(calls).toContain(journal)
    expect(calls).toMatch(/^herdr notification show .*done/m)
  })

  test('without herdr on PATH the default sends agent-msg alone', () => {
    const d = workdir('grind-notify-noherdr')
    const { args } = finishing(d)
    const { env, log } = stubPath(d, ['agent-msg'])

    const r = run(args, { ...env, CLAUDE_CODE_SESSION_ID: 'sess-launch' })

    expect(r.status).toBe(0)
    const calls = readFileSync(log, 'utf8')
    expect(calls).toMatch(/^agent-msg send sess-launch /m)
    expect(calls).not.toMatch(/^herdr /m)
  })

  test('--notify-to overrides the launching session as the target', () => {
    const d = workdir('grind-notify-to')
    const { args } = finishing(d)
    const { env, log } = stubPath(d, ['agent-msg'])

    const r = run([...args, '--notify-to', 'orchestrator'], { ...env, CLAUDE_CODE_SESSION_ID: 'sess-launch' })

    expect(r.status).toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/^agent-msg send orchestrator /m)
  })

  test('--notify none spawns nothing and the run is unchanged', () => {
    const d = workdir('grind-notify-none')
    const { args } = finishing(d)
    const { env, log } = stubPath(d, ['agent-msg', 'herdr'])

    const r = run([...args, '--notify', 'none'], { ...env, CLAUDE_CODE_SESSION_ID: 'sess-launch' })

    expect(r.status).toBe(0)
    expect(existsSync(log)).toBe(false)
  })

  test('a custom --notify replaces the default rather than adding to it', () => {
    const d = workdir('grind-notify-custom')
    const { journal, args } = finishing(d)
    const { env, log } = stubPath(d, ['agent-msg', 'herdr'])
    const n = notifier(d)

    const r = run([...args, '--notify', n.path], { ...env, CLAUDE_CODE_SESSION_ID: 'sess-launch' })

    expect(r.status).toBe(0)
    expect(readFileSync(n.out, 'utf8').trim()).toBe(`done 0 ${journal}`)
    expect(existsSync(log)).toBe(false)
  })
})
