#!/usr/bin/env bun
/**
 * plan-lint.test.ts — every TIER 1 rule, pinned to a minimal plan that exhibits it and one that
 * does not.
 *
 *   bun test ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/plan-lint.test.ts
 *   (absolute or ./-prefixed — a bare relative path is read as a NAME FILTER and exits 1 having
 *   matched nothing, which is byte-identical to a real failure.)
 *
 * A rule that cannot be stated as "these inputs, that verdict, no judgement" does not belong in
 * tier 1. If a test here needs a repo to pass, the rule is tier 2 and is in the wrong file.
 */
import { test, expect } from 'bun:test'
import { lint, parseArgs, parseMarkdown, type Plan } from './plan-lint.ts'

const base = (over: Partial<Plan> = {}): Plan => ({
  tasks: [],
  mechanicalChecks: [],
  reviewLenses: [],
  successCriteria: [],
  verification: [],
  testFirst: {},
  source: 'json',
  ...over,
})

const task = (over: Partial<Plan['tasks'][0]> = {}) => ({
  id: 'T1',
  name: 'task',
  work: 'do the thing',
  writablePaths: ['src/'],
  acceptance: '`bash scripts/check.sh` exits 0',
  redCommand: 'bash scripts/check.sh',
  dependsOn: [],
  refs: [],
  ...over,
})

const rules = (p: Plan) => lint(p).map(f => f.rule)

// ---------------------------------------------------------------- scaffoldPaths

// scaffoldPaths is a hole in the write guard: it lets the main thread author a path a task also
// owns, which is the only way a stub can exist before wave 1. A scaffold as wide as the task is
// that hole with a declaration wrapped round it.
test('a scaffold naming one stub inside a wider writable surface is fine', () => {
  const p = base({ tasks: [task({ writablePaths: ['src/'] })], scaffoldPaths: ['src/stub.py'] })
  expect(rules(p)).not.toContain('scaffold-swallows-task')
})

test("a scaffold covering the task's whole writable surface is a blanket disarm", () => {
  const p = base({ tasks: [task({ writablePaths: ['src/'] })], scaffoldPaths: ['src/'] })
  expect(rules(p)).toContain('scaffold-swallows-task')
  expect(lint(p).find(f => f.rule === 'scaffold-swallows-task')!.severity).toBe('major')
})

test('a plan declaring no scaffoldPaths fires nothing', () => {
  expect(rules(base({ tasks: [task()] }))).not.toContain('scaffold-swallows-task')
})

test('parseArgs carries scaffoldPaths through from the dispatch block', () => {
  expect(parseArgs({ tasks: [], scaffoldPaths: ['a/b.py', 7] }).scaffoldPaths).toEqual(['a/b.py'])
})

// ---------------------------------------------------------------- acceptance clauses

test('acceptance clause with no command is flagged', () => {
  const p = base({ tasks: [task({ acceptance: 'the usage text documents the flag' })] })
  expect(rules(p)).toContain('acceptance-clause-uncommanded')
})

test('acceptance clause naming a bare script path counts as commanded', () => {
  const p = base({ tasks: [task({ acceptance: '`scripts/assert-x.sh` exits 0' })] })
  expect(rules(p)).not.toContain('acceptance-clause-uncommanded')
})

test('each uncommanded clause is reported separately', () => {
  const p = base({
    tasks: [task({ acceptance: 'usage text documents it; the banner is renamed; `bun test` passes' })],
  })
  expect(rules(p).filter(r => r === 'acceptance-clause-uncommanded')).toHaveLength(2)
})

// ---------------------------------------------------------------- red gates

test('missing redCommand is flagged', () => {
  expect(rules(base({ tasks: [task({ redCommand: null })] }))).toContain('redcommand-missing')
})

test('existence-only redCommand is flagged — satisfiable by touch', () => {
  for (const rc of ['test -x scripts/a.sh', 'ls scripts/a.sh scripts/b.sh', 'stat scripts/a.sh'])
    expect(rules(base({ tasks: [task({ redCommand: rc })] }))).toContain('redcommand-existence-only')
})

test('a behavioural redCommand is not flagged as existence-only', () => {
  const p = base({ tasks: [task({ redCommand: 'bash scripts/assert-x.sh' })] })
  expect(rules(p)).not.toContain('redcommand-existence-only')
})

