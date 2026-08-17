#!/usr/bin/env bun
/**
 * craft-result.test.ts — suite for craft-result.sh, the adjudicator on the farm-out return path.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-result.test.ts
 *
 * Three exit codes are under test: 0 PASS, 1 FAIL, 2 REFUSED. Every run gets an args.json
 * sibling, because the script refuses without one.
 *
 * The script is reached by spawning it, never by import, so a not-yet-written or
 * non-executable script fails as N individual failing tests rather than one module-load
 * error that takes the file down and reports a fail count of 0.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'craft-result.sh')

const REQUIRED = [
  'overallPass',
  'verdict',
  'scoreTable',
  'findings',
  'tasksThatFlagged',
  'mechanicalThatFailed',
  'lensesThatFlagged',
] as const

/** A well-formed craft gate return: every required key, every type correct. */
const valid = () => ({
  overallPass: true,
  verdict: 'PASS',
  scoreTable: {
    tasksTotal: 2,
    tasksJudgedThisRun: 2,
    implementedDone: 2,
    verifyPassed: 2,
    lensesRun: 3,
    lensesReported: 3,
    lensFindings: 1,
    refuted: 1,
    survivingBlocking: 0,
    survivingMinor: 0,
    mechanicalRun: 2,
    mechanicalPassed: 2,
    thirdPartyAdvisoryFindings: 0,
  },
  findings: [],
  tasksThatFlagged: [],
  mechanicalThatFailed: [],
  lensesThatFlagged: [],
})

/** A well-formed FAIL return — non-empty selectors, still a valid shape. */
const validFail = () => ({
  ...valid(),
  overallPass: false,
  verdict: 'FAIL',
  findings: [{ lens: 'scope-fidelity', severity: 'critical', what: 'out-of-scope edit' }],
  tasksThatFlagged: ['T2'],
  mechanicalThatFailed: [{ key: 'node-check', exitCode: 1 }],
  lensesThatFlagged: ['scope-fidelity'],
})

let n = 0
const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) {
    chmodSync(dir, 0o700)
    rmSync(dir, { recursive: true, force: true })
  }
})

type RunOpts = {
  /** Object written to args.json; `null` writes none at all. Default: no mechanical checks. */
  args?: unknown
  /** Verbatim args.json body, for malformed-input cases. Wins over `args`. */
  argsRaw?: string
}

/** A fresh run directory holding the result file and (unless suppressed) its args.json sibling. */
function mkRun(body: string, opts: RunOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-result-'))
  scratch.push(dir)
  const file = join(dir, `r${n++}.json`)
  writeFileSync(file, body)
  const argsPath = join(dir, 'args.json')
  if (opts.argsRaw !== undefined) writeFileSync(argsPath, opts.argsRaw)
  else if (opts.args !== null) {
    writeFileSync(argsPath, JSON.stringify(opts.args ?? { projectDir: dir, mechanicalChecks: [] }, null, 2))
  }
  return { dir, file, argsPath }
}

/** Write `body` verbatim to a fresh temp file and run the script against it. */
function runRaw(body: string, opts: RunOpts = {}) {
  return runOn(mkRun(body, opts).file)
}

function runOn(file: string) {
  const r = spawnSync(SCRIPT, [file], { encoding: 'utf8' })
  // No numeric status means the binary never ran (script absent / not executable).
  // Asserted here rather than returned as a synthetic non-zero code: "did not run"
  // would otherwise satisfy every `code !== 0` refusal test, and the suite would pass
  // vacuously against no script at all. Checked as a number, not `!== null` — bun
  // leaves status `undefined` on ENOENT, which a null check waves through.
  expect(typeof r.status, `craft-result.sh did not execute: ${r.error?.message ?? 'no exit status'}`).toBe('number')
  return { code: r.status as number, stdout: r.stdout || '', stderr: r.stderr || '' }
}

const runJson = (obj: unknown, opts: RunOpts = {}) => runRaw(JSON.stringify(obj, null, 2), opts)

