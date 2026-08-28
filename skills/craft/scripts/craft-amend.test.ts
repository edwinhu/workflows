/**
 * craft-amend.sh decides whether a plan defect is MECHANICALLY fixable, and refuses to guess when
 * the fix would mean choosing scope.
 *
 * The narrow AUTO set is the whole point. Three of the four defect classes the brief named —
 * an acceptance clause naming no command, a redCommand that cannot go red, a writablePath that
 * denied a write — are fixed by AUTHORING a criterion or WIDENING a permission, and both are scope
 * decisions. An amender that invented those would launder a broken brief past the gate. So exactly
 * two plan-lint rules are auto-amendable, and everything else escalates:
 *
 *   work-accretion            collapse the work cell to its LATEST round marker (by REPLACEMENT,
 *                             which is what the doctrine already mandates for a round amendment)
 *   redcommand-relative-path  rewrite the relative gate path against projectDir
 *
 * Exit codes: 0 an AUTO set exists (and was applied under --apply), 7 something escalates,
 * 1 there are no blocking findings at all.
 *
 * Run: bun test /home/eh/projects/workflows/skills/craft/scripts/craft-amend.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = `${import.meta.dir}/craft-amend.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

/** plan-lint's own marker regex is /\bROUND \d+\b|\bRound \d+\s*[—–-]/g — two matches is the defect. */
const ROUND_MARKER = /\bROUND \d+\b|\bRound \d+\s*[—–-]/g

/**
 * A plan and the args.json derived from it, sharing one task table — which is the relationship
 * craft-dispatch.sh creates and the amender has to preserve when it rewrites the plan's block.
 */