test('shell operators outside a bash -c wrapper are flagged', () => {
  const p = base({ tasks: [task({ redCommand: 'bun test && bunx tsc --noEmit' })] })
  expect(rules(p)).toContain('gate-shell-operator')
})

test('a bash -c wrapper is NOT an exemption — workflow.js refuses the operator either way', () => {
  const p = base({ tasks: [task({ redCommand: "bash -c 'cd /r && bun test'" })] })
  expect(rules(p)).toContain('gate-shell-operator')
})

test('every character workflow.js rejects is flagged, so tier 1 and arg-validation agree', () => {
  for (const rc of [
    'bun test; true', 'bun test & true', 'bun test | cat', 'bun test `x`', 'bun test $X',
    'bun test > /tmp/o', 'bun test < /tmp/i', 'bun test (x)', 'bun test {x}', 'bun test\ntrue',
  ])
    expect(rules(base({ tasks: [task({ redCommand: rc })] }))).toContain('gate-shell-operator')
})

test('relative gate path is flagged only when mechanical checks cd absolute', () => {
  const t = [task({ redCommand: 'bash scripts/a.sh' })]
  expect(rules(base({ tasks: t }))).not.toContain('redcommand-relative-path')
  const withCd = base({ tasks: t, mechanicalChecks: [{ name: 'm', cmd: "bash -c 'cd /repo && bun test'" }] })
  expect(rules(withCd)).toContain('redcommand-relative-path')
})

// ---------------------------------------------------------------- task graph

test('a task that gates on an assertion script it writes is self-gating', () => {
  const p = base({
    tasks: [
      task({
        id: 'A',
        work: 'create `scripts/assert-x.sh`',
        writablePaths: ['scripts/'],
        redCommand: 'bash scripts/assert-x.sh',
      }),
    ],
  })
  expect(rules(p)).toContain('self-gating-task')
})

test('running source the task itself wrote is NOT self-gating — that is the point of a red gate', () => {
  const p = base({
    tasks: [task({ work: 'new `src/cli.ts`', writablePaths: ['src/'], redCommand: 'bun run src/cli.ts providers' })],
  })
  expect(rules(p)).not.toContain('self-gating-task')
})

test('a gate on another task’s artifact with no dependsOn edge is flagged', () => {
  const p = base({
    tasks: [
      task({ id: 'A', work: 'create `scripts/assert-x.sh`', writablePaths: ['scripts/'], redCommand: 'true' }),
      task({ id: 'B', redCommand: 'bash scripts/assert-x.sh', acceptance: '`bash scripts/assert-x.sh` exits 0' }),
    ],
  })
  expect(rules(p)).toContain('dependson-missing')
})

test('declaring the dependsOn edge clears it', () => {
  const p = base({
    tasks: [
      task({ id: 'A', work: 'create `scripts/assert-x.sh`', writablePaths: ['scripts/'], redCommand: 'true' }),
      task({ id: 'B', dependsOn: ['A'], redCommand: 'bash scripts/assert-x.sh', acceptance: '`bash scripts/assert-x.sh` exits 0' }),
    ],
  })
  expect(rules(p)).not.toContain('dependson-missing')
})

test('unordered tasks writing overlapping paths are flagged', () => {
  const p = base({
    tasks: [task({ id: 'A', writablePaths: ['src/'] }), task({ id: 'B', writablePaths: ['src/cli.ts'] })],
  })
  expect(rules(p)).toContain('writable-paths-overlap')
})

test('a dependsOn chain makes overlapping paths legal — they cannot share a wave', () => {
  const p = base({
    tasks: [
      task({ id: 'A', writablePaths: ['src/'] }),
      task({ id: 'B', writablePaths: ['src/cli.ts'], dependsOn: ['A'] }),
    ],
  })
  expect(rules(p)).not.toContain('writable-paths-overlap')
})

test('transitive ordering counts as ordering', () => {
  const p = base({
    tasks: [
      task({ id: 'A', writablePaths: ['src/'] }),
      task({ id: 'B', writablePaths: ['lib/'], dependsOn: ['A'] }),
      task({ id: 'C', writablePaths: ['src/cli.ts'], dependsOn: ['B'] }),
    ],
  })
  expect(rules(p)).not.toContain('writable-paths-overlap')
})

