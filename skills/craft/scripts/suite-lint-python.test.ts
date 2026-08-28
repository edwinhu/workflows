#!/usr/bin/env bun
/**
 * suite-lint-python.test.ts — the same four rules, over Python suites.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/suite-lint-python.test.ts
 *
 * Six of this repo's fourteen Python suites import Python modules directly. They are linted where
 * they are and never ported: dropping a suite from a module boundary to a CLI boundary to suit a
 * linter is the "Exercise the Real Thing" violation the vendored writing-good-tests.md names.
 *
 * ONLY EXTRACTION IS DIALECT-SPECIFIC. The rules are shared, and this suite proves it behaviourally
 * rather than by grepping the source: `lintSource` on a .py file must equal RULES applied to
 * `extract()`'d Python facts, so a second Python-only copy of a rule has nowhere to be reached from.
 *
 * Python idioms the extractor must see: bare `assert`, `pytest.raises`, the unittest assert methods
 * (assertEqual / assertTrue / assertIn), and `os.path.exists` as R3's existence form.
 */
import { describe, expect, test } from 'bun:test'

const mod = () => import('./suite-lint.ts')
const lint = async (path: string, src: string) => (await mod()).lintSource(path, src)
const ruleIds = async (path: string, src: string) => (await lint(path, src)).map((f: any) => f.rule)
const src = (...lines: string[]) => lines.join('\n') + '\n'

const R1 = 'positive-match-failure-vocabulary'
const R2 = 'single-distinct-literal'
const R3 = 'existence-only-artifact'
const R4 = 'injected-key-never-varied'

// ---------------------------------------------------------------- sharing, proved by behaviour

describe('the four rules are shared; only extraction is dialect-specific', () => {
  test('lintSource on a .py file is exactly RULES applied to the extracted Python facts', async () => {
    const { lintSource, RULES, extract } = await mod()
    const path = 'test_report.py'
    const source = src(
      'def test_the_run_writes_its_report():',
      '    run_report()',
      "    assert os.path.exists('docs/report.md')",
    )
    const viaLint = lintSource(path, source)
    const viaRules = RULES.flatMap((r: any) => r.check(extract(path, source)))
    expect(viaLint.length).toBeGreaterThan(0)
    expect(JSON.stringify(viaLint)).toBe(JSON.stringify(viaRules))
  })

  test('one rule function serves both dialects: the same defect yields the same rule and evidence', async () => {
    const ts = (await lint('report.test.ts', src(
      "test('the run writes its report', () => {",
      "  expect(existsSync('docs/report.md')).toBe(true)",
      '})',
    ))).find((f: any) => f.rule === R3)
    const py = (await lint('test_report.py', src(
      'def test_the_run_writes_its_report():',
      "    assert os.path.exists('docs/report.md')",
    ))).find((f: any) => f.rule === R3)
    expect(ts).toBeDefined()
    expect(py).toBeDefined()
    expect(py.message).toBe(ts.message)
    expect(py.severity).toBe(ts.severity)
    expect(py.evidence).toContain('docs/report.md')
  })

  test('the Python path invents no rule id of its own', async () => {
    const { RULE_IDS } = await mod()
    const found = await ruleIds('test_everything.py', src(
      "FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      'def test_saved():',
      '    assert re.search(r"saved", run_hook(), re.I)',
      'def test_zero():',
      '    assert budget_for(0).enabled is False',
      'def test_also_zero():',
      '    assert budget_for(0).enabled is True',
      'def test_report():',
      "    assert os.path.exists('docs/report.md')",
      'def test_cfg():',
      "    cfg = {'CRAFT_ASSERT_TIMEOUT': '30'}",
      '    assert run(cfg).ok',
    ))
    expect(found.length).toBeGreaterThan(0)
    for (const id of found) expect([...RULE_IDS]).toContain(id)
  })
})

// ---------------------------------------------------------------- R1

