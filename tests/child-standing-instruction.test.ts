/**
 * The early-stop standing instruction must REACH an unattended child's prompt.
 *
 * A main-chat session that ends a turn early is caught by the Stop hook, because a user is sitting
 * there to be asked. A farmed row, a team lead and a grind iteration have nobody: an offer to
 * continue is answered by nothing, the session exits, and the caller sees a run that exited 0 with
 * the deliverable unwritten. So children get the instruction instead of a hook.
 *
 * Three scripts carry three BYTE-IDENTICAL copies of the paragraph, because their writable paths do
 * not admit a shared library (farm.sh, farm-team.sh and grind.sh are each executed, never sourced).
 * This suite is what stops the copies drifting: all three assertions are against ONE constant, so a
 * reworded copy is red the moment it lands.
 *
 * Every assertion goes through the real prompt-building path with a stub wrapper standing in for the
 * provider -- farm.sh's argv, the file farm-team.sh feeds the wrapper on stdin, grind.sh's
 * build_prompt. Grepping the scripts would pass on a variable that is defined and never referenced,
 * which is the defect most likely to happen here: a `-p` line that forgets to concatenate it.
 *
 * Nothing here reaches the network.
 *
 * Run: bun test /home/eh/projects/workflows/tests/child-standing-instruction.test.ts
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { hermeticEnv } from './helpers/hermetic-env'

const ROOT = dirname(import.meta.dir)
const FARM = join(ROOT, 'skills', 'farm-out', 'scripts', 'farm.sh')
const FARM_TEAM = join(ROOT, 'skills', 'farm-out', 'scripts', 'farm-team.sh')
const GRIND = join(ROOT, 'skills', 'grind', 'scripts', 'grind.sh')

/**
 * The instruction, verbatim and on one line. Deliberately free of apostrophes, `$` and backticks:
 * the same bytes have to survive a single-quoted bash assignment (farm.sh), a quoted heredoc
 * (farm-team.sh) and an UNQUOTED one (grind.sh, whose protocol block interpolates $SELF and friends).
 */
const INSTRUCTION =
  'NOBODY IS WATCHING THIS RUN. There is no one to answer a question, accept an offer, or take a ' +
  'next step you merely name. Do not end your turn with a progress report, a summary that announces ' +
  'the next step instead of taking it, a list of decisions that do not block you, or an offer to ' +
  'continue. While the deliverable is unmet, taking the next step IS your turn. End your turn only ' +
  'when you are genuinely blocked, and then say exactly what blocks you.'

const scratch: string[] = []
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })))

function workdir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  scratch.push(d)
  return d
}

