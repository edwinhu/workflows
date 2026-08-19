/**
 * craft-dispatch.sh executes every active task's `redCommand` BEFORE dispatching, and refuses a
 * probe that could not run or that already passes.
 *
 * craft detects `red-not-red` and `green-not-green` at RUN time — after two probe agents, an
 * implementer, a verifier, five lenses and five mechanical checks have already been paid for. Both
 * verdicts are decidable at DISPATCH time from the same command, one round earlier. Observed
 * 2026-08-13: four tasks scored `green-not-green` for a whole round because their `redCommand` was
 * `python3 -m pytest …` and bare `python3` has no pytest — an import error read as a verdict.
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-dispatch.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/craft-dispatch.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

/** A shell script in the fixture, so a `redCommand` is one invocation the way arg-validation demands. */
function script(dir: string, name: string, body: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/**
 * A lint-CLEAN plan whose single task carries `redCommand`, so the only refusal a test can produce
 * is the probe one it asks for.
 */
function fixture(opts: { redCommand: string; extraArgs?: Record<string, unknown>; tasks?: unknown[] } ) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-dispatch-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  const plan = join(dir, 'plan.md')
  const args = {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks: opts.tasks ?? [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: opts.redCommand, acceptance: '`bash scripts/check.sh` exits 0',
    }],
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
    ...(opts.extraArgs ?? {}),
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'probe-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, runDir: join(dir, '.craft', 'probe-run'), argsPath: join(dir, '.craft', 'probe-run', 'args.json') }
}

/** Dispatch, stopped short of the goal self-send and the farm-out. The probe still runs. */
function dispatch(f: { dir: string; plan: string }, ...extra: string[]) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...extra, f.plan], {
      encoding: 'utf8', cwd: f.dir, env: { ...process.env, CRAFT_DISPATCH_DRYRUN: '1' },
    })
    return { code: 0, out: stdout }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