// ---------------------------------------------------------------- lenses

test('a review lens with no severity is decorative and is flagged', () => {
  const p = base({ tasks: [task()], reviewLenses: [{ key: 'k', text: 'judge whether the thing is right' }] })
  expect(rules(p)).toContain('lens-missing-severity')
})

test('a review lens stating a severity is clean', () => {
  const p = base({ tasks: [task()], reviewLenses: [{ key: 'k', text: 'judge it. MAJOR; CRITICAL if X' }] })
  expect(rules(p)).not.toContain('lens-missing-severity')
})

test('a review lens stating its severity in the schema\'s own lowercase is clean', () => {
  const p = base({ tasks: [task()], reviewLenses: [{ key: 'k', text: 'judge it. `major` at minimum, `critical` where X' }] })
  expect(rules(p)).not.toContain('lens-missing-severity')
})

// ---------------------------------------------------------------- document-level

test('a success criterion naming an artifact no task touches is flagged', () => {
  const p = base({ tasks: [task()], successCriteria: ['the live map `uidmap.ts` is still opened'] })
  expect(rules(p)).toContain('criterion-unmapped')
})

test('a stated count that disagrees with the enumeration is flagged', () => {
  const p = base({
    tasks: [task()],
    verification: ['All four B0 scripts — `a.sh`, `b.sh`, `c.sh`, `d.sh`, `e.sh`'],
  })
  expect(rules(p)).toContain('count-mismatch')
})

test('a trailing "plus" addition does not count against the stated number', () => {
  const p = base({
    tasks: [task()],
    verification: ['All four B0 scripts — `a.sh`, `b.sh`, `c.sh`, `d.sh` — plus `extra.sh`'],
  })
  expect(rules(p)).not.toContain('count-mismatch')
})

test('table and Test-first block declaring different gates is flagged', () => {
  const p = base({ tasks: [task({ id: 'T1', redCommand: 'bash scripts/a.sh' })], testFirst: { T1: 'bash scripts/b.sh' } })
  expect(rules(p)).toContain('redcommand-disagreement')
})

test('an elided Test-first entry is not compared', () => {
  const p = base({ tasks: [task({ id: 'T1', redCommand: 'ls a.sh b.sh c.sh' })], testFirst: { T1: 'ls a.sh …' } })
  expect(rules(p)).not.toContain('redcommand-disagreement')
})

// ---------------------------------------------------------------- parsing

test('markdown table cells keep escaped pipes inside code spans', () => {
  const md = [
    '| id | name | work | writable paths | acceptance | redCommand | refs | dependsOn |',
    '|---|---|---|---|---|---|---|---|',
    '| B1 | seam | add `x(t: string \\| null)` | `src/` | `bun test` passes | `bun test` | `[]` | B0 |',
  ].join('\n')
  const p = parseMarkdown(md)
  expect(p.tasks).toHaveLength(1)
  expect(p.tasks[0].work).toContain('string | null')
  expect(p.tasks[0].dependsOn).toEqual(['B0'])
})

test('a craft args object parses to the same model as a plan file', () => {
  const p = parseArgs({
    tasks: [{ id: 'A', work: 'w', writablePaths: ['src/'], acceptance: 'a', redCommand: 'bun test' }],
    mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
    reviewLenses: [{ key: 'k', prompt: 'p' }],
  })
  expect(p.tasks[0].id).toBe('A')
  expect(p.tasks[0].dependsOn).toEqual([])
  expect(p.mechanicalChecks[0].name).toBe('tests')
})

test('a clean plan produces no findings at all', () => {
  const p = base({
    tasks: [
      task({ id: 'A', work: 'create `scripts/assert-x.sh`', writablePaths: ['scripts/'], acceptance: '`bun test tests/scaffold.test.ts` passes', redCommand: 'bun test tests/scaffold.test.ts' }),
      task({ id: 'B', dependsOn: ['A'], writablePaths: ['src/'], acceptance: '`bash scripts/assert-x.sh` exits 0', redCommand: 'bash scripts/assert-x.sh' }),
    ],
    reviewLenses: [{ key: 'k', text: 'a condition. MAJOR' }],
  })
  expect(lint(p)).toEqual([])
})

// ---------------------------------------------------------------- FP fixes (measured 2026-08-13)

