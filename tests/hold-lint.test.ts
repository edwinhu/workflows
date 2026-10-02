/**
 * hold-lint.ts, and specifically the rule that refuses a check reading a WORK ROUND VERDICT.
 *
 * A round verdict cannot certify the goal — it goes green on a FAIL the loop was going to fix — and
 * it outlives an abandoned run, so the hold can neither release nor be argued with. AGK 2026-09-27:
 * a heartbeat armed on `work-result.sh` woke 14 times with no news, each tick re-entering a 113 KB
 * plan and a 276 KB run dir.
 *
 * Run: bun test tests/hold-lint.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()

const LINT = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'hold-lint.ts')
const ARM = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-hold.sh')

const lint = (check: string, ...extra: string[]) =>
  spawnSync('bun', [LINT, check, ...extra], { timeout: 120_000, encoding: 'utf8', env: HERMETIC_ENV })

describe('R1b round-verdict — CRITICAL', () => {
  for (const check of [
    'bash skills/work/scripts/work-result.sh .work/run/result.json; [ $? -eq 0 ]',
    'test -s run/result.json && jq -e .overallPass run/result.json',
    'bash .work/hb-run/gate.sh',
  ]) {
    test(`refuses: ${check.slice(0, 44)}`, () => {
      const r = lint(check)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain('CRITICAL')
      expect(r.stdout).toContain('round-verdict')
      expect(r.stdout).toContain('grind')
    })
  }

  test('a goal check that mentions none of the three is clean', () => {
    const r = lint('bash scripts/measure.sh --rate-below 0.01')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('hold-lint: clean')
  })

  // "results.json" and "work/" without the dot are not the run artefacts; the rule must not
  // swallow every path that merely looks similar.
  test('a near-miss path is not a round verdict', () => {
    expect(lint('bash scripts/gate.sh data/results.json').status).toBe(0)
  })
})

/**
 * The OBJECTIVE rules, which used to live in a second linter over the TICK PROMPT. The tick is a
 * nudge now, so the rules that were really about the objective apply here — to the check command
 * and to the `--goal` text, whichever of the two states it.
 */
describe('the migrated objective rules apply to the check AND to --goal', () => {
  /** rule, the goal text that trips it, its severity, and a CHECK that trips the same rule. */
  const cases: Array<[string, string, string, string]> = [
    ['milestone-phrasing', 'the work run has returned a verdict', 'critical',
      'bash scripts/gate.sh --assert the report exists'],
    ['human-dependency', 'the suite is green and the user has approved it', 'critical',
      'bash scripts/gate.sh --require human review'],
    ['turn-count', 'the rate is down or stop after 12 turns', 'critical',
      'bash scripts/gate.sh --budget 12 turns'],
    ['vague-success', 'the parser handles the filings correctly', 'major',
      'bash scripts/gate.sh --assert parsed correctly'],
  ]

  for (const [rule, text, sev, badCheck] of cases) {
    test(`--goal "${text.slice(0, 32)}" → ${rule}`, () => {
      const r = lint('bash scripts/measure.sh --rate-below 0.01', '--goal', text)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain(`${rule} (goal)`)
      expect(r.stdout).toContain(sev.toUpperCase())
    })

    test(`the same phrasing in the CHECK → ${rule}`, () => {
      const r = lint(badCheck)
      expect(r.status).toBe(1)
      expect(r.stdout).toContain(`${rule} (check)`)
    })
  }

  test('a measured goal is clean on both surfaces', () => {
    const r = lint('bash scripts/measure.sh --rate-below 0.01', '--goal', 'the xml error rate is under 1% across every filing')
    expect(`${r.status}\n${r.stdout}${r.stderr}`).toStartWith('0\n')
  })

  test('--goal with no text is a usage error, not a silent skip', () => {
    const r = lint('bash scripts/gate.sh', '--goal')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('--goal needs the objective text')
  })

  test('the check is still found when --goal precedes it', () => {
    const r = spawnSync('bun', [LINT, '--goal', 'rate under 1%', "bash x's gate.sh"], { timeout: 120_000,
      encoding: 'utf8',
      env: HERMETIC_ENV,
    })
    expect(r.stdout).toContain('apostrophe')
  })
})