describe('the redCommand probe runs at dispatch, not a round later', () => {
  test('a redCommand that genuinely fails a test PROCEEDS — non-zero with a real test result is the RED craft wants', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed, 0 passed"\nexit 1')
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/red-probe T1: red\b/)
    expect(existsSync(f.argsPath)).toBe(true)
  })

  test('exit 127 is refused as could-not-run — the command was never found, so its exit code is not a verdict', () => {
    const f = fixture({ redCommand: 'bash scripts/absent.sh' })
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/BLOCKED/)
    expect(r.out).toMatch(/could-not-run/)
    expect(r.out).toMatch(/T1/)
    expect(r.out).toMatch(/scripts\/absent\.sh/)
  })

  test('the live failure mode: `python3 -m pytest` with no pytest is could-not-run, not green-not-green', () => {
    const f = fixture({ redCommand: 'python3 -m pytest tests/' })
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/could-not-run/)
    expect(r.out).toMatch(/pytest/)
  })

  test('exit 0 is refused as red-not-red — an already-green probe proves nothing and costs a whole round', () => {
    const f = fixture({ redCommand: 'bash scripts/green.sh' })
    script(f.dir, 'green.sh', 'echo "3 passed"\nexit 0')
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/red-not-red/)
  })

  test('a non-zero exit with no test output at all is could-not-run — silence is not evidence of a failing test', () => {
    const f = fixture({ redCommand: 'bash scripts/silent.sh' })
    script(f.dir, 'silent.sh', 'exit 1')
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/no test output/)
  })

  test('only the tasks that will actually run are probed — a redCommand outside onlyTasks is not executed', () => {
    const f = fixture({
      redCommand: 'bash scripts/check.sh',
      tasks: [
        { id: 'T1', name: 'one', work: 'w', writablePaths: ['src/a'], refs: [], redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0' },
        { id: 'T2', name: 'two', work: 'w', writablePaths: ['src/b'], refs: [], redCommand: 'bash scripts/green.sh', acceptance: '`bash scripts/green.sh` exits 0' },
      ],
      extraArgs: { onlyTasks: ['T1'] },
    })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    script(f.dir, 'green.sh', 'echo "3 passed"\nexit 0')  // would be red-not-red if it were probed
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/red-probe T1/)
    expect(r.out).not.toMatch(/red-probe T2/)
  })

  test('a suite that never LOADED is could-not-run — an import error is not a behavioural red', () => {
    // dev CLARIFY axis 5 refuses this shape in prose; before this rule the probe accepted it.
    // Measured: pytest exits 2 and prints "1 error in 0.04s", which the EVIDENCE regex matches,
    // so a plan whose surface did not exist yet dispatched on a red that proved nothing.
    const f = fixture({ redCommand: 'bash scripts/collect.sh' })
    script(f.dir, 'collect.sh', 'echo "ERROR test_x.py"\necho "Interrupted: 1 error during collection"\necho "1 error in 0.04s"\nexit 2')
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/never loaded/)
  })

  test('a genuine assertion failure is still red — the collection rule must not eat real reds', () => {
    const f = fixture({ redCommand: 'bash scripts/assert.sh' })
    script(f.dir, 'assert.sh', 'echo "E   AssertionError: 2 != 1"\necho "1 failed in 0.05s"\nexit 1')
    const r = dispatch(f)
    expect(r.out).toMatch(/red-probe .*: red /)
  })

  test('a readOnly run probes nothing — no redCommand is dispatched there either', () => {
    const f = fixture({ redCommand: 'bash scripts/green.sh', extraArgs: { readOnly: true } })
    script(f.dir, 'green.sh', 'echo "3 passed"\nexit 0')
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/red-probe: readOnly/)
  })

  // TIER 2b. The hole this closes, precisely: red_probe_gate returns early on readOnly, and a
  // readOnly run's entire gate is its mechanicalChecks — so before this, a `readOnly` dispatch
  // executed NOTHING at baseline. Measured 2026-08-13: a slides mechanicalCheck leg exited 127
  // (the script did not exist) and survived eight rounds of plan review, because nothing ran it.
  test('a mechanicalCheck that exits 127 at baseline REFUSES the dispatch', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh',
      extraArgs: { mechanicalChecks: [{ name: 'gate', cmd: 'bash scripts/absent-checker.sh' }] } })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/mech-probe gate: exit 127/)
    expect(r.out).toMatch(/CRITICAL gate-command-not-found/)
    expect(r.out).toMatch(/cannot run at BASELINE/)
  })

  test('the mechanical baseline is probed on a readOnly run, where it IS the whole gate', () => {
    const f = fixture({ redCommand: 'bash scripts/green.sh',
      extraArgs: { readOnly: true, tasks: [],
        mechanicalChecks: [{ name: 'gate', cmd: 'bash scripts/absent-checker.sh' }] } })
    const r = dispatch(f)
    expect(r.out).toMatch(/red-probe: readOnly/)      // TIER 2 still opts out, as before
    expect(r.code).toBe(3)                             // TIER 2b does not
    expect(r.out).toMatch(/mech-probe gate: exit 127/)
  })

  test('a readOnly plan with tasks: [] is lintable — TIER 1 must not refuse the shape TIER 2b exists for', () => {
    const f = fixture({ redCommand: 'bash scripts/green.sh',
      extraArgs: { readOnly: true, tasks: [],
        mechanicalChecks: [{ name: 'gate', cmd: 'bash scripts/passing.sh' }] } })
    script(f.dir, 'passing.sh', 'exit 0')
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/0 finding\(s\) over 0 task\(s\)/)
    expect(r.out).toMatch(/mech-probe gate: exit 0/)
  })

  test('a mechanicalCheck that merely FAILS at baseline proceeds — a red baseline is normal', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh',
      extraArgs: { mechanicalChecks: [{ name: 'gate', cmd: 'bash scripts/failing.sh' }] } })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    script(f.dir, 'failing.sh', 'echo "2 failed"\nexit 1')
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/mech-probe gate: exit 1/)
  })

  test('--no-mech-probe is the escape hatch and keeps the red probe running', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh',
      extraArgs: { mechanicalChecks: [{ name: 'gate', cmd: 'bash scripts/absent-checker.sh' }] } })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    const r = dispatch(f, '--no-mech-probe')
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/mech-probe/)
    expect(r.out).toMatch(/red-probe T1: red\b/)       // TIER 2 still ran
  })

  test('--no-red-probe is the escape hatch and keeps plan-lint running', () => {
    const f = fixture({ redCommand: 'bash scripts/absent.sh' })
    const r = dispatch(f, '--no-red-probe')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/finding\(s\) over 1 task\(s\)/)   // plan-lint still ran
  })

  test('--no-lint drops both dispatch gates, as its own text promises', () => {
    const f = fixture({ redCommand: 'bash scripts/absent.sh' })
    expect(dispatch(f, '--no-lint').code).toBe(0)
  })
})

