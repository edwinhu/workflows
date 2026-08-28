#!/usr/bin/env bun
/**
 * suite-lint.test.ts — the four decidable test-quality rules of issue 134, over JS/TS suites.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/suite-lint.test.ts
 *   (absolute or ./-prefixed — a bare relative path is read as a NAME FILTER and exits 1 having
 *   matched nothing, which is byte-identical to a real failure.)
 *
 * Every rule comes as a PAIR: the defective input reproducing its run-2 defect, and a correct
 * counterpart the rule must stay silent on. A rule that fires on both is not a rule.
 *
 * THE CONTRACT THIS SUITE PINS
 *
 *   RULE_IDS: readonly [
 *     'positive-match-failure-vocabulary',   // R1
 *     'single-distinct-literal',             // R2
 *     'existence-only-artifact',             // R3
 *     'injected-key-never-varied',           // R4
 *   ]
 *
 *   extract(path, source)      -> Extracted; THROWS on a source it cannot scan
 *   RULES                      -> readonly { id: RuleId, check(e: Extracted): Finding[] }[]
 *   lintSource(path, source)   -> Finding[]   (routes to a dialect extractor by file extension)
 *
 * `Finding` is plan-lint.ts's exported shape, reused rather than redeclared: { rule, severity,
 * where, message, evidence? }. `where` is `${file}:${line}` with a 1-indexed line, and `evidence`
 * carries the offending text — which is how a finding "names file, line, rule id and the offending
 * text" without growing a second Finding type in this repo.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

const mod = () => import('./suite-lint.ts')
const lint = async (path: string, src: string) => (await mod()).lintSource(path, src)
const ruleIds = async (path: string, src: string) => (await lint(path, src)).map((f: any) => f.rule)
const src = (...lines: string[]) => lines.join('\n') + '\n'

const R1 = 'positive-match-failure-vocabulary'
const R2 = 'single-distinct-literal'
const R3 = 'existence-only-artifact'
const R4 = 'injected-key-never-varied'

// ---------------------------------------------------------------- the contract itself

describe('the exported surface', () => {
  test('exactly the four decidable rules ship, and rule 5 does not', async () => {
    const { RULE_IDS, RULES } = await mod()
    expect([...RULE_IDS].sort()).toEqual([R3, R4, R1, R2].sort())
    expect(RULES.map((r: any) => r.id).sort()).toEqual([...RULE_IDS].sort())
  })

  test('the Finding shape is plan-lint\'s, so nothing here redeclares it', async () => {
    const { lint: planLint } = await import('./plan-lint.ts')
    // A plan that plan-lint really does report on. An empty plan yields NO findings, which is how
    // an earlier draft ended up comparing `ours` against `undefined` behind an `if` and certifying
    // nothing: the exact defect R3 and this file's own mutation check exist to catch.
    const planFindings = planLint({
      tasks: [{ id: 'T1', name: 't', work: 'do', writablePaths: ['src/'], acceptance: 'it works',
                redCommand: 'bash a.sh', dependsOn: [], refs: [] }],
      mechanicalChecks: [], reviewLenses: [], successCriteria: [],
      verification: [], testFirst: {}, source: 'json',
    } as any)
    expect(planFindings.length).toBeGreaterThan(0)
    const planFinding = planFindings[0]

    const ours = (await lint('a.test.ts', src(
      "test('the report exists', () => {",
      "  expect(existsSync('docs/out.md')).toBe(true)",
      '})',
    )))[0]
    expect(ours).toBeDefined()

    // Every key assert-lint emits is a key plan-lint also emits — a redeclared local type that
    // grew or renamed a field would fail here, which is what "reuse the shape" has to mean.
    const planKeys = new Set(planFindings.flatMap((f: any) => Object.keys(f)))
    expect(planKeys.has('evidence')).toBe(true)
    for (const key of Object.keys(ours)) expect([...planKeys]).toContain(key)
    for (const key of ['rule', 'severity', 'where', 'message']) {
      expect(Object.keys(ours)).toContain(key)
      expect(Object.keys(planFinding)).toContain(key)
    }
    expect(['critical', 'major', 'minor']).toContain(ours.severity)
    expect(['critical', 'major', 'minor']).toContain(planFinding.severity)
  })

  test('every finding names its file, its 1-indexed line, its rule id and the offending text', async () => {
    const found = await lint('suites/report.test.ts', src(
      '// line 1 is this comment',
      "test('the report exists', () => {",
      "  expect(existsSync('docs/out.md')).toBe(true)",
      '})',
    ))
    const f = found.find((x: any) => x.rule === R3)
    expect(f).toBeDefined()
    const [file, line] = String(f.where).split(':')
    expect(file).toBe('suites/report.test.ts')
    expect(Number(line)).toBe(3)
    expect(f.evidence).toContain('docs/out.md')
  })
})

// ---------------------------------------------------------------- R1

describe(`${R1} — a positive assertion whose pattern matches the failure string it meant to exclude`, () => {
  const defective = src(
    "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
    "test('the hook saves the plan', () => {",
    '  const out = runHook()',
    '  expect(out).toMatch(/saved/i)',
    '})',
  )
  const correct = src(
    "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
    "test('the hook saves the plan', () => {",
    '  const out = runHook()',
    '  expect(out).toMatch(/plan saved to disk/i)',
    '})',
  )

  test('fires: /saved/i matches "plan NOT SAVED to disk", so the failure branch passes the test', async () => {
    const found = await lint('hook.test.ts', defective)
    const f = found.find((x: any) => x.rule === R1)
    expect(f).toBeDefined()
    expect(f.where).toBe('hook.test.ts:4')
    expect(f.evidence).toMatch(/saved/i)
  })

  test('silent: a pattern that excludes the failure string is exactly what the rule wants', async () => {
    expect(await ruleIds('hook.test.ts', correct)).not.toContain(R1)
  })

  test('silent on a suite with no failure-vocabulary literal at all', async () => {
    expect(await ruleIds('hook.test.ts', src(
      "const OK = 'plan saved to disk'",
      "test('a', () => { expect(runHook()).toMatch(/saved/i) })",
    ))).not.toContain(R1)
  })
})

// ---------------------------------------------------------------- R2

describe(`${R2} — no input in the file distinguishes the two behaviours`, () => {
  const defective = src(
    "test('a zero budget disables the loop', () => {",
    '  expect(budgetFor(0).enabled).toBe(false)',
    '})',
    "test('a budget enables the loop', () => {",
    '  expect(budgetFor(0).enabled).toBe(true)',
    '})',
  )
  const correct = src(
    "test('a zero budget disables the loop', () => {",
    '  expect(budgetFor(0).enabled).toBe(false)',
    '})',
    "test('a budget enables the loop', () => {",
    '  expect(budgetFor(5).enabled).toBe(true)',
    '})',
  )

  test('fires: both cases pass the same 0, so neither can distinguish the other', async () => {
    const found = await lint('budget.test.ts', defective)
    const f = found.find((x: any) => x.rule === R2)
    expect(f).toBeDefined()
    expect(f.evidence).toContain('budgetFor')
    expect(Number(String(f.where).split(':')[1])).toBeGreaterThan(0)
  })

  test('silent: two distinct literals reach the call, which is what varying an input means', async () => {
    expect(await ruleIds('budget.test.ts', correct)).not.toContain(R2)
  })

  test('silent on a callee invoked once — one call is not a claim that two cases differ', async () => {
    expect(await ruleIds('budget.test.ts', src(
      "test('a zero budget disables the loop', () => {",
      '  expect(budgetFor(0).enabled).toBe(false)',
      '})',
    ))).not.toContain(R2)
  })
})

// ---------------------------------------------------------------- R3

describe(`${R3} — the only assertion about a produced artifact is that it exists`, () => {
  const defective = src(
    "test('the run writes its report', () => {",
    '  runReport()',
    "  expect(existsSync('docs/report.md')).toBe(true)",
    '})',
  )
  const correct = src(
    "test('the run writes a report naming every rule', () => {",
    '  runReport()',
    "  expect(existsSync('docs/report.md')).toBe(true)",
    "  expect(readFileSync('docs/report.md', 'utf8')).toContain('single-distinct-literal')",
    '})',
  )

  test('fires: `touch docs/report.md` satisfies this assertion, so it certifies nothing', async () => {
    const found = await lint('report.test.ts', defective)
    const f = found.find((x: any) => x.rule === R3)
    expect(f).toBeDefined()
    expect(f.evidence).toContain('docs/report.md')
    expect(f.where).toBe('report.test.ts:3')
  })

  test('silent: an assertion about the artifact\'s CONTENT is not satisfiable by touch', async () => {
    expect(await ruleIds('report.test.ts', correct)).not.toContain(R3)
  })
})

// ---------------------------------------------------------------- R3, scoped to what a task produces

describe(`${R3} scoped by artifactPaths — "an artifact THE TASK PRODUCES", not every existsSync`, () => {
  const suite = src(
    "test('the run writes its report', () => {",
    '  runReport()',
    "  expect(existsSync('docs/report.md')).toBe(true)",
    '})',
  )

  test('fires when the artifact is inside the task\'s declared paths', async () => {
    const { lintSource } = await mod()
    const found = lintSource('report.test.ts', suite, { artifactPaths: ['docs/'] })
    expect(found.map((f: any) => f.rule)).toContain(R3)
  })

  test('SILENT when the existence check is about a path no task produces', async () => {
    const { lintSource } = await mod()
    // Deleting the artifactPaths guard, or inverting it, makes this test fail — which is the only
    // thing separating R3 from "flag every existsSync in the repository".
    const found = lintSource('report.test.ts', suite, { artifactPaths: ['src/'] })
    expect(found.map((f: any) => f.rule)).not.toContain(R3)
  })

  test('an empty or absent context scopes nothing, so corpus mode still sees the defect', async () => {
    const { lintSource } = await mod()
    expect(lintSource('report.test.ts', suite, {}).map((f: any) => f.rule)).toContain(R3)
    expect(lintSource('report.test.ts', suite).map((f: any) => f.rule)).toContain(R3)
  })
})

// ---------------------------------------------------------------- the negation guard

describe('a NEGATED assertion is not a positive match, so R1 must not read it as one', () => {
  const failureLiteral = "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'"

  test('fires on the positive form', async () => {
    expect(await ruleIds('hook.test.ts', src(
      failureLiteral,
      "test('a', () => { expect(runHook()).toMatch(/saved/i) })",
    ))).toContain(R1)
  })

  test('SILENT on the same pattern behind `.not.` — the twin that pins the guard', async () => {
    // Same file, same pattern, same failure literal; only `.not.` differs. Deleting the negation
    // check makes this test fail, which is what makes it a test of the guard rather than of R1.
    expect(await ruleIds('hook.test.ts', src(
      failureLiteral,
      "test('a', () => { expect(runHook()).not.toMatch(/saved/i) })",
    ))).not.toContain(R1)
  })

  test('SILENT on `.not.toContain` too, not just toMatch', async () => {
    expect(await ruleIds('hook.test.ts', src(
      failureLiteral,
      "test('a', () => { expect(runHook()).not.toContain('SAVED') })",
    ))).not.toContain(R1)
  })
})

// ---------------------------------------------------------------- R4

describe(`${R4} — a config key is injected once and nothing ever varies it`, () => {
  const defective = src(
    "test('the runner honours the timeout', () => {",
    "  const cfg = { CRAFT_ASSERT_TIMEOUT: '30' }",
    '  expect(run(cfg).ok).toBe(true)',
    '})',
  )
  const correct = src(
    "test('a generous timeout completes', () => {",
    "  const cfg = { CRAFT_ASSERT_TIMEOUT: '30' }",
    '  expect(run(cfg).ok).toBe(true)',
    '})',
    "test('a zero timeout gives up', () => {",
    "  const cfg = { CRAFT_ASSERT_TIMEOUT: '0' }",
    '  expect(run(cfg).ok).toBe(false)',
    '})',
  )

  test('fires: the key appears in exactly one literal, so no test varies the config it injects', async () => {
    const found = await lint('runner.test.ts', defective)
    const f = found.find((x: any) => x.rule === R4)
    expect(f).toBeDefined()
    expect(f.evidence).toContain('CRAFT_ASSERT_TIMEOUT')
    expect(f.where).toBe('runner.test.ts:2')
  })

  test('silent: the key is injected twice with different values and different expected outcomes', async () => {
    expect(await ruleIds('runner.test.ts', correct)).not.toContain(R4)
  })
})

// ---------------------------------------------------------------- the catastrophic-pattern guard

describe('the guard that decides which attacker-authored patterns are safe to RUN', () => {
  test('it is exported, because its classification IS the security boundary', async () => {
    const { isCatastrophicPattern } = await mod()
    expect(typeof isCatastrophicPattern).toBe('function')
  })

  test('it refuses the nested-quantifier family', async () => {
    const { isCatastrophicPattern } = await mod()
    for (const p of ['(a+)+$', '(a*)*$', '^(a+)+b', '([a-z]+)+$']) {
      expect(`${p} -> ${isCatastrophicPattern(p)}`).toBe(`${p} -> true`)
    }
  })

  test('it refuses the OVERLAPPING-ALTERNATION family, which the first draft ran', async () => {
    // `(a|a)+` and `(a|aa)+` carry no quantifier inside the group, so a rule keyed on `([+*])…)[+*]`
    // never sees them, and they were evaluated against every failure literal in the file.
    const { isCatastrophicPattern } = await mod()
    for (const p of ['(a|a)+$', '(a|aa)+$', '(x|x)*y']) {
      expect(`${p} -> ${isCatastrophicPattern(p)}`).toBe(`${p} -> true`)
    }
  })

  test('it permits the ordinary patterns real suites are written with', async () => {
    // A guard that refuses everything protects nothing: it would silently disable R1 repo-wide.
    const { isCatastrophicPattern } = await mod()
    for (const p of ['saved', 'plan saved to disk', '^NOT ', '\\bok\\b', 'a+b*c', '[A-Z]{2,4}']) {
      expect(`${p} -> ${isCatastrophicPattern(p)}`).toBe(`${p} -> false`)
    }
  })

  test('a refused pattern yields no finding rather than being run', async () => {
    const found = await ruleIds('hook.test.ts', src(
      "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      "test('a', () => { expect(runHook()).toMatch(/(saved|saved)+/i) })",
    ))
    expect(found).not.toContain(R1)
  })
})

// ---------------------------------------------------------------- the guard is a BUDGET, not a blocklist

describe('a pattern the guard misses must still not stall the dispatch', () => {
  /**
   * VERIFIED 2026-08-27 against the delivered module: `((a+))+`, `(?:(a+))+`, `(a+){2,}`, `(a{1,})+`
   * and `(a|aa){3,}` all classify FALSE, because the nested-quantifier rule's `[^)]*` stops at the
   * first `)` and neither rule reads brace quantifiers. A 2.2 KB file of twenty such assertions
   * against twenty failure literals did not return in 60 seconds — on a path that runs at EVERY
   * craft dispatch, over files the repository did not write.
   *
   * Both halves are pinned here on purpose. Widening the guard alone would leave the next unlisted
   * shape free: a blocklist over an infinite grammar cannot be completed, so the cost has to be
   * bounded whatever the guard concludes.
   */
  const BYPASSES = ['((a+))+', '(?:(a+))+', '(a+){2,}', '(a{1,})+', '(a|aa){3,}']

  test('the guard recognises nested groups, non-capturing groups and brace quantifiers', async () => {
    const { isCatastrophicPattern } = await mod()
    for (const p of BYPASSES) expect(`${p} -> ${isCatastrophicPattern(p)}`).toBe(`${p} -> true`)
  })

  test('it still permits the ordinary patterns real suites use', async () => {
    const { isCatastrophicPattern } = await mod()
    for (const p of ['saved', 'a+b*c', '[A-Z]{2,4}', '\\bok\\b', '(foo|bar)']) {
      expect(`${p} -> ${isCatastrophicPattern(p)}`).toBe(`${p} -> false`)
    }
  })

  test('a repeated group is not condemned for CONTAINING a non-capturing group or lookahead', async () => {
    // The widening read the `?` of `(?:` and `(?=` as a quantifier on its atom, so any repeated
    // group whose body holds one was refused. Refusing ordinary patterns disables R1 quietly, which
    // is the same defect as failing open wearing a safer-looking hat.
    const { isCatastrophicPattern } = await mod()
    for (const p of ['(a(?:b))+', '(\\w+(?=x))+', '(?:foo|bar)+', '(a(?!b))+']) {
      expect(`${p} -> ${isCatastrophicPattern(p)}`).toBe(`${p} -> false`)
    }
  })

  test('the 200-character cutoff is pinned in both directions', async () => {
    const { isCatastrophicPattern } = await mod()
    expect(isCatastrophicPattern('x'.repeat(201))).toBe(true)
    expect(isCatastrophicPattern('x'.repeat(199))).toBe(false)
  })

  test('the stacked-character-class rule is pinned in both directions', async () => {
    const { isCatastrophicPattern } = await mod()
    expect(isCatastrophicPattern('[a-z]+[0-9]*[A-Z]+')).toBe(true)
    expect(isCatastrophicPattern('[a-z]+[0-9]*')).toBe(false)
  })

  test('the BUDGET is observable, because a silent decline is indistinguishable from a miss', async () => {
    // The first draft of this test built its bomb from `((a+))+$` — a shape in the BYPASSES list
    // above. Once the guard was widened it refused that pattern before any cost was computed, so
    // the test exercised the guard twice and the budget never once. A budget whose only effect is
    // the ABSENCE of a finding cannot be told apart from a pattern that simply did not match, so
    // the decision has to be exported the way `isCatastrophicPattern` is.
    const { isAffordablePair } = await mod()
    expect(typeof isAffordablePair).toBe('function')
  })

  test('an expensive pair the GUARD PERMITS is declined by the budget', async () => {
    const { isCatastrophicPattern, isAffordablePair } = await mod()
    // Guard-passing by construction: no group at all, so no repeated-group rule can see it.
    const p = 'a*a*a*a*a*!$'
    expect(isCatastrophicPattern(p)).toBe(false)
    expect(isAffordablePair(p, 4_000)).toBe(false)
  })

  test('ordinary work is affordable, so the budget does not starve R1', async () => {
    const { isAffordablePair } = await mod()
    for (const p of ['saved', 'plan saved to disk', '^NOT ', '[A-Z]{2,4}']) {
      expect(`${p} -> ${isAffordablePair(p, 200)}`).toBe(`${p} -> true`)
    }
  })

  test('an UNANCHORED pattern is priced for the start-position scan it actually performs', async () => {
    // `re.test` on an unanchored pattern retries at every start position, so one variable
    // quantifier costs Theta(n^2) while `n^q` prices it Theta(n). MEASURED through lintSource on
    // one pattern against one literal: n=50k 363ms, n=100k 1010ms, n=200k 4006ms, n=400k 16334ms —
    // each doubling quadruples, against a declared BUDGET_MS of 1500.
    //
    // An earlier measurement of mine put five patterns against one literal and read the result as
    // LINEAR. It was not: the file budget declined the later pairs, so the total stopped growing.
    // A silent decline is indistinguishable from cheap work, which is why the pair decision has to
    // be asked directly rather than inferred from a wall clock.
    const { isCatastrophicPattern, isAffordablePair } = await mod()
    expect(isCatastrophicPattern('a*b')).toBe(false)   // no group at all; the guard cannot help
    expect(isAffordablePair('a*b', 990_000)).toBe(false)
    expect(isAffordablePair('a*b', 400_000)).toBe(false)
  })

  test('the scan charge does not condemn ordinary literals', async () => {
    // Real failure literals are short. Pricing the scan must not make everyday work unaffordable.
    const { isAffordablePair } = await mod()
    for (const n of [80, 200, 1_000]) {
      expect(`a*b @ ${n} -> ${isAffordablePair('a*b', n)}`).toBe(`a*b @ ${n} -> true`)
    }
  })

  test('BUDGET, end to end: the unanchored bomb is bounded too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'suite-lint-scan-'))
    scratch.push(dir)
    writeFileSync(join(dir, 'scan.test.ts'),
      `test('t', () => { expect(x).toMatch(/a*b/) })\nconst s = 'fail ${'a'.repeat(400_000)}'\n`)
    const runner = join(dir, 'run.ts')
    writeFileSync(runner,
      `import { lintSource } from ${JSON.stringify(join(import.meta.dir, 'suite-lint.ts'))}\n` +
      `import { readFileSync } from 'node:fs'\n` +
      `lintSource('scan.test.ts', readFileSync(${JSON.stringify(join(dir, 'scan.test.ts'))}, 'utf8'))\n` +
      `console.log('done')\n`)
    try {
      expect(execFileSync('bun', [runner], { encoding: 'utf8', timeout: 10_000 })).toContain('done')
    } catch (e: any) {
      throw new Error('lintSource did not finish within 10s on one unanchored pattern against one ' +
        `400 KB literal (${e.signal ?? e.status}) — measured 16,334 ms undelivered, priced as affordable`)
    }
  }, 30_000)

  test('BUDGET, end to end: a guard-defeating file completes AND is bounded', () => {
    // Out of process: a regression here HANGS rather than fails, and a hung suite takes the whole
    // craft mechanical check with it. The child is killed at the bound and that is the failure.
    const dir = mkdtempSync(join(tmpdir(), 'suite-lint-bomb-'))
    scratch.push(dir)
    const lines: string[] = []
    for (let i = 0; i < 20; i++) lines.push(`const m${i} = 'not ${'a'.repeat(40)}!'`)
    for (let i = 0; i < 20; i++) lines.push(`test('t${i}', () => { expect(x).toMatch(/a*a*a*a*a*!$/) })`)
    writeFileSync(join(dir, 'bomb.test.ts'), lines.join('\n'))
    const runner = join(dir, 'run.ts')
    writeFileSync(runner,
      `import { lintSource } from ${JSON.stringify(join(import.meta.dir, 'suite-lint.ts'))}\n` +
      `import { readFileSync } from 'node:fs'\n` +
      `lintSource('bomb.test.ts', readFileSync(${JSON.stringify(join(dir, 'bomb.test.ts'))}, 'utf8'))\n` +
      `console.log('done')\n`)
    let out = ''
    try {
      out = execFileSync('bun', [runner], { encoding: 'utf8', timeout: 20_000 })
    } catch (e: any) {
      throw new Error(`lintSource did not finish within 20s on a 2.2 KB file (${e.signal ?? e.status}) — ` +
        'the pattern-by-literal loop has no budget')
    }
    expect(out).toContain('done')
  }, 40_000)

  test('the budget bounds the file WITHOUT dropping ordinary findings', async () => {
    // Asserting only elapsed time is worse than useless here: a budget that refuses MORE is always
    // FASTER, so lowering the cap would make a time-only test pass harder while silently deleting
    // every finding. The count is the half that can fail in the direction that matters.
    const { lintSource } = await mod()
    const lines: string[] = ["const F = 'plan NOT SAVED to disk'"]
    for (let i = 0; i < 400; i++) lines.push(`test('t${i}', () => { expect(x).toMatch(/saved/i) })`)
    const t = Date.now()
    const found = lintSource('many.test.ts', lines.join('\n'))
    expect(Date.now() - t).toBeLessThan(5_000)
    expect(found.filter((f: any) => f.rule === R1).length).toBe(400)
  })
})