describe('work-hold.sh refuses on a CRITICAL finding', () => {
  test('arming on a work-result.sh check exits 2 and writes no state', () => {
    const dir = mkTmp('holdlint-arm-')
    const sid = 'holdlint-test'
    const run = join(dir, 'result.json')
    writeFileSync(run, '{}')
    const r = spawnSync('bash', [ARM, `grep -q done ${run}`], { timeout: 120_000,
      encoding: 'utf8',
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.status).toBe(2)
    expect(r.stdout + r.stderr).toContain('round-verdict')
    expect(r.stderr).toContain('Not armed')
    // "Not armed" has to be true ON DISK: the Stop hook reads the state file, not this exit code.
    expect(existsSync(join(dir, `work-hold-${sid}.json`))).toBe(false)
  })

  test('a CRITICAL in the --goal refuses too, and arms nothing', () => {
    const dir = mkTmp('holdlint-goal-')
    const sid = 'holdlint-goal'
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'measure.sh'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 })
    const r = spawnSync('bash', [ARM, 'bash scripts/measure.sh --rate-below 0.01',
      '--goal', 'the suite is green and the user has approved it'], { timeout: 120_000,
      encoding: 'utf8',
      cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.status).toBe(2)
    expect(r.stdout).toContain('human-dependency (goal)')
    expect(existsSync(join(dir, `work-hold-${sid}.json`))).toBe(false)
  })
})

// ---------------------------------------------------------------- the CHECK-LESS form
//
// A plan that states no `args.goalCheck` still gets a hold: the judge alone on the goal. The goal is
// then the whole objective, so it is exactly the surface that must still be linted — and `--probe`,
// which EXECUTES a check, has nothing to run.

describe('hold-lint with a --goal and no check', () => {
  test('a clean goal is clean', () => {
    const r = spawnSync('bun', [LINT, '--goal', 'every suite in tests/ is green'],
      { timeout: 120_000, encoding: 'utf8', env: HERMETIC_ENV })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('clean')
  })

  test('the objective rules still bite on the goal', () => {
    const r = spawnSync('bun', [LINT, '--goal', 'the report exists and the user has approved it'],
      { timeout: 120_000, encoding: 'utf8', env: HERMETIC_ENV })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('milestone-phrasing (goal)')
    expect(r.stdout).toContain('human-dependency (goal)')
  })

  test('neither a check nor a goal is a usage error, not a clean bill', () => {
    const r = spawnSync('bun', [LINT], { timeout: 120_000, encoding: 'utf8', env: HERMETIC_ENV })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('usage')
  })

  test('--probe with no check is refused rather than probing nothing', () => {
    const r = spawnSync('bun', [LINT, '--goal', 'every suite is green', '--probe'],
      { timeout: 120_000, encoding: 'utf8', env: HERMETIC_ENV })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('needs a check command')
  })
})

describe('work-hold.sh --goal with no check arms a CHECK-LESS hold', () => {
  test('it arms, records an empty check, and says so', () => {
    const dir = mkTmp('holdless-')
    const sid = 'holdless-ok'
    const r = spawnSync('bash', [ARM, '--goal', 'every suite is green', '--rounds', '3', '--minutes', '60'], { timeout: 120_000,
      encoding: 'utf8', cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('ARMED check-less')
    const s = JSON.parse(readFileSync(join(dir, `work-hold-${sid}.json`), 'utf8'))
    expect(s.check).toBe('')
    expect(s.goal).toBe('every suite is green')
  })

  test('--run is recorded absolute, which is what the in-flight rule reads', () => {
    const dir = mkTmp('holdless-')
    const sid = 'holdless-run'
    mkdirSync(join(dir, 'r'), { recursive: true })
    const r = spawnSync('bash', [ARM, '--goal', 'every suite is green', '--run', 'r'], { timeout: 120_000,
      encoding: 'utf8', cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.status).toBe(0)
    expect(JSON.parse(readFileSync(join(dir, `work-hold-${sid}.json`), 'utf8')).run).toBe(join(dir, 'r'))
  })

  /** The two arm-time refusals are facts about a COMMAND, so neither can apply with no command. */
  test('the already-green and could-not-run refusals are skipped, not silently passed', () => {
    const dir = mkTmp('holdless-')
    const sid = 'holdless-nogreen'
    const r = spawnSync('bash', [ARM, '--goal', 'every suite is green'], { timeout: 120_000,
      encoding: 'utf8', cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.stderr).not.toContain('ALREADY exits 0')
    expect(r.stderr).not.toContain('could-not-run')
  })

  test('hold-lint still runs on the goal, and a CRITICAL arms nothing', () => {
    const dir = mkTmp('holdless-')
    const sid = 'holdless-crit'
    const r = spawnSync('bash', [ARM, '--goal', 'the report exists'], { timeout: 120_000,
      encoding: 'utf8', cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.status).toBe(2)
    expect(r.stdout).toContain('milestone-phrasing (goal)')
    expect(existsSync(join(dir, `work-hold-${sid}.json`))).toBe(false)
  })

  test('no check AND no goal is a usage refusal', () => {
    const dir = mkTmp('holdless-')
    const r = spawnSync('bash', [ARM, '--run', dir], { timeout: 120_000,
      encoding: 'utf8', cwd: dir,
      env: { ...HERMETIC_ENV, TMPDIR: dir, CLAUDE_CODE_SESSION_ID: 'holdless-none', WORK_HOLD_COMPACT_WINDOW: '0' },
    })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('usage')
  })
})