describe('a probe refusal is atomic — the run is left exactly as it was', () => {
  test('nothing is dispatched and args.json is never created on a first dispatch', () => {
    const f = fixture({ redCommand: 'bash scripts/absent.sh' })
    expect(dispatch(f).code).toBe(3)
    expect(existsSync(f.argsPath)).toBe(false)
    expect(existsSync(join(f.runDir, '.args.lint.json'))).toBe(false)
  })

  test('rounds, args.json and result.json are byte-identical after a refusal', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)                       // a real args.json, from a clean round

    const a = JSON.parse(readFileSync(f.argsPath, 'utf8'))
    a.rounds = 5
    writeFileSync(f.argsPath, JSON.stringify(a, null, 2) + '\n')
    writeFileSync(join(f.runDir, 'result.json'), JSON.stringify({
      overallPass: false, verdict: 'FAIL',
      tasksThatFlagged: ['T1'], mechanicalThatFailed: [], lensesThatFlagged: [],
      findings: [],
    }, null, 2) + '\n')

    const argsBefore = readFileSync(f.argsPath, 'utf8')
    const resultBefore = readFileSync(join(f.runDir, 'result.json'), 'utf8')

    script(f.dir, 'check.sh', 'echo "3 passed"\nexit 0')   // the gate has gone green: red-not-red
    expect(dispatch(f).code).toBe(3)

    expect(readFileSync(f.argsPath, 'utf8')).toBe(argsBefore)
    expect(JSON.parse(readFileSync(f.argsPath, 'utf8')).rounds).toBe(5)
    expect(readFileSync(join(f.runDir, 'result.json'), 'utf8')).toBe(resultBefore)
  })
})

/**
 * The plan file is NOT craft's, and nothing preserves it: `.claude/plans/` is gitignored scratch, and
 * re-entering plan mode in the same session OVERWRITES the file the harness told it to overwrite.
 * Measured 2026-08-13: the plan behind dotfiles 025c90a2 was destroyed that way and recoverable only
 * from a session transcript. Every dispatched agent verifies `specHash` against `planPath`, so after
 * an overwrite the hash proves only that the spec CHANGED — it cannot say what was approved.
 *
 * So dispatch archives the exact bytes it hashed into the run dir, next to args.json. The name is
 * content-addressed, which is what makes it non-destructive: an amended plan adds an archive and can
 * never overwrite the one an earlier round ran under.
 */
describe('the dispatched plan is archived, so a run carries the plan it was approved with', () => {
  const archives = (runDir: string) => readdirSync(runDir).filter(f => /^plan-[0-9a-f]{12}\.md$/.test(f))

  test('the archive is byte-identical to the plan and named by the hash args.json records', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)

    const found = archives(f.runDir)
    expect(found).toHaveLength(1)
    const planBytes = readFileSync(f.plan, 'utf8')
    expect(readFileSync(join(f.runDir, found[0]), 'utf8')).toBe(planBytes)
    // The archive is the file the run's authority names, not merely a plan-shaped file beside it.
    expect(found[0]).toBe(`plan-${JSON.parse(readFileSync(f.argsPath, 'utf8')).specHash.slice(0, 12)}.md`)
  })

  test('overwriting the plan file afterwards leaves the archive intact — the destruction this exists for', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)
    const approved = readFileSync(f.plan, 'utf8')

    writeFileSync(f.plan, '# A DIFFERENT plan, written by re-entering plan mode\n')

    const found = archives(f.runDir)
    expect(found).toHaveLength(1)
    expect(readFileSync(join(f.runDir, found[0]), 'utf8')).toBe(approved)
    expect(found[0]).toBe(`plan-${JSON.parse(readFileSync(f.argsPath, 'utf8')).specHash.slice(0, 12)}.md`)
  })

  test('dispatch says where it archived the plan — an archive nobody is told about is not a recovery path', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).out).toMatch(/plan:\s+.*plan-[0-9a-f]{12}\.md/)
  })

  test('a refused dispatch archives nothing — a plan that never ran is not a run artifact', () => {
    const f = fixture({ redCommand: 'bash scripts/absent.sh' })
    expect(dispatch(f).code).toBe(3)
    expect(existsSync(f.runDir) ? archives(f.runDir) : []).toEqual([])
  })

  test('re-dispatching an AMENDED plan adds a second archive and never overwrites the first', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)
    const first = archives(f.runDir)[0]
    const firstBytes = readFileSync(join(f.runDir, first), 'utf8')

    writeFileSync(f.plan, firstBytes.replace('"work": "do the thing"', '"work": "do the AMENDED thing"'))
    expect(dispatch(f).code).toBe(0)

    const found = archives(f.runDir)
    expect(found).toHaveLength(2)
    expect(readFileSync(join(f.runDir, first), 'utf8')).toBe(firstBytes)
    expect(found.map(n => readFileSync(join(f.runDir, n), 'utf8')))
      .toContain(readFileSync(f.plan, 'utf8'))
  })

  test('re-dispatching the SAME plan does not multiply archives — the name is the content', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)
    expect(dispatch(f).code).toBe(0)
    expect(archives(f.runDir)).toHaveLength(1)
  })

  test('--run-dir puts the archive with the run it belongs to, not in the tree the run may not write', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    const elsewhere = mkdtempSync(join(tmpdir(), 'craft-runs-'))
    scratch.push(elsewhere)
    expect(dispatch(f, '--run-dir', elsewhere).code).toBe(0)
    expect(archives(join(elsewhere, 'probe-run'))).toHaveLength(1)
    expect(existsSync(f.runDir)).toBe(false)
  })
})