test('a clause a mechanical check already runs is not "uncommanded"', () => {
  const p = base({
    tasks: [task({ acceptance: 'all pre-existing tests pass' })],
    mechanicalChecks: [{ name: 'tests', cmd: "bash -c 'cd /r && bun test'" }],
  })
  expect(rules(p)).not.toContain('acceptance-clause-uncommanded')
})

test('the same clause IS flagged when no mechanical check covers it', () => {
  const p = base({ tasks: [task({ acceptance: 'all pre-existing tests pass' })] })
  expect(rules(p)).toContain('acceptance-clause-uncommanded')
})

test('multi-sentence acceptance splits on sentences — a mid-sentence `;` is punctuation', () => {
  const p = base({
    tasks: [
      task({
        acceptance:
          'All five exist and `bash -n` passes on each. `bash scripts/a.sh` exits 0 at HEAD; the rest is the verifier’s job.',
      }),
    ],
  })
  // Two sentences, both carrying a command — the trailing prose is not a third requirement.
  expect(rules(p)).not.toContain('acceptance-clause-uncommanded')
})

test('acceptance-clause-uncommanded is advisory — deciding whether prose states a requirement is a judgement', () => {
  const p = base({ tasks: [task({ acceptance: 'the usage text documents the flag' })] })
  const f = lint(p).find(x => x.rule === 'acceptance-clause-uncommanded')
  expect(f?.severity).toBe('minor')
})

test('the rules that DO block are the unambiguous ones', () => {
  const p = base({
    tasks: [
      task({ id: 'A', work: 'create `scripts/assert-x.sh`', writablePaths: ['scripts/'], redCommand: 'test -x scripts/assert-x.sh', acceptance: '`bash scripts/assert-x.sh` exits 0' }),
    ],
  })
  const blocking = lint(p).filter(f => f.severity !== 'minor').map(f => f.rule)
  expect(blocking).toContain('redcommand-existence-only')
  expect(blocking).toContain('self-gating-task')
})

// ---------------------------------------------------------------- work accretion
// A round's amendment REPLACES the work cell; it does not append to it. Two round markers in one
// cell is the append, and the implementer is then handed every superseded instruction alongside the
// live one. Decidable from the cell alone — no plan history needed.

test('a work cell carrying two round markers is MAJOR', () => {
  const p = base({ tasks: [task({ work: 'build the thing. ROUND 2 — also fix x. ROUND 3 — and y.' })] })
  const f = lint(p).find(x => x.rule === 'work-accretion')
  expect(f?.severity).toBe('major')
  expect(f?.message).toContain('3')
})

test('a work cell carrying one round marker is silent — that is a replacement', () => {
  const p = base({ tasks: [task({ work: 'build the thing. ROUND 2 — do it this way instead.' })] })
  expect(rules(p)).not.toContain('work-accretion')
})

test('a work cell carrying no round marker is silent', () => {
  expect(rules(base({ tasks: [task()] }))).not.toContain('work-accretion')
})

test('the mixed-case dashed form counts, and ordinary prose about rounds does not', () => {
  const dashed = base({ tasks: [task({ work: 'x. Round 2 — do a. Round 3 — do b.' })] })
  expect(rules(dashed)).toContain('work-accretion')
  const prose = base({ tasks: [task({ work: 'the loop takes 2 rounds; round 3 is the cap and round 4 refuses' })] })
  expect(rules(prose)).not.toContain('work-accretion')
})

// ------------------------------------------------- the rules, through craft-dispatch.sh

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'

/**
 * craft-dispatch.sh EXECUTES every task's `redCommand` before dispatching and refuses one that
 * could not run, so a fixture reaching that script needs a real, genuinely-red script to name.
 */
function redScript(dir: string) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  const p = join(dir, 'scripts', 'check.sh')
  writeFileSync(p, '#!/usr/bin/env bash\necho "1 failed"\nexit 1\n')
  chmodSync(p, 0o755)
}
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'bun:test'

const DISPATCH = `${import.meta.dir}/craft-dispatch.sh`
const RUN_ID = 'dispatch-run'
const dirs: string[] = []
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })))