describe('craft-result.sh accepts a well-formed gate return', () => {
  test('a valid PASS object exits 0', () => {
    expect(runJson(valid()).code).toBe(0)
  })

  test('a valid FAIL object is a valid shape and exits 1 — the code is the verdict', () => {
    expect(runJson(validFail()).code).toBe(1)
  })

  test('success prints the verdict', () => {
    expect(runJson(valid()).stdout).toContain('PASS')
    expect(runJson(validFail()).stdout).toContain('FAIL')
  })

  test('success prints the score table entries', () => {
    const out = runJson(valid()).stdout
    expect(out).toContain('tasksTotal')
    expect(out).toContain('mechanicalPassed')
    expect(out).toMatch(/tasksTotal\D+2/)
  })

  // residue: blocking-severity findings a freezeFindingSet round raised but did not gate on. Present
  // only on a frozen round, so both presence and absence must adjudicate.
  test('a result carrying residue adjudicates and reports the count', () => {
    const r = runJson({
      ...valid(),
      scoreTable: { ...valid().scoreTable, residue: 2 },
      residue: [
        { title: 'a', severity: 'critical', detail: 'd', lens: 'alpha' },
        { title: 'b', severity: 'major', detail: 'd', lens: 'beta' },
      ],
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/residue\D+2/)
  })

  // The count is COUNTED here, not read out of the transcribed table — same reason the mechanical
  // claims are re-run rather than believed.
  test('a scoreTable residue count that disagrees with the residue array is refused', () => {
    const r = runJson({
      ...valid(),
      scoreTable: { ...valid().scoreTable, residue: 0 },
      residue: [{ title: 'a', severity: 'critical', detail: 'd', lens: 'alpha' }],
    })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('residue')
  })

  test('a result with no residue key still adjudicates and says nothing about residue', () => {
    const r = runJson(valid())
    expect(r.code).toBe(0)
    expect(r.stdout).not.toContain('residue')
  })

  test('residue of the wrong type is refused rather than printed', () => {
    for (const bad of ['2', 2, {}, null]) {
      expect(runJson({ ...valid(), residue: bad }).code).toBe(2)
    }
  })

  test('extra keys beyond the required set do not refuse', () => {
    const r = runJson({ ...valid(), implemented: [], verified: [], red: [], mechanical: [] })
    expect(r.code).toBe(0)
  })
})

describe('craft-result.sh refuses a missing required key', () => {
  for (const key of REQUIRED) {
    test(`missing ${key} exits non-zero`, () => {
      const obj: Record<string, unknown> = valid()
      delete obj[key]
      expect(runJson(obj).code).not.toBe(0)
    })

    test(`missing ${key} names it on stderr`, () => {
      const obj: Record<string, unknown> = valid()
      delete obj[key]
      expect(runJson(obj).stderr).toContain(key)
    })

    test(`${key} present but null exits non-zero`, () => {
      expect(runJson({ ...valid(), [key]: null }).code).not.toBe(0)
    })
  }
})

describe('craft-result.sh refuses a wrong type', () => {
  const wrong: Array<[string, unknown]> = [
    ['overallPass as a string', { ...valid(), overallPass: 'true' }],
    ['overallPass as a number', { ...valid(), overallPass: 1 }],
    ['verdict as a number', { ...valid(), verdict: 0 }],
    ['verdict as an array', { ...valid(), verdict: ['PASS'] }],
    ['scoreTable as an array', { ...valid(), scoreTable: [] }],
    ['scoreTable as a string', { ...valid(), scoreTable: 'tasksTotal=2' }],
    ['findings as an object', { ...valid(), findings: {} }],
    ['findings as a string', { ...valid(), findings: '' }],
    ['tasksThatFlagged as a string', { ...valid(), tasksThatFlagged: 'T2' }],
    ['tasksThatFlagged as an object', { ...valid(), tasksThatFlagged: {} }],
    ['mechanicalThatFailed as a number', { ...valid(), mechanicalThatFailed: 0 }],
    ['lensesThatFlagged as an object', { ...valid(), lensesThatFlagged: {} }],
  ]
  for (const [label, obj] of wrong) {
    test(`${label} exits non-zero`, () => {
      expect(runJson(obj).code).not.toBe(0)
    })
  }

  test('a top-level array is not a gate return', () => {
    expect(runJson([valid()]).code).not.toBe(0)
  })

  test('a top-level scalar is not a gate return', () => {
    expect(runRaw('"PASS"').code).not.toBe(0)
  })

  test('top-level null is not a gate return', () => {
    expect(runRaw('null').code).not.toBe(0)
  })
})

describe('craft-result.sh refuses unreadable input', () => {
  test('an empty file exits non-zero', () => {
    expect(runRaw('').code).not.toBe(0)
  })

  test('a whitespace-only file exits non-zero', () => {
    expect(runRaw('   \n\n  ').code).not.toBe(0)
  })

  test('a non-JSON file exits non-zero', () => {
    expect(runRaw('the workflow returned PASS with 2 of 2 tasks done\n').code).not.toBe(0)
  })

  test('truncated JSON exits non-zero', () => {
    expect(runRaw('{"overallPass": true, "verdict": "PA').code).not.toBe(0)
  })

  test('a nonexistent path exits non-zero', () => {
    expect(runOn(join(tmpdir(), 'craft-result-does-not-exist-9d3f.json')).code).not.toBe(0)
  })

  test('no argument at all exits non-zero', () => {
    const r = spawnSync(SCRIPT, [], { encoding: 'utf8' })
    expect(typeof r.status).toBe('number')
    expect(r.status).not.toBe(0)
  })

  test('a refusal writes nothing that could be mistaken for a verdict on stdout', () => {
    const obj: Record<string, unknown> = valid()
    delete obj.verdict
    expect(runJson(obj).stdout).not.toContain('PASS')
  })
})

/** A result claiming `exitCode` for one check named m1. */
const claiming = (exitCode: number, over: Record<string, unknown> = {}) => ({
  ...valid(),
  ...over,
  mechanical: [{ name: 'm1', exitCode, output: '' }],
})
/** args.json declaring one check m1 running `cmd` from `projectDir`. */
const declaring = (cmd: string, projectDir: string) => ({
  projectDir,
  mechanicalChecks: [{ name: 'm1', cmd }],
})

describe('craft-result.sh adjudicates every claimed mechanical pass against the shell', () => {
  test('a claimed exitCode 0 for a command that really exits 1 is REFUSED with exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(0), { args: declaring('exit 1', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/claims exitCode 0, the shell observed 1/)
    expect(r.stderr).toContain('m1')
    expect(r.stdout).toBe('')
  })

  test('the refusal names the offending check when an earlier one is honest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(
      { ...valid(), mechanical: [{ name: 'ok', exitCode: 0, output: '' }, { name: 'liar', exitCode: 0, output: '' }] },
      {
        args: {
          projectDir: dir,
          mechanicalChecks: [{ name: 'ok', cmd: 'true' }, { name: 'liar', cmd: 'exit 3' }],
        },
      },
    )
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('liar')
    expect(r.stderr).toMatch(/observed 3/)
  })

  test('an honest claim with overallPass false exits 1 and still prints the verdict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(0, { overallPass: false, verdict: 'FAIL' }), { args: declaring('true', dir) })
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('FAIL')
    expect(r.stdout).toContain('score table')
  })

  test('an honest claim with overallPass true exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(0), { args: declaring('true', dir) })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('PASS')
  })

  test('the re-run happens in the run projectDir, not the caller cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    writeFileSync(join(dir, 'sentinel'), 'x')
    expect(runJson(claiming(0), { args: declaring('test -f sentinel', dir) }).code).toBe(0)
    // Same command, a projectDir without the sentinel: the check really runs there.
    const empty = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(empty)
    expect(runJson(claiming(0), { args: declaring('test -f sentinel', empty) }).code).toBe(2)
  })

  test('a claimed FAILURE is re-run too — the file is a transcription, not the gate object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const marker = join(dir, 'ran')
    const r = runJson(claiming(1, { overallPass: false, verdict: 'FAIL' }), {
      args: declaring(`touch ${marker}; exit 1`, dir),
    })
    expect(r.code).toBe(1)
    expect(existsSync(marker)).toBe(true)
  })

  test('a fabricated FAILURE claim — exitCode 1 for a command that exits 0 — is REFUSED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(1, { overallPass: false, verdict: 'FAIL' }), { args: declaring('true', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/claims exitCode 1, the shell observed 0/)
    expect(r.stdout).toBe('')
  })

  test('a claimed exit code the shell contradicts in value alone is REFUSED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(1, { overallPass: false, verdict: 'FAIL' }), { args: declaring('exit 7', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/claims exitCode 1, the shell observed 7/)
  })

  test('a fabricated PASS verdict over a claimed-failed check is REFUSED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    // overallPass true is arithmetically impossible beside a non-zero mechanical claim; the
    // transcription, not the gate, is what wrote it.
    const r = runJson(claiming(1), { args: declaring('exit 1', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('m1')
    expect(r.stdout).toBe('')
  })

  test('a fabricated PASS is refused even when the honest checks around it agree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(
      {
        ...valid(),
        mechanical: [
          { name: 'ok', exitCode: 0, output: '' },
          { name: 'broken', exitCode: 2, output: '' },
        ],
      },
      {
        args: {
          projectDir: dir,
          mechanicalChecks: [{ name: 'ok', cmd: 'true' }, { name: 'broken', cmd: 'exit 2' }],
        },
      },
    )
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('broken')
  })
})