/**
 * A task whose work is COMPLETE satisfies neither gate: a redCommand is refused `red-not-red`, and
 * omitting it is refused `redcommand-missing`. `redDisposition` is the declared third answer, and
 * dispatch ECHOES it so the claim is visible rather than silent.
 */
describe('redDisposition breaks the red deadlock and is echoed, never validated', () => {
  const dispositioned = (id: string, disposition: string) => ({
    id, name: id, work: 'do the thing', writablePaths: [`src/${id}`], refs: [],
    redDisposition: disposition, acceptance: '`bash scripts/check.sh` exits 0',
  })

  test('a task declaring redDisposition instead of redCommand dispatches — neither gate refuses it', () => {
    const f = fixture({
      redCommand: 'unused',
      tasks: [dispositioned('T4', 'work complete round 6; covered by extraction-unity lens')],
    })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/redcommand-missing/)
    expect(existsSync(f.argsPath)).toBe(true)
  })

  test('dispatch echoes every disposition alongside the wave graph', () => {
    const f = fixture({
      redCommand: 'bash scripts/check.sh',
      tasks: [
        { id: 'T1', name: 'one', work: 'w', writablePaths: ['src/a'], refs: [], redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0' },
        dispositioned('T4', 'work complete round 6; covered by extraction-unity lens'),
        dispositioned('T5', 'tests already pass; verified round 5'),
      ],
    })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/red: 1 gated, 2 dispositioned/)
    expect(r.out).toMatch(/T4\s+"work complete round 6; covered by extraction-unity lens"/)
    expect(r.out).toMatch(/T5\s+"tests already pass; verified round 5"/)
  })

  test('a dispositioned task is not probed — there is no command to run', () => {
    const f = fixture({ redCommand: 'unused', tasks: [dispositioned('T4', 'work complete')] })
    const r = dispatch(f)
    expect(r.out).not.toMatch(/red-probe T4/)
  })

  test('declaring both is refused by plan-lint before any probe runs — REGRESSION GUARD on the gate', () => {
    const f = fixture({
      redCommand: 'bash scripts/check.sh',
      tasks: [{
        id: 'T1', name: 'one', work: 'w', writablePaths: ['src/a'], refs: [],
        redCommand: 'bash scripts/check.sh', redDisposition: 'work complete',
        acceptance: '`bash scripts/check.sh` exits 0',
      }],
    })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/red-both-declared/)
    expect(existsSync(f.argsPath)).toBe(false)
  })
})

/**
 * THE SPEC IS THE AUTHORITY, NOT THE PROSE.
 *
 * Dispatch used to hash the whole plan markdown, so the rationale paragraphs around the
 * `craft:dispatch` block were authenticated too: fixing a typo in prose invalidated a live run and
 * cost a round. The authored SPEC is the block; the prose explains it. So the hash is over the
 * CANONICAL form of the parsed block — `json.dumps(parsed, sort_keys=True, separators=(',',':'))` —
 * which makes reindenting and key reordering free and any value change loud.
 */