function dispatch(f: { dir: string; plan: string }) {
  try {
    const stdout = execFileSync('bash', [DISPATCH, f.plan], {
      encoding: 'utf8', cwd: f.dir, env: { ...process.env, CRAFT_DISPATCH_DRYRUN: '1' },
    })
    return { code: 0, out: stdout }
  } catch (e: any) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

// ---------------------------------------------------------------- the dependency graph
//
// `dependsOn` decides wall-clock and nothing printed it. The layering here must be the one
// IMPLEMENT will actually run — same Kahn rounds as workflow.js `implementWaves`, same
// tasks[]-order within a wave — or the printed shape is not the shape that runs.

import * as planLint from './plan-lint.ts'

const LINT = `${import.meta.dir}/plan-lint.ts`
/** Called through the namespace so a missing export fails these tests, not the whole file. */
const taskGraph = (tasks: Plan['tasks']) => (planLint as any).taskGraph(tasks)

const chain = (ids: string[], deps: (i: number) => string[]) =>
  base({ tasks: ids.map((id, i) => task({ id, writablePaths: [`src/${id}/`], dependsOn: deps(i) })) })

test('a fully serial chain layers into one wave per task', () => {
  const g = taskGraph(chain(['T1', 'T2', 'T3'], i => (i ? [`T${i}`] : [])).tasks)
  expect(g.waves).toEqual([['T1'], ['T2'], ['T3']])
  expect(g.criticalPath).toBe(3)
  expect(g.widestWave).toBe(1)
  expect(g.cycle).toBeNull()
})

test('a fully parallel set is one wave', () => {
  const g = taskGraph(chain(['T1', 'T2', 'T3'], () => []).tasks)
  expect(g.waves).toEqual([['T1', 'T2', 'T3']])
  expect(g.criticalPath).toBe(1)
  expect(g.widestWave).toBe(3)
})

test('a diamond layers into three waves with the two middles together', () => {
  const p = base({
    tasks: [
      task({ id: 'T1', writablePaths: ['src/1/'], dependsOn: [] }),
      task({ id: 'T2', writablePaths: ['src/2/'], dependsOn: ['T1'] }),
      task({ id: 'T3', writablePaths: ['src/3/'], dependsOn: ['T1'] }),
      task({ id: 'T4', writablePaths: ['src/4/'], dependsOn: ['T2', 'T3'] }),
    ],
  })
  const g = taskGraph(p.tasks)
  expect(g.waves).toEqual([['T1'], ['T2', 'T3'], ['T4']])
  expect(g.criticalPath).toBe(3)
  expect(g.widestWave).toBe(2)
})

test('a single task is one wave of one', () => {
  const g = taskGraph([task({ id: 'T1' })])
  expect(g.waves).toEqual([['T1']])
  expect(g.criticalPath).toBe(1)
  expect(g.widestWave).toBe(1)
})

test('a cycle yields the leftover ids and NO waves — a partial layering of an unschedulable graph is a lie', () => {
  const p = base({
    tasks: [
      task({ id: 'T1', writablePaths: ['src/1/'], dependsOn: ['T2'] }),
      task({ id: 'T2', writablePaths: ['src/2/'], dependsOn: ['T1'] }),
    ],
  })
  const g = taskGraph(p.tasks)
  expect(g.waves).toBeNull()
  expect(g.criticalPath).toBeNull()
  expect([...(g.cycle ?? [])].sort()).toEqual(['T1', 'T2'])
})

test('a cycle is a hard error at the gate — critical, which craft-dispatch.sh refuses', () => {
  const p = base({
    tasks: [
      task({ id: 'T1', writablePaths: ['src/1/'], dependsOn: ['T2'] }),
      task({ id: 'T2', writablePaths: ['src/2/'], dependsOn: ['T1'] }),
    ],
  })
  expect(rules(p)).toContain('dependson-cycle')
  expect(lint(p).find(x => x.rule === 'dependson-cycle')?.severity).toBe('critical')
})

test('a task depending on itself is a cycle, not an ignorable self-edge', () => {
  const g = taskGraph([task({ id: 'T1', dependsOn: ['T1'] })])
  expect(g.cycle).toEqual(['T1'])
})

// REGRESSION GUARD (vacuously true before the feature): no acyclic plan may report a cycle.
test('an acyclic plan reports no cycle finding', () => {
  expect(rules(chain(['T1', 'T2'], i => (i ? ['T1'] : [])))).not.toContain('dependson-cycle')
})

test('an edge to an unknown id is dropped, exactly as workflow.js drops one outside activeTasks', () => {
  const g = taskGraph([task({ id: 'T1', dependsOn: ['T9'] })])
  expect(g.waves).toEqual([['T1']])
  expect(g.cycle).toBeNull()
})

test('--json carries the graph so a consumer need not recompute it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-graph-'))
  dirs.push(dir)
  const a = join(dir, 'args.json')
  writeFileSync(a, JSON.stringify({
    tasks: [
      { id: 'T1', name: 'one', work: 'w', writablePaths: ['src/1/'], refs: [], acceptance: '`bun test` passes', redCommand: 'bun test' },
      { id: 'T2', name: 'two', work: 'w', writablePaths: ['src/2/'], refs: [], acceptance: '`bun test` passes', redCommand: 'bun test', dependsOn: ['T1'] },
    ],
  }))
  let out = ''
  try {
    out = execFileSync('bun', [LINT, a, '--json'], { encoding: 'utf8' })
  } catch (e: any) { out = e.stdout ?? '' }
  const j = JSON.parse(out)
  expect(j.graph.waves).toEqual([['T1'], ['T2']])
  expect(j.graph.criticalPath).toBe(2)
  expect(j.graph.widestWave).toBe(1)
})