function script(path: string, body: string): string {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

/** Where a captured prompt is reported from, so a failure names the script rather than a temp path. */
function show(label: string, got: string): string {
  return `${label} built a prompt that does not carry the standing instruction.\n--- prompt ---\n${got}\n--- end ---`
}

describe('the early-stop standing instruction reaches every unattended child prompt', () => {
  test('farm.sh: it is concatenated onto the -p argument, after the row prompt', () => {
    const d = workdir('child-instr-farm')
    const agentCwd = join(d, 'agentcwd')
    const bin = join(d, 'bin')
    mkdirSync(agentCwd, { recursive: true })
    mkdirSync(bin, { recursive: true })

    // The stub IS the provider as far as farm.sh is concerned: it files the argv it was handed and
    // prints one result line, so the row completes without a model call.
    const argvFile = join(d, 'argv.txt')
    script(
      join(bin, 'claude-code'),
      `printf '%s\\0' "$@" > "${argvFile}"\nprintf '{"type":"result","result":"done"}\\n'`,
    )

    const tasks = join(d, 'tasks.json')
    writeFileSync(tasks, JSON.stringify([{ label: 'r', prompt: 'ROW-PROMPT-SENTINEL' }]))

    const r = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', agentCwd], {
      encoding: 'utf8',
      cwd: d,
      timeout: 120_000,
      // hermeticEnv pins TMPDIR to this test's own directory and drops the ambient session id, so
      // farm.sh's START/DONE rows land in $d/farm-events instead of the caller's own event stream,
      // which a live session's farm-runs monitor reads as real dispatches.
      env: hermeticEnv(d, { PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1' }),
    })

    expect(existsSync(argvFile), `farm.sh never invoked the wrapper; stderr: ${r.stderr}`).toBe(true)
    const argv = readFileSync(argvFile, 'utf8').split('\0')
    const p = argv[argv.indexOf('-p') + 1] ?? ''

    // The row's own prompt must still be there: appending the instruction must not replace it.
    expect(p).toContain('ROW-PROMPT-SENTINEL')
    expect(p, show('farm.sh', p)).toContain(INSTRUCTION)
  })

  test('farm-team.sh: it is written into the prompt file the lead is fed on stdin', () => {
    const d = workdir('child-instr-team')
    const leadCwd = join(d, 'leadcwd')
    const bin = join(d, 'bin')
    mkdirSync(leadCwd, { recursive: true })
    mkdirSync(bin, { recursive: true })

    // farm-team.sh redirects the built file onto the wrapper's stdin rather than passing -p, so the
    // stub reads stdin. That redirection is exactly what this test has to exercise: a heredoc added
    // to the wrong side of the `> "$TMP/prompt.txt"` brace group reaches the terminal, not the lead.
    const stdinFile = join(d, 'stdin.txt')
    script(join(bin, 'claude-code'), `cat > "${stdinFile}"\nprintf '{"type":"result","result":"done"}\\n'`)

    const promptFile = join(d, 'brief.txt')
    writeFileSync(promptFile, 'TEAM-BRIEF-SENTINEL\n')

    const r = spawnSync('bash', [FARM_TEAM, '--prompt-file', promptFile, '--cwd', leadCwd], {
      encoding: 'utf8',
      cwd: d,
      timeout: 120_000,
      env: hermeticEnv(d, { PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1' }),
    })

    expect(
      existsSync(stdinFile),
      `farm-team.sh never invoked the wrapper; status ${r.status}, stderr: ${r.stderr}`,
    ).toBe(true)
    const prompt = readFileSync(stdinFile, 'utf8')

    expect(prompt).toContain('TEAM-BRIEF-SENTINEL')
    expect(prompt, show('farm-team.sh', prompt)).toContain(INSTRUCTION)
  })

  test('grind.sh: it is in the GRIND_PROTOCOL block of every iteration prompt', () => {
    const d = workdir('child-instr-grind')
    const journal = join(d, 'journal.jsonl')
    const promptSeen = join(d, 'prompt-seen.txt')

    writeFileSync(join(d, 'body.txt'), 'GRIND-BODY-SENTINEL')
    // grind.sh calls `"$runner" -p "$prompt"`, so $2 is the whole built prompt. A prompt file that
    // never appears means the exec failed and the loop called nothing -- distinct from a prompt that
    // was built without the instruction.
    const runner = script(join(d, 'runner.sh'), `printf '%s' "$2" > "${promptSeen}"`)

    const r = spawnSync(
      'bash',
      [
        GRIND, 'run',
        '--journal', journal,
        '--check', script(join(d, 'check.sh'), 'exit 1'),
        '--runner', runner,
        '--prompt-file', join(d, 'body.txt'),
        '--sleep', '0',
        '--max-iters', '1',
        '--no-events',
        '--notify', 'none',
      ],
      // --no-events already suppresses the event file; the hermetic env is the belt to that brace,
      // so a future default that ignores the flag still cannot reach the caller's stream.
      { encoding: 'utf8', cwd: d, timeout: 120_000, env: hermeticEnv(d) },
    )

    // 4 is "pass budget exhausted with the check still red" -- the loop ran its one iteration.
    expect(r.status, `grind.sh exited ${r.status}; stderr: ${r.stderr}`).toBe(4)
    expect(existsSync(promptSeen), `grind.sh never invoked the runner; stderr: ${r.stderr}`).toBe(true)
    const prompt = readFileSync(promptSeen, 'utf8')

    expect(prompt).toContain('GRIND-BODY-SENTINEL')
    expect(prompt).toContain('GRIND_PROTOCOL:')
    expect(prompt, show('grind.sh', prompt)).toContain(INSTRUCTION)
  })
})