describe('--spec-hash hashes the authored spec, not the bytes around it', () => {
  /** A plan carrying an arbitrary dispatch block plus prose, written to its own temp dir. */
  function planWith(block: unknown, prose = 'Some rationale.\n', indent: number | string = 2) {
    const dir = mkdtempSync(join(tmpdir(), 'craft-spechash-'))
    scratch.push(dir)
    const p = join(dir, 'plan.md')
    writeFileSync(p, `# Plan\n\n${prose}\n<!-- craft:dispatch\n${JSON.stringify(block, null, indent as any)}\n-->\n`)
    return p
  }
  function specHash(plan: string) {
    try {
      return { code: 0, out: execFileSync('bash', [SCRIPT, '--spec-hash', plan], { encoding: 'utf8' }) }
    } catch (e: any) {
      return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
    }
  }
  const BLOCK = {
    runId: 'spec-run',
    args: { projectDir: '/tmp/p', goal: 'g', tasks: [{ id: 'T1', name: 'one', work: 'w', acceptance: 'a' }] },
  }

  test('it prints one 64-hex line and nothing else', () => {
    const r = specHash(planWith(BLOCK))
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^[0-9a-f]{64}\n$/)
  })

  test('reindenting the block does NOT move the hash — formatting is not authority', () => {
    const a = specHash(planWith(BLOCK, 'p\n', 2))
    const b = specHash(planWith(BLOCK, 'p\n', 6))
    expect(a.code).toBe(0)
    expect(b.out).toBe(a.out)
  })

  test('reordering the block keys does NOT move the hash — canonicalisation sorts them', () => {
    const a = specHash(planWith(BLOCK))
    const reordered = { args: BLOCK.args, runId: BLOCK.runId }
    expect(specHash(planWith(reordered)).out).toBe(a.out)
  })

  test('editing PROSE outside the block does NOT move the hash — the whole point of the change', () => {
    const a = specHash(planWith(BLOCK, 'Original rationale.\n'))
    const b = specHash(planWith(BLOCK, 'Original rationale, with a typo fixed and a paragraph added.\n\nMore prose.\n'))
    expect(a.code).toBe(0)
    expect(b.out).toBe(a.out)
  })

  test('editing ANY value inside the block DOES move the hash', () => {
    const a = specHash(planWith(BLOCK))
    const edited = JSON.parse(JSON.stringify(BLOCK))
    edited.args.tasks[0].work = 'DIFFERENT work'
    expect(specHash(planWith(edited)).out).not.toBe(a.out)
  })

  test('a plan with no craft:dispatch block fails loudly rather than printing a hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-spechash-'))
    scratch.push(dir)
    const p = join(dir, 'plan.md')
    writeFileSync(p, '# Plan with prose only\n')
    const r = specHash(p)
    expect(r.code).not.toBe(0)
    expect(r.out).not.toMatch(/[0-9a-f]{64}/)
    expect(r.out).toMatch(/craft:dispatch/)
  })

  test('a block that is not valid JSON fails loudly rather than printing a hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-spechash-'))
    scratch.push(dir)
    const p = join(dir, 'plan.md')
    writeFileSync(p, '# Plan\n\n<!-- craft:dispatch\n{ "runId": "x", oops\n-->\n')
    const r = specHash(p)
    expect(r.code).not.toBe(0)
    expect(r.out).not.toMatch(/[0-9a-f]{64}/)
    expect(r.out).toMatch(/JSON/i)
  })
})

describe('dispatch injects specHash, and planHash is gone', () => {
  test('args.json carries a 64-hex specHash matching --spec-hash, and no planHash at all', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)
    const a = JSON.parse(readFileSync(f.argsPath, 'utf8'))
    expect(a.planHash).toBeUndefined()
    expect(a.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.specHash).toBe(execFileSync('bash', [SCRIPT, '--spec-hash', f.plan], { encoding: 'utf8' }).trim())
    expect(a.planPath).toBe(f.plan)
  })

  test('a prose-only edit re-dispatches under the SAME specHash — no round is spent on a typo', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)
    const before = JSON.parse(readFileSync(f.argsPath, 'utf8')).specHash

    writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replace('# Plan', '# Plan\n\nA sentence added to the rationale.'))
    expect(dispatch(f).code).toBe(0)
    expect(JSON.parse(readFileSync(f.argsPath, 'utf8')).specHash).toBe(before)
  })

  test('the archived plan is named by the SPEC hash args.json records', () => {
    const f = fixture({ redCommand: 'bash scripts/check.sh' })
    script(f.dir, 'check.sh', 'echo "1 failed"\nexit 1')
    expect(dispatch(f).code).toBe(0)
    const spec = JSON.parse(readFileSync(f.argsPath, 'utf8')).specHash
    expect(readdirSync(f.runDir).filter(n => /^plan-[0-9a-f]{12}\.md$/.test(n)))
      .toEqual([`plan-${spec.slice(0, 12)}.md`])
  })
})