describe(`${R1}, Python`, () => {
  test('fires: re.search(r"saved") matches the module\'s own "NOT SAVED" failure string', async () => {
    const found = await lint('test_hook.py', src(
      "FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      'def test_the_hook_saves_the_plan():',
      '    out = run_hook()',
      '    assert re.search(r"saved", out, re.I)',
    ))
    const f = found.find((x: any) => x.rule === R1)
    expect(f).toBeDefined()
    expect(f.where).toBe('test_hook.py:4')
    expect(f.evidence).toMatch(/saved/i)
  })

  test('silent: a pattern that excludes the failure string', async () => {
    expect(await ruleIds('test_hook.py', src(
      "FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      'def test_the_hook_saves_the_plan():',
      '    assert re.search(r"plan saved to disk", run_hook(), re.I)',
    ))).not.toContain(R1)
  })

  test('fires through the unittest form too: assertIn of a substring the failure string contains', async () => {
    const found = await ruleIds('test_hook.py', src(
      'class T(unittest.TestCase):',
      "    FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      '    def test_saved(self):',
      "        self.assertIn('SAVED', run_hook())",
    ))
    expect(found).toContain(R1)
  })
})

// ---------------------------------------------------------------- R2

describe(`${R2}, Python`, () => {
  test('fires: both cases pass the same 0', async () => {
    const found = await lint('test_budget.py', src(
      'def test_a_zero_budget_disables_the_loop():',
      '    assert budget_for(0).enabled is False',
      'def test_a_budget_enables_the_loop():',
      '    assert budget_for(0).enabled is True',
    ))
    const f = found.find((x: any) => x.rule === R2)
    expect(f).toBeDefined()
    expect(f.evidence).toContain('budget_for')
  })

  test('silent: two distinct literals reach the call', async () => {
    expect(await ruleIds('test_budget.py', src(
      'def test_a_zero_budget_disables_the_loop():',
      '    assert budget_for(0).enabled is False',
      'def test_a_budget_enables_the_loop():',
      '    assert budget_for(5).enabled is True',
    ))).not.toContain(R2)
  })

  test('silent when the second call is inside a pytest.raises block with a different literal', async () => {
    expect(await ruleIds('test_budget.py', src(
      'def test_a_zero_budget_disables_the_loop():',
      '    assert budget_for(0).enabled is False',
      'def test_a_negative_budget_is_refused():',
      '    with pytest.raises(ValueError):',
      '        budget_for(-1)',
    ))).not.toContain(R2)
  })
})

// ---------------------------------------------------------------- R3

describe(`${R3}, Python`, () => {
  test('fires: os.path.exists is the only assertion about the produced artifact', async () => {
    const found = await lint('test_report.py', src(
      'def test_the_run_writes_its_report():',
      '    run_report()',
      "    assert os.path.exists('docs/report.md')",
    ))
    const f = found.find((x: any) => x.rule === R3)
    expect(f).toBeDefined()
    expect(f.where).toBe('test_report.py:3')
    expect(f.evidence).toContain('docs/report.md')
  })

  test('silent: a content assertion about the same artifact, in the unittest dialect', async () => {
    expect(await ruleIds('test_report.py', src(
      'class T(unittest.TestCase):',
      '    def test_the_run_writes_its_report(self):',
      '        run_report()',
      "        self.assertTrue(os.path.exists('docs/report.md'))",
      "        self.assertIn('single-distinct-literal', open('docs/report.md').read())",
    ))).not.toContain(R3)
  })
})

// ---------------------------------------------------------------- R4

describe(`${R4}, Python`, () => {
  test('fires: the injected key appears in exactly one literal', async () => {
    const found = await lint('test_runner.py', src(
      'def test_the_runner_honours_the_timeout():',
      "    cfg = {'CRAFT_ASSERT_TIMEOUT': '30'}",
      '    assert run(cfg).ok',
    ))
    const f = found.find((x: any) => x.rule === R4)
    expect(f).toBeDefined()
    expect(f.where).toBe('test_runner.py:2')
    expect(f.evidence).toContain('CRAFT_ASSERT_TIMEOUT')
  })

  test('silent: the key is injected twice with different values and different expected outcomes', async () => {
    expect(await ruleIds('test_runner.py', src(
      'def test_a_generous_timeout_completes():',
      "    cfg = {'CRAFT_ASSERT_TIMEOUT': '30'}",
      '    assert run(cfg).ok',
      'def test_a_zero_timeout_gives_up():',
      "    cfg = {'CRAFT_ASSERT_TIMEOUT': '0'}",
      '    assert not run(cfg).ok',
    ))).not.toContain(R4)
  })
})