// ------------------------------------------------- the same shape, printed by craft-dispatch.sh

/** A clean multi-task plan whose only interesting property is its dependsOn edges. */
function graphFixture(spec: [string, string[]][]) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-graph-'))
  dirs.push(dir)
  redScript(dir)
  const plan = join(dir, 'plan.md')
  const block = {
    runId: RUN_ID,
    args: {
      projectDir: dir,
      goal: 'a goal',
      tasks: spec.map(([id, dependsOn]) => ({
        id, name: id, work: 'do the thing', writablePaths: [`src/${id}/`], refs: [], dependsOn,
        redCommand: 'bash scripts/check.sh', acceptance: '`bash scripts/check.sh` exits 0',
      })),
      mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
      reviewLenses: [{ key: 'k', agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' }],
    },
  }
  writeFileSync(plan, `# Plan\n\n## Run sizing\n\n<!-- craft:dispatch\n${JSON.stringify(block, null, 2)}\n-->\n`)
  return { dir, plan, args: join(dir, '.craft', RUN_ID, 'args.json') }
}

test('craft-dispatch.sh prints a serial chain as one wave per task', () => {
  const r = dispatch(graphFixture([['T1', []], ['T2', ['T1']], ['T3', ['T2']]]))
  expect(r.code).toBe(0)
  expect(r.out).toContain('waves 3: T1 | T2 | T3')
  expect(r.out).toContain('critical path 3 of 3 tasks — widest wave 1')
})

test('craft-dispatch.sh prints a parallel set as one wave', () => {
  const r = dispatch(graphFixture([['T1', []], ['T2', []], ['T3', []]]))
  expect(r.out).toContain('waves 1: T1,T2,T3')
  expect(r.out).toContain('critical path 1 of 3 tasks — widest wave 3')
})

test('craft-dispatch.sh prints a diamond with its middle wave paired', () => {
  const r = dispatch(graphFixture([['T1', []], ['T2', ['T1']], ['T3', ['T1']], ['T4', ['T2', 'T3']]]))
  expect(r.out).toContain('waves 3: T1 | T2,T3 | T4')
  expect(r.out).toContain('critical path 3 of 4 tasks — widest wave 2')
})

test('craft-dispatch.sh refuses a cyclic plan and prints no layering', () => {
  const f = graphFixture([['T1', ['T2']], ['T2', ['T1']]])
  const r = dispatch(f)
  expect(r.code).toBe(3)
  expect(r.out).toMatch(/cycle/i)
  expect(r.out).not.toMatch(/waves \d+:/)
  expect(existsSync(f.args)).toBe(false)
})

// ---------------------------------------------------------------- red dispositions
//
// A task whose work is already COMPLETE can satisfy neither gate: declare a redCommand and the
// red-at-dispatch probe refuses it (`red-not-red`), omit it and R2 fires. `redDisposition` is the
// third answer — the same shape craft already uses for open plan findings, a claim a human filed.

test('a task declaring only redDisposition does not fire redcommand-missing', () => {
  const p = base({
    tasks: [task({ redCommand: null, redDisposition: 'work complete round 6; covered by extraction-unity lens' })],
  })
  expect(rules(p)).not.toContain('redcommand-missing')
})

test('a task declaring BOTH redCommand and redDisposition is MAJOR — pick one', () => {
  const p = base({
    tasks: [task({ redCommand: 'bash scripts/check.sh', redDisposition: 'work complete' })],
  })
  expect(rules(p)).toContain('red-both-declared')
  expect(lint(p).find(f => f.rule === 'red-both-declared')!.severity).toBe('major')
})

test('an empty-string redDisposition is treated as absent — REGRESSION GUARD', () => {
  for (const d of ['', '   ', '\t\n'])
    expect(rules(base({ tasks: [task({ redCommand: null, redDisposition: d })] }))).toContain('redcommand-missing')
})

test('neither redCommand nor redDisposition is still redcommand-missing — REGRESSION GUARD', () => {
  const p = base({ tasks: [task({ redCommand: null, redDisposition: null })] })
  expect(rules(p)).toContain('redcommand-missing')
  expect(rules(p)).not.toContain('red-both-declared')
})

test('a redCommand with no disposition is unchanged — REGRESSION GUARD', () => {
  const p = base({ tasks: [task({ redCommand: 'bash scripts/check.sh', redDisposition: null })] })
  expect(rules(p)).not.toContain('redcommand-missing')
  expect(rules(p)).not.toContain('red-both-declared')
})

test('parseArgs carries redDisposition through from an args object', () => {
  const p = parseArgs({ tasks: [{ id: 'T4', redDisposition: 'work complete round 6' }] })
  expect(p.tasks[0].redDisposition).toBe('work complete round 6')
  expect(p.tasks[0].redCommand).toBe(null)
})

test('parseMarkdown reads a redDisposition column without mistaking it for redCommand', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redDisposition |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T4 | four | do it | src/ | `bun test` exits 0 | work complete round 6 |',
  ].join('\n')
  const p = parseMarkdown(md)
  expect(p.tasks[0].redDisposition).toBe('work complete round 6')
  expect(p.tasks[0].redCommand).toBe(null)
  expect(lint(p).map(f => f.rule)).not.toContain('redcommand-missing')
})

