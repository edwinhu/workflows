#!/usr/bin/env bun
/**
 * suite-lint-dispatch.test.ts — suite-lint as craft-dispatch.sh's TIER 3: it REPORTS, and it
 * never refuses.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/suite-lint-dispatch.test.ts
 *
 * The false-positive rate is unmeasured until the investigation report exists, and issue 134 is
 * explicit that a refusing gate wrong once costs a dispatch. So every test here that seeds a defect
 * asserts BOTH that the finding printed AND that the exit code and the written args.json are exactly
 * what a clean tree would have produced. A tier that changed the exit code would be a different
 * feature.
 *
 * Tier order is observable: a tier 2 refusal must happen BEFORE any suite-lint output, because a
 * dispatch that is already refused has nothing to report on.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const SCRIPT = `${import.meta.dir}/craft-dispatch.sh`
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

const R3 = 'existence-only-artifact'

function script(dir: string, name: string, body: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

/** A lint-CLEAN plan over a fixture repo, so the only thing a test can observe is tier 3. */
function fixture(opts: { redCommand?: string; suites?: Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'suite-lint-dispatch-'))
  scratch.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  script(dir, 'check.sh', 'echo "1 failed, 0 passed"\nexit 1')
  script(dir, 'mech.sh', 'echo "0 failed, 3 passed"\nexit 0')
  for (const [rel, body] of Object.entries(opts.suites ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  const plan = join(dir, 'plan.md')
  const args = {
    projectDir: dir,
    goal: 'make the thing correct',
    tasks: [{
      id: 'T1', name: 'one', work: 'do the thing', writablePaths: ['src/'], refs: [],
      redCommand: opts.redCommand ?? 'bash scripts/check.sh',
      acceptance: '`bash scripts/check.sh` exits 0',
    }],
    mechanicalChecks: [{ name: 'tests', cmd: 'bash scripts/mech.sh' }],
    reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
  }
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- craft:dispatch\n${JSON.stringify({ runId: 'probe-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, argsPath: join(dir, '.craft', 'probe-run', 'args.json') }
}

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

const EXISTENCE_ONLY = [
  "test('the run writes its report', () => {",
  '  runReport()',
  "  expect(existsSync('docs/report.md')).toBe(true)",
  '})',
].join('\n') + '\n'

const CLEAN = [
  "test('the run writes a report naming every rule', () => {",
  '  runReport()',
  "  expect(readFileSync('docs/report.md', 'utf8')).toContain('single-distinct-literal')",
  '})',
].join('\n') + '\n'

describe('tier 3 reports a seeded defect and dispatches anyway', () => {
  test('a suite with an existence-only assertion prints the finding AND still exits 0', () => {
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toContain(R3)
    expect(r.out).toContain('report.test.ts')
    expect(existsSync(f.argsPath)).toBe(true)
  })

  test('the finding does not change the args the run dispatches with', () => {
    const dirty = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const clean = fixture({ suites: { 'report.test.ts': CLEAN } })
    expect(dispatch(dirty).code).toBe(0)
    expect(dispatch(clean).code).toBe(0)
    const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
    const a = read(dirty.argsPath), b = read(clean.argsPath)
    for (const k of ['tasks', 'mechanicalChecks', 'reviewLenses', 'goal']) {
      expect(JSON.stringify(a[k])).toBe(JSON.stringify(b[k]))
    }
  })

  test('a clean tree prints no finding, so the tier is not printing a constant', () => {
    const r = dispatch(fixture({ suites: { 'report.test.ts': CLEAN } }))
    expect(r.code).toBe(0)
    expect(r.out).not.toContain(R3)
  })

  test('a tree carrying every rule at once is still exit 0 — no finding refuses', () => {
    const f = fixture({ suites: {
      'report.test.ts': EXISTENCE_ONLY,
      'hook.test.ts': [
        "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
        "test('the hook saves the plan', () => { expect(runHook()).toMatch(/saved/i) })",
      ].join('\n') + '\n',
      'budget.test.ts': [
        "test('zero disables', () => { expect(budgetFor(0).enabled).toBe(false) })",
        "test('budget enables', () => { expect(budgetFor(0).enabled).toBe(true) })",
      ].join('\n') + '\n',
      'runner.test.ts': [
        "test('the runner honours the timeout', () => {",
        "  const cfg = { CRAFT_ASSERT_TIMEOUT: '30' }",
        '  expect(run(cfg).ok).toBe(true)',
        '})',
      ].join('\n') + '\n',
    } })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(existsSync(f.argsPath)).toBe(true)
  })
})

describe('the skip flag twins the existing probe-skip flags', () => {
  test('--no-suite-lint suppresses the tier, and the dispatch is otherwise identical', () => {
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const r = dispatch(f, '--no-suite-lint')
    expect(r.code).toBe(0)
    expect(r.out).not.toContain(R3)
    expect(existsSync(f.argsPath)).toBe(true)
  })
})

describe('tier 3 runs after the tiers that can refuse', () => {
  test('a tier 2 could-not-run refusal happens first, so nothing is linted for a dispatch already refused', () => {
    const f = fixture({ redCommand: 'bash scripts/absent.sh', suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const r = dispatch(f)
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/could-not-run/)
    expect(r.out).not.toContain(R3)
  })
})

describe('the tier is BOUNDED and leaves nothing behind', () => {
  /** A fake `bun` that never returns in time, so the timeout is exercised without a slow fixture. */
  function slowBun(dir: string) {
    return script(dir, 'slow-bun.sh', 'sleep 30')
  }

  test('CRAFT_SUITE_LINT_TIMEOUT bounds the tier, and a timeout still exits 0', () => {
    // TIER 2 and TIER 2b each have a timeout (CRAFT_RED_PROBE_TIMEOUT, CRAFT_MECH_PROBE_TIMEOUT).
    // TIER 3 reads files it did not write and builds regexes out of them, so it needs its own — and
    // it must expire into a REPORT, never into a refusal.
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const bun = slowBun(f.dir)
    let r
    try {
      const stdout = execFileSync('bash', [SCRIPT, f.plan], {
        encoding: 'utf8', cwd: f.dir,
        env: { ...process.env, CRAFT_DISPATCH_DRYRUN: '1', CRAFT_SUITE_LINT_BUN: bun, CRAFT_SUITE_LINT_TIMEOUT: '2' },
        timeout: 60_000,
      })
      r = { code: 0, out: stdout }
    } catch (e: any) {
      r = { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
    }
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/suite-lint.*(timed out|timeout)/i)
    expect(existsSync(f.argsPath)).toBe(true)
  })

  test('the tier leaves no temp residue in TMPDIR', () => {
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const tmp = mkdtempSync(join(tmpdir(), 'suite-lint-tmp-'))
    scratch.push(tmp)
    const before = readdirSync(tmp)
    expect(before).toEqual([])
    const r = (() => {
      try {
        return { code: 0, out: execFileSync('bash', [SCRIPT, f.plan], {
          encoding: 'utf8', cwd: f.dir, env: { ...process.env, CRAFT_DISPATCH_DRYRUN: '1', TMPDIR: tmp },
        }) }
      } catch (e: any) { return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') } }
    })()
    expect(r.code).toBe(0)
    expect(r.out).toContain(R3)
    // Renaming an mktemp file to `$ts.ts` leaks the original name; every temp path this tier
    // creates has to be removed, whatever shape it took.
    expect(readdirSync(tmp)).toEqual([])
  })

  test('a temp path that cannot be created is REPORTED, not silently walked past', () => {
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const tmp = mkdtempSync(join(tmpdir(), 'suite-lint-ro-'))
    scratch.push(tmp)
    chmodSync(tmp, 0o500)
    const r = (() => {
      try {
        return { code: 0, out: execFileSync('bash', [SCRIPT, f.plan], {
          encoding: 'utf8', cwd: f.dir, env: { ...process.env, CRAFT_DISPATCH_DRYRUN: '1', TMPDIR: tmp },
        }) }
      } catch (e: any) { return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') } }
    })()
    chmodSync(tmp, 0o700)
    // The original defect: `mv` failed, its status was unchecked, and the script carried on writing
    // through whatever the path had become. Failing loudly and continuing the DISPATCH is correct;
    // continuing the TIER as though nothing happened is not.
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/suite-lint/i)
    expect(r.out).not.toContain(R3)
    expect(existsSync(f.argsPath)).toBe(true)
  })
})

describe('the tier inherits the corpus contract, rather than re-implementing the walk', () => {
  /**
   * Everything suite-lint-corpus.test.ts establishes — unparseable counted by name, nothing dropped
   * silently, deterministic root-relative output — is established about `lintCorpus`. If TIER 3
   * walks the tree itself, none of it holds on the path that runs at every dispatch, and the only
   * thing asserting the behaviour is a comment.
   */
  test('an unparseable suite is named on the DISPATCH path, not merely in corpus mode', () => {
    const f = fixture({ suites: {
      'broken.test.ts': "const unterminated = 'this quote never closes\ntest('x', () => {\n",
      'report.test.ts': EXISTENCE_ONLY,
    } })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/unparseable/i)
    expect(r.out).toContain('broken.test.ts')
  })

  test('a deeply nested suite is LINTED, not silently dropped by a private depth cap', () => {
    // The embedded walker returns on `depth > 12` without counting the file. A dropped file reports
    // zero findings, which is indistinguishable from a clean one — the exact conflation the plan
    // forbids ("a file that was never linted is not a clean file").
    const deep = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'].join('/')
    const f = fixture({ suites: { [`${deep}/report.test.ts`]: EXISTENCE_ONLY } })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    expect(r.out).toContain(R3)
    expect(r.out).toContain('report.test.ts')
  })

  test('the tier reports HOW MANY files it linted and how many it could not, not just findings', () => {
    // The depth regression is pinned only because the deep fixture happens to carry a finding, and
    // the unparseable case only because that file is named. A re-introduced exclusion that drops
    // FINDING-FREE files would pass both. The counts are what make a dropped file visible.
    const f = fixture({ suites: {
      'report.test.ts': EXISTENCE_ONLY,
      'clean.test.ts': CLEAN,
      'broken.test.ts': "const unterminated = 'this quote never closes\ntest('x', () => {\n",
    } })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    const m = /(\d+) suite\(s\) linted, (\d+) finding\(s\), (\d+) unparseable/.exec(r.out)
    expect(m).not.toBeNull()
    const corpus = execFileSync('bun', [join(import.meta.dir, 'suite-lint.ts'), '--corpus', f.dir],
      { encoding: 'utf8' })
    const summary = JSON.parse(corpus.slice(corpus.indexOf('{'), corpus.lastIndexOf('}') + 1))
    expect(`linted ${m![1]}`).toBe(`linted ${summary.filesLinted}`)
    expect(`unparseable ${m![3]}`).toBe(`unparseable ${summary.unparseable}`)
    expect(Number(m![1])).toBeGreaterThan(1)
  })

  test('the tier and the corpus mode agree on the same tree', () => {
    // Two walkers cannot disagree if there is one walker. Seeded so every rule has something to say.
    const f = fixture({ suites: {
      'report.test.ts': EXISTENCE_ONLY,
      'runner.test.ts': [
        "test('the runner honours the timeout', () => {",
        "  const cfg = { CRAFT_ASSERT_TIMEOUT: '30' }",
        '  expect(run(cfg).ok).toBe(true)',
        '})',
      ].join('\n') + '\n',
    } })
    const r = dispatch(f)
    expect(r.code).toBe(0)
    const printed = (r.out.match(/existence-only-artifact|injected-key-never-varied/g) ?? []).length
    const corpus = execFileSync('bun', [
      join(import.meta.dir, 'suite-lint.ts'), '--corpus', f.dir,
    ], { encoding: 'utf8' })
    const summary = JSON.parse(corpus.slice(corpus.indexOf('{'), corpus.lastIndexOf('}') + 1))
    const expected = summary.counts['existence-only-artifact'] + summary.counts['injected-key-never-varied']
    expect(`tier ${printed}`).toBe(`tier ${expected}`)
  })
})

describe('the --print and dryrun paths are unchanged', () => {
  test('--print still builds and stops, running no commands and printing no findings', () => {
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const r = dispatch(f, '--print')
    expect(r.code).toBe(0)
    expect(r.out).toContain('--print: nothing dispatched.')
    expect(r.out).not.toContain(R3)
    expect(existsSync(f.argsPath)).toBe(false)
  })

  test('the dryrun path still ends where it always ended, after the tier has reported', () => {
    const f = fixture({ suites: { 'report.test.ts': EXISTENCE_ONLY } })
    const r = dispatch(f)
    expect(r.out).toContain('CRAFT_DISPATCH_DRYRUN: lint passed, nothing dispatched.')
    expect(r.out).toContain(R3)
    expect(r.out.indexOf(R3)).toBeLessThan(r.out.indexOf('CRAFT_DISPATCH_DRYRUN'))
  })
})