// ---------------------------------------------------------------- R4's second injection form

describe(`${R4} counts \`process.env.KEY =\` as the same injection as \`{ KEY: … }\``, () => {
  // Both forms set one key. Deleting the env-assignment branch failed no test in either dialect,
  // so the rule's second half shipped unpinned.
  test('fires when the env key is assigned once and never varied', async () => {
    const found = await lint('runner.test.ts', src(
      "test('the runner honours the timeout', () => {",
      "  process.env.CRAFT_ASSERT_TIMEOUT = '30'",
      '  expect(run().ok).toBe(true)',
      '})',
    ))
    const f = found.find((x: any) => x.rule === R4)
    expect(f).toBeDefined()
    expect(f.evidence).toContain('CRAFT_ASSERT_TIMEOUT')
    expect(f.where).toBe('runner.test.ts:2')
  })

  test('silent when the same env key is assigned twice with different values', async () => {
    expect(await ruleIds('runner.test.ts', src(
      "test('a generous timeout completes', () => {",
      "  process.env.CRAFT_ASSERT_TIMEOUT = '30'",
      '  expect(run().ok).toBe(true)',
      '})',
      "test('a zero timeout gives up', () => {",
      "  process.env.CRAFT_ASSERT_TIMEOUT = '0'",
      '  expect(run().ok).toBe(false)',
      '})',
    ))).not.toContain(R4)
  })
})

// ---------------------------------------------------------------- the rules do not fire at large

describe('a correct suite is clean under all four rules at once', () => {
  test('no finding of any rule on a suite that varies its inputs and asserts on content', async () => {
    const found = await ruleIds('clean.test.ts', src(
      "const FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      "test('a generous timeout writes the report', () => {",
      "  const cfg = { CRAFT_ASSERT_TIMEOUT: '30' }",
      '  const out = runHook(cfg, 30)',
      '  expect(out).toMatch(/plan saved to disk/i)',
      "  expect(readFileSync('docs/report.md', 'utf8')).toContain('single-distinct-literal')",
      '})',
      "test('a zero timeout gives up and says so', () => {",
      "  const cfg = { CRAFT_ASSERT_TIMEOUT: '0' }",
      '  const out = runHook(cfg, 0)',
      '  expect(out).toContain(FAILURE_MESSAGE)',
      '})',
    ))
    expect(found).toEqual([])
  })
})