// ------------------------------------------- the plan is the args, not the prose (D1/D2, R17-R19)
//
// A claim that is not a `tasks[].acceptance` clause or a `mechanicalChecks` entry is a sentence
// nothing runs. These four rules decide the shapes that survived three plan-lens rounds on one
// real plan while zero artifacts were built.

test('a command in prose that no field runs is flagged', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
    '',
    '## Verification',
    '',
    '```bash',
    'bash scripts/mech-all.sh --target notes | tee /tmp/mech.log',
    '```',
  ].join('\n')
  expect(rules(parseMarkdown(md))).toContain('prose-command')
})

test('the same prose command IS run by an acceptance — nothing to report', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/mech-all.sh --target notes` exits 0 | `bash scripts/check.sh` |',
    '',
    '## Verification',
    '',
    '```bash',
    'bash scripts/mech-all.sh --target notes',
    '```',
  ].join('\n')
  expect(rules(parseMarkdown(md))).not.toContain('prose-command')
})

test('a mechanicalCheck command quoted in prose is not a prose-command', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
    '',
    'The gate runs `bun test scripts/` on a quiet tree, which is why T1 may not edit it.',
    '',
    '## Run sizing',
    '',
    '```',
    'Mechanical checks: tests — `bun test scripts/`',
    '```',
  ].join('\n')
  expect(rules(parseMarkdown(md))).not.toContain('prose-command')
})

test('a bare script name in prose is a noun, not a stated command', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
    '',
    '## Out of scope',
    '',
    '- Publication — `generate-notes.sh` / `generate-slides.sh` stay behind a human decision.',
    '- The dispatcher `craft-dispatch.sh` and `workflows/work.js` are unchanged.',
  ].join('\n')
  expect(rules(parseMarkdown(md))).not.toContain('prose-command')
})