/**
 * `--covers` answers the one question main-thread-guard.sh needs while a plan is armed: is this
 * path the run's own output?
 *
 * The guard used to deny EVERY Edit and Write until args.json landed, which deadlocked the thing
 * craft requires most — dispatch probes every `redCommand` before wave 1, so the failing suite must
 * already exist, and `self-gating-task` forbids the task that would write it. The suite is
 * therefore in no task's writablePaths, and that is exactly what makes it safe to author in chat:
 * no implementer could have produced it. Anything inside a writable set still belongs to the gate.
 */
describe('--covers separates the run\'s own output from what no task may write', () => {
  function planWith(tasks: unknown[], extra: Record<string, unknown> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'craft-covers-'))
    scratch.push(dir)
    const p = join(dir, 'plan.md')
    const block = { runId: 'covers-run', args: { projectDir: dir, goal: 'g', tasks, ...extra } }
    writeFileSync(p, `# Plan\n\n<!-- craft:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
    return { dir, plan: p }
  }
  /** 0 covered, 1 outside every writable set, 2 undecidable. */
  function covers(plan: string, path: string): number {
    try {
      execFileSync('bash', [SCRIPT, '--covers', plan, path], { encoding: 'utf8' })
      return 0
    } catch (e: any) { return e.status ?? -1 }
  }
  const TASKS = [
    { id: 'T1', writablePaths: ['src/impl.ts'] },
    { id: 'T2', writablePaths: ['lib/'] },
    { id: 'T3', writablePaths: ['/abs/elsewhere/thing.sh'] },
  ]

  test('a file a task may write is covered', () => {
    const f = planWith(TASKS)
    expect(covers(f.plan, join(f.dir, 'src/impl.ts'))).toBe(0)
  })

  test('a file under a writable DIRECTORY is covered', () => {
    const f = planWith(TASKS)
    expect(covers(f.plan, join(f.dir, 'lib/deep/nested.ts'))).toBe(0)
  })

  test('an absolute writablePath is covered without a projectDir join', () => {
    const f = planWith(TASKS)
    expect(covers(f.plan, '/abs/elsewhere/thing.sh')).toBe(0)
  })

  test('the red suite every gate points at is covered by nobody — the deadlock this exists to break', () => {
    const f = planWith(TASKS)
    expect(covers(f.plan, join(f.dir, 'src/impl.test.ts'))).toBe(1)
  })

  test('a sibling whose name merely PREFIXES a writable one is not covered', () => {
    const f = planWith([{ id: 'T1', writablePaths: ['lib/'] }])
    expect(covers(f.plan, join(f.dir, 'library.ts'))).toBe(1)
  })

  test('a DIRECTORY containing a writablePath is not covered — containment is one-directional', () => {
    const f = planWith([{ id: 'T1', writablePaths: ['src/deep/impl.ts'] }])
    expect(covers(f.plan, join(f.dir, 'src'))).toBe(1)
  })

  test('a spec naming no writable surface is undecidable, never a "no"', () => {
    expect(covers(planWith([{ id: 'T1' }]).plan, '/tmp/x')).toBe(2)
    expect(covers(planWith([], { readOnly: true }).plan, '/tmp/x')).toBe(2)
  })

  test('an unparseable or blockless plan is undecidable, so the guard fails closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-covers-'))
    scratch.push(dir)
    const bad = join(dir, 'bad.md')
    writeFileSync(bad, '# Plan\n\n<!-- craft:dispatch\n{not json,\n-->\n')
    expect(covers(bad, '/tmp/x')).toBe(2)
    const none = join(dir, 'none.md')
    writeFileSync(none, '# Plan\n\nno block here\n')
    expect(covers(none, '/tmp/x')).toBe(2)
    expect(covers(join(dir, 'missing.md'), '/tmp/x')).toBe(2)
  })
})