// ---------------------------------------------------------------- the four named idioms

describe('the extractor sees every Python idiom T2 names', () => {
  const seen = async (source: string) => {
    const { extract } = await mod()
    return extract('test_idioms.py', source).calls
  }

  test('pytest.raises is a call site the extractor reports', async () => {
    // Named in T2's work item alongside the others. Nothing else in this suite distinguishes an
    // extractor that handles it from one that has never heard of it: the R2 fixture below it stays
    // silent because 0 and -1 are two distinct literals, which is the plain case tested above.
    const calls = await seen(src(
      'def test_a_negative_budget_is_refused():',
      '    with pytest.raises(ValueError):',
      '        budget_for(-1)',
    ))
    const raises = calls.find((c: any) => c.name === 'raises')
    expect(raises).toBeDefined()
    expect(raises.callee).toContain('pytest.raises')
    expect(raises.line).toBe(2)
  })

  test('the unittest assert methods are call sites', async () => {
    const calls = await seen(src(
      'class T(unittest.TestCase):',
      '    def test_x(self):',
      "        self.assertEqual(budget_for(0).cap, 0)",
      "        self.assertTrue(os.path.exists('docs/report.md'))",
      "        self.assertIn('rule', open('docs/report.md').read())",
    ))
    const names = calls.map((c: any) => c.name)
    for (const n of ['assertEqual', 'assertTrue', 'assertIn', 'exists']) expect(names).toContain(n)
  })

  test('os.path.exists keeps its dotted callee, which is how R3 recognises the existence form', async () => {
    const calls = await seen(src(
      'def test_x():',
      "    assert os.path.exists('docs/report.md')",
    ))
    const ex = calls.find((c: any) => c.name === 'exists')
    expect(ex).toBeDefined()
    expect(ex.callee).toBe('os.path.exists')
    expect(ex.args[0].value).toBe('docs/report.md')
  })

  test('a bare assert carries its call sites through — the plainest Python form of all', async () => {
    const calls = await seen(src(
      'def test_x():',
      '    assert budget_for(0).enabled is False',
    ))
    expect(calls.map((c: any) => c.name)).toContain('budget_for')
  })
})

// ---------------------------------------------------------------- the negation guard, Python

describe('a negated Python assertion is not a positive match', () => {
  const failure = "FAILURE_MESSAGE = 'plan NOT SAVED to disk'"

  test('fires on the positive unittest form', async () => {
    expect(await ruleIds('test_hook.py', src(
      'class T(unittest.TestCase):',
      `    ${failure}`,
      '    def test_saved(self):',
      "        self.assertIn('SAVED', run_hook())",
    ))).toContain(R1)
  })

  test('SILENT on assertNotIn — same needle, same failure literal, only the negation differs', async () => {
    expect(await ruleIds('test_hook.py', src(
      'class T(unittest.TestCase):',
      `    ${failure}`,
      '    def test_not_saved(self):',
      "        self.assertNotIn('SAVED', run_hook())",
    ))).not.toContain(R1)
  })

  test('SILENT on assertFalse of a search', async () => {
    expect(await ruleIds('test_hook.py', src(
      'class T(unittest.TestCase):',
      `    ${failure}`,
      '    def test_not_saved(self):',
      '        self.assertFalse(re.search(r"saved", run_hook(), re.I))',
    ))).not.toContain(R1)
  })
})

// ---------------------------------------------------------------- clean Python suite

describe('a correct Python suite is clean under all four rules at once', () => {
  test('no finding of any rule', async () => {
    expect(await ruleIds('test_clean.py', src(
      "FAILURE_MESSAGE = 'plan NOT SAVED to disk'",
      'def test_a_generous_timeout_writes_the_report():',
      "    cfg = {'CRAFT_ASSERT_TIMEOUT': '30'}",
      '    out = run_hook(cfg, 30)',
      '    assert re.search(r"plan saved to disk", out, re.I)',
      "    assert 'single-distinct-literal' in open('docs/report.md').read()",
      'def test_a_zero_timeout_gives_up_and_says_so():',
      "    cfg = {'CRAFT_ASSERT_TIMEOUT': '0'}",
      '    out = run_hook(cfg, 0)',
      '    assert FAILURE_MESSAGE in out',
    ))).toEqual([])
  })
})