function fixture(task: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-amend-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  const plan = join(dir, 'plan.md')
  const argsPath = join(dir, 'args.json')
  const args: Record<string, unknown> = {
    projectDir: dir,
    goal: 'make the thing correct',
    planPath: plan,
    mechanicalChecks: [],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
    tasks: [task],
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'amend-run', args }, null, 2)}\n-->\n`)
  writeFileSync(argsPath, JSON.stringify(args, null, 2))
  return { dir, plan, argsPath }
}

const CLEAN_TASK = {
  id: 'T1', name: 'one', work: 'Build the thing.', writablePaths: ['src/'], refs: [],
  redCommand: 'bash /abs/scripts/check.sh', acceptance: '`bash /abs/scripts/check.sh` exits 0',
}

/** A work cell carrying two round markers: plan-lint rule work-accretion, severity major. */
const ACCRETED_TASK = {
  ...CLEAN_TASK,
  work: 'ROUND 1 build the thing. ROUND 2 build the thing but handle the empty case too.',
}

/** No redCommand and no redDisposition: plan-lint rule redcommand-missing, severity major. */
const ESCALATING_TASK = {
  id: 'T1', name: 'one', work: 'Build the thing.', writablePaths: ['src/'], refs: [],
  acceptance: 'the thing works',
}

function amend(f: { plan: string; argsPath: string }, ...extra: string[]) {
  try {
    const out = execFileSync('bash', [SCRIPT, '--plan', f.plan, '--args', f.argsPath, ...extra], {
      encoding: 'utf8', timeout: 60_000,
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

/** The task table as it currently stands inside the plan's craft:dispatch block. */
function taskInPlan(plan: string): Record<string, any> {
  const src = readFileSync(plan, 'utf8')
  const m = /<!--\s*craft:dispatch\s*([\s\S]*?)-->/.exec(src)
  if (!m) throw new Error('plan lost its craft:dispatch block')
  return JSON.parse(m[1]).args.tasks[0]
}

describe('classification, without --apply', () => {
  test('an accreted work cell is AUTO and exits 0, naming the rule', () => {
    const f = fixture(ACCRETED_TASK)
    const r = amend(f)
    expect(r.code).toBe(0)
    expect(r.out).toContain('work-accretion')
    expect(r.out).toMatch(/AUTO/)
  })

  test('classification alone changes nothing on disk — the plan is byte-identical afterwards', () => {
    const f = fixture(ACCRETED_TASK)
    const before = readFileSync(f.plan, 'utf8')
    expect(amend(f).code).toBe(0)
    expect(readFileSync(f.plan, 'utf8')).toBe(before)
  })

  test('a defect whose fix means choosing SCOPE escalates with exit 7 and is never guessed at', () => {
    const f = fixture(ESCALATING_TASK)
    const r = amend(f)
    expect(r.code).toBe(7)
    expect(r.out).toMatch(/ESCALATE/)
    expect(r.out).toContain('redcommand-missing')
  })

  test('a plan with no blocking findings exits 1 — there is nothing to amend', () => {
    const f = fixture(CLEAN_TASK)
    expect(amend(f).code).toBe(1)
  })
})

describe('application, with --apply', () => {
  test('applying collapses the work cell to ONE round marker and prints a unified diff', () => {
    const f = fixture(ACCRETED_TASK)
    expect((ACCRETED_TASK.work.match(ROUND_MARKER) ?? []).length).toBe(2)
    const r = amend(f, '--apply')
    expect(r.code).toBe(0)
    const work: string = taskInPlan(f.plan).work
    expect((work.match(ROUND_MARKER) ?? []).length).toBe(1)
    // REPLACEMENT, not accretion: the superseded round-1 instruction must be gone, and the
    // surviving instruction must be the LATEST one.
    expect(work).toContain('empty case')
    expect(r.out).toMatch(/^--- /m)
    expect(r.out).toMatch(/^\+\+\+ /m)
  })

  test('the amended plan passes the rule it was amended for — an auto-edit cannot smuggle a broken brief through', () => {
    const f = fixture(ACCRETED_TASK)
    expect(amend(f, '--apply').code).toBe(0)
    // Re-derive args from the amended plan and re-lint: work-accretion must be gone.
    const block = JSON.parse(/<!--\s*craft:dispatch\s*([\s\S]*?)-->/.exec(readFileSync(f.plan, 'utf8'))![1])
    writeFileSync(f.argsPath, JSON.stringify(block.args, null, 2))
    let lintOut = ''
    try {
      lintOut = execFileSync('bun', [`${import.meta.dir}/plan-lint.ts`, f.argsPath, '--json'], { encoding: 'utf8' })
    } catch (e: any) { lintOut = e.stdout ?? '' }
    const findings = JSON.parse(lintOut).findings as { rule: string; severity: string }[]
    expect(findings.filter(x => x.rule === 'work-accretion')).toEqual([])
  })

  test('--apply on an escalating plan refuses with exit 7 and leaves the plan byte-identical', () => {
    const f = fixture(ESCALATING_TASK)
    const before = readFileSync(f.plan, 'utf8')
    const r = amend(f, '--apply')
    expect(r.code).toBe(7)
    expect(readFileSync(f.plan, 'utf8')).toBe(before)
  })

  test('the prose outside the dispatch block is never touched', () => {
    const f = fixture(ACCRETED_TASK)
    expect(amend(f, '--apply').code).toBe(0)
    const src = readFileSync(f.plan, 'utf8')
    expect(src.startsWith('# Plan\n\n## Run sizing\n\nnothing parked\n')).toBe(true)
  })
})

describe('the second AUTO rule — redcommand-relative-path', () => {
  /**
   * The AUTO set has exactly two rules and only one of them was exercised, so half the auto-amend
   * surface shipped unverified. A relative gate path is auto-fixable precisely because there is no
   * scope decision in it: the correct absolute path is projectDir + the relative path, computed,
   * not chosen.
   */
  const RELATIVE_TASK = {
    id: 'T1', name: 'one', work: 'Build the thing.', writablePaths: ['src/'], refs: [],
    redCommand: 'bash scripts/check.sh',
    acceptance: '`bash scripts/check.sh` exits 0',
  }

  /** The rule only fires when a mechanical check `cd`s to an absolute root, so the two disagree. */
  function relativeFixture() {
    const f = fixture(RELATIVE_TASK)
    const src = readFileSync(f.plan, 'utf8')
    const block = JSON.parse(/<!--\s*craft:dispatch\s*([\s\S]*?)-->/.exec(src)![1])
    block.args.mechanicalChecks = [{ name: 'tests', cmd: `cd ${f.dir} && bun test` }]
    writeFileSync(f.plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
      `<!-- craft:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
    writeFileSync(f.argsPath, JSON.stringify(block.args, null, 2))
    return f
  }

  test('a relative gate path beside an absolute-cd mechanical check is classified, not ignored', () => {
    const r = amend(relativeFixture())
    // Either it is AUTO (exit 0) — never ESCALATE, and never "nothing to amend".
    expect(r.code).toBe(0)
    expect(r.out).toContain('redcommand-relative-path')
  })

  test('applying rewrites the gate path against projectDir and leaves it a single invocation', () => {
    const f = relativeFixture()
    expect(amend(f, '--apply').code).toBe(0)
    const rc: string = taskInPlan(f.plan).redCommand
    expect(rc).toContain(f.dir)
    expect(rc).not.toMatch(/(^|\s)scripts\/check\.sh/)   // no surviving relative spelling
    // craft refuses every shell operator in a redCommand at arg-validation, so the rewrite must
    // not have introduced one.
    expect(rc).not.toMatch(/[;&|`$><(){}\n]/)
  })
})

describe('argument handling', () => {
  test('a missing plan or args file is refused with exit 2, never treated as "nothing to amend"', () => {
    const f = fixture(CLEAN_TASK)
    for (const args of [
      ['--plan', join(f.plan, 'absent.md'), '--args', f.argsPath],
      ['--plan', f.plan, '--args', join(f.argsPath, 'absent.json')],
    ]) {
      let code = 0
      try {
        execFileSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000 })
      } catch (e: any) { code = e.status ?? -1 }
      expect(code).toBe(2)
    }
  })
})