describe('craft-result.sh refuses rather than skipping the adjudication', () => {
  test('a missing args.json is REFUSED, never waved through', () => {
    const r = runJson(valid(), { args: null })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('args.json')
    expect(r.stdout).toBe('')
  })

  test('an unreadable args.json is REFUSED', () => {
    const { file, argsPath } = mkRun(JSON.stringify(valid()))
    chmodSync(argsPath, 0o000)
    const r = runOn(file)
    expect(r.code).toBe(2)
    expect(r.stdout).toBe('')
  })

  test('an args.json that is not JSON is REFUSED', () => {
    expect(runJson(valid(), { argsRaw: 'projectDir=/tmp\n' }).code).toBe(2)
  })

  test('an args.json that is a JSON array is REFUSED', () => {
    expect(runJson(valid(), { argsRaw: '[]' }).code).toBe(2)
  })

  test('an args.json with no projectDir is REFUSED', () => {
    expect(runJson(valid(), { args: { mechanicalChecks: [] } }).code).toBe(2)
  })

  test('a projectDir that does not exist is REFUSED', () => {
    const r = runJson(valid(), { args: { projectDir: join(tmpdir(), 'craft-no-such-dir-8b2a'), mechanicalChecks: [] } })
    expect(r.code).toBe(2)
  })

  test('a declared check the result reports no outcome for is REFUSED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(valid(), { args: declaring('true', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('m1')
  })

  test('a mechanicalChecks entry with no cmd is REFUSED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(0), { args: { projectDir: dir, mechanicalChecks: [{ name: 'm1' }] } })
    expect(r.code).toBe(2)
  })

  test('a non-integer claimed exitCode is REFUSED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson({ ...valid(), mechanical: [{ name: 'm1', output: '' }] }, { args: declaring('true', dir) })
    expect(r.code).toBe(2)
  })

  test('a result with no declared checks needs no re-run and still carries its verdict', () => {
    expect(runJson(valid()).code).toBe(0)
    expect(runJson({ ...valid(), overallPass: false, verdict: 'FAIL' }).code).toBe(1)
  })
})