test('a bare script path WITH an argument in prose is still a stated command', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
    '',
    '## Verification',
    '',
    '```bash',
    'scripts/mech-all.sh --target notes',
    '```',
  ].join('\n')
  const f = lint(parseMarkdown(md)).filter(x => x.rule === 'prose-command')
  expect(f).toHaveLength(1)
})

test('a misaligned task-table row is flagged, naming the row', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
    '| T2 | two | do it | src/ | `bash scripts/check.sh` exits 0 |',
  ].join('\n')
  const f = lint(parseMarkdown(md)).filter(x => x.rule === 'plan-table-column-arity')
  expect(f).toHaveLength(1)
  expect(f[0].where).toContain('T2')
})

test('an aligned table reports no arity finding', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | do it | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
    '| T2 | two | do it | lib/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
  ].join('\n')
  expect(rules(parseMarkdown(md))).not.toContain('plan-table-column-arity')
})

test('an escaped pipe inside a cell is not an extra column', () => {
  const md = [
    '| id | name | work | writablePaths | acceptance | redCommand |',
    '| --- | --- | --- | --- | --- | --- |',
    '| T1 | one | add `x(t: string \\| null)` | src/ | `bash scripts/check.sh` exits 0 | `bash scripts/check.sh` |',
  ].join('\n')
  expect(rules(parseMarkdown(md))).not.toContain('plan-table-column-arity')
})

test('an acceptance that pipes and then reads $? is flagged', () => {
  const p = base({
    tasks: [task({ acceptance: '`bash scripts/gate.sh | tee /tmp/l; echo $?` prints 2' })],
  })
  const f = lint(p).filter(x => x.rule === 'pipeline-exit-code')
  expect(f).toHaveLength(1)
  expect(f[0].severity).toBe('major')
})

test('set -o pipefail makes the same pipeline sound — the rule does not ban pipes', () => {
  const p = base({
    tasks: [task({ acceptance: '`set -o pipefail; bash scripts/gate.sh | tee /tmp/l; echo $?` prints 2' })],
  })
  expect(rules(p)).not.toContain('pipeline-exit-code')
})

test('${PIPESTATUS[0]} reads the right stage and is not flagged', () => {
  const p = base({
    tasks: [task({ acceptance: '`bash scripts/gate.sh | tee /tmp/l; echo ${PIPESTATUS[0]}` prints 2' })],
  })
  expect(rules(p)).not.toContain('pipeline-exit-code')
})

test('a pipe with no $? read is not this defect', () => {
  const p = base({ tasks: [task({ acceptance: '`bash scripts/gate.sh | grep -q ok` succeeds' })] })
  expect(rules(p)).not.toContain('pipeline-exit-code')
})

test('|| is not a pipeline — $? after it is not this defect', () => {
  const p = base({
    tasks: [task({ acceptance: '`bash scripts/gate.sh || true; echo $?` prints 0' })],
  })
  expect(rules(p)).not.toContain('pipeline-exit-code')
})

test('an acceptance whose every command is a mechanicalCheck is flagged', () => {
  const p = base({
    tasks: [task({ acceptance: '`bash scripts/check.sh --target notes` exits 0', redCommand: null, redDisposition: 'work complete' })],
    mechanicalChecks: [{ name: 'check', cmd: 'bash scripts/check.sh --target notes' }],
  })
  const f = lint(p).filter(x => x.rule === 'acceptance-is-the-mechanical-check')
  expect(f).toHaveLength(1)
  expect(f[0].where).toContain('T1')
})

test('one distinguishing clause is enough — the acceptance is no longer only the mechanical check', () => {
  const p = base({
    tasks: [task({
      acceptance: '`bash scripts/check.sh --target notes` exits 0; `bash scripts/assert-new.sh` exits 0',
      redCommand: null,
      redDisposition: 'work complete',
    })],
    mechanicalChecks: [{ name: 'check', cmd: 'bash scripts/check.sh --target notes' }],
  })
  expect(rules(p)).not.toContain('acceptance-is-the-mechanical-check')
})

test('an acceptance naming no command at all is not this rule — that is R1', () => {
  const p = base({
    tasks: [task({ acceptance: 'the usage text documents the flag' })],
    mechanicalChecks: [{ name: 'check', cmd: 'bash scripts/check.sh' }],
  })
  expect(rules(p)).not.toContain('acceptance-is-the-mechanical-check')
})