/** A return whose `mechanical` array is empty while args.json still declares checks. */
const emptyMechanical = () => ({
  ...valid(),
  overallPass: false,
  verdict: 'FAIL',
  scoreTable: {
    ...valid().scoreTable,
    tasksJudgedThisRun: null,
    implementedDone: null,
    verifyPassed: null,
    lensesRun: null,
    lensesReported: null,
    lensFindings: null,
    refuted: null,
    survivingBlocking: null,
    survivingMinor: null,
    mechanicalRun: 0,
    mechanicalPassed: 0,
  },
  findings: [{ lens: 'scope-fidelity', severity: 'critical', what: 'out-of-scope edit' }],
  mechanical: [],
})

describe('craft-result.sh refuses a declared check that reports no outcome', () => {
  test('an empty mechanical array beside a claimed PASS can never launder it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson({ ...emptyMechanical(), overallPass: true, verdict: 'PASS' }, { args: declaring('true', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('m1')
  })

  test('a FAIL whose scoreTable shows the mechanical phase DID run is still refused for a missing outcome', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    // overallPass false and mechanical [], but the lens dimensions are real counts: a declared
    // check with no reported outcome is a defect, not a design.
    const r = runJson({ ...emptyMechanical(), scoreTable: valid().scoreTable }, { args: declaring('true', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('m1')
  })
})

/**
 * `exitCode: -1` is workflow.js's fail-closed sentinel for a probe that died or was skipped
 * (workflow.js:1013/1016): NO claim was made, so there is nothing to re-run against. That is a
 * legitimate FAIL, never a refusal — refusing would convert every dead-probe run into exit 2 and
 * lose the verdict the gate already computed correctly.
 */
describe('craft-result.sh treats a dead-probe sentinel as a FAIL, not a refusal', () => {
  test('a dead-probe exitCode -1 with overallPass false exits 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(-1, { overallPass: false, verdict: 'FAIL' }), { args: declaring('true', dir) })
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('FAIL')
  })

  test('a dead-probe check is not re-run — there is no claim to adjudicate against', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const marker = join(dir, 'ran')
    const r = runJson(claiming(-1, { overallPass: false, verdict: 'FAIL' }), {
      args: declaring(`touch ${marker}`, dir),
    })
    expect(r.code).toBe(1)
    expect(existsSync(marker)).toBe(false)
  })

  test('a dead probe whose command really fails is still a FAIL, not a refusal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(-1, { overallPass: false, verdict: 'FAIL' }), { args: declaring('exit 4', dir) })
    expect(r.code).toBe(1)
  })

  test('a dead probe beside overallPass true is REFUSED — the gate cannot pass a failed check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(-1), { args: declaring('true', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('m1')
    expect(r.stdout).toBe('')
  })

  test('a dead probe does not excuse the honest checks beside it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(
      {
        ...valid(),
        overallPass: false,
        verdict: 'FAIL',
        mechanical: [
          { name: 'dead', exitCode: -1, output: 'probe agent died or was skipped' },
          { name: 'liar', exitCode: 0, output: '' },
        ],
      },
      {
        args: {
          projectDir: dir,
          mechanicalChecks: [{ name: 'dead', cmd: 'true' }, { name: 'liar', cmd: 'exit 1' }],
        },
      },
    )
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('liar')
  })

  test('a negative claim other than -1 is not a sentinel and is adjudicated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    const r = runJson(claiming(-2, { overallPass: false, verdict: 'FAIL' }), { args: declaring('true', dir) })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/claims exitCode -2, the shell observed 0/)
  })
})

describe('craft-result.sh does not let a re-run consume the check list', () => {
  test('a check that reads stdin does not swallow the checks after it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-result-proj-'))
    scratch.push(dir)
    // `greedy` drains stdin. If the re-run inherits the loop's own feed, `liar` is never read and
    // its dishonest claim escapes — the loop ends early and the script exits 0.
    const r = runJson(
      {
        ...valid(),
        mechanical: [
          { name: 'greedy', exitCode: 0, output: '' },
          { name: 'liar', exitCode: 0, output: '' },
        ],
      },
      {
        args: {
          projectDir: dir,
          mechanicalChecks: [
            { name: 'greedy', cmd: 'cat >/dev/null' },
            { name: 'liar', cmd: 'exit 1' },
          ],
        },
      },
    )
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('liar')
  })
})
