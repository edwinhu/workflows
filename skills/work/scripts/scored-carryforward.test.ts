// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: plans and args here are INPUT to the scripts under test.
/**
 * The shell half of scoredChecks carry-forward: the fingerprint (work-dispatch.sh --scored-fingerprints),
 * the post-agents re-hash (work-checks.sh `checks.scored`), the carry of prior scores
 * (work-redispatch.sh `priorResults.scores`) and the sizing print. workflow.js only compares the
 * strings these write, so each is tested at its own seam. Engine half: workflow.test.ts "carry E*".
 *
 * Run: bun test ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/scored-carryforward.test.ts
 */
import { describe, expect, test, afterAll, setDefaultTimeout } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from '../../../tests/helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(600_000)

const HERE = import.meta.dir
const DISPATCH = join(HERE, 'work-dispatch.sh')
const REDISPATCH = join(HERE, 'work-redispatch.sh')
const CHECKS = join(HERE, 'work-checks.sh')
const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

const countProps = { itemsChecked: { type: 'integer' }, missing: { type: 'integer' } }
const scoredCheck = (items: any[], over: any = {}) => ({
  key: 'slides', items, prompt: 'Count coverage occurrences.', refs: ['rules.md'],
  schema: { type: 'object', properties: countProps },
  components: [{ name: 'coverage', weight: 1, base: 10, penalties: { missing: 1 } }],
  ...over,
})
const objItems = [{ text: 'L1', inputs: ['d/L1.typ', 'notes.md'] }, { text: 'L2', inputs: ['d/L2.typ', 'notes.md'] }]

/** A readOnly (diagnose-shaped) project: two decks, a notes file, a rule file, a passing gate. */
function project(extra: Record<string, unknown> = {}, items: any[] = objItems, reuse?: string) {
  // The refs path is absolute, so it is part of a fingerprint: a second project that must match the
  // first one's fingerprints reuses its directory.
  const dir = reuse ?? mkTmp('scored-cf-')
  if (!reuse) scratch.push(dir)
  mkdirSync(join(dir, 'd'), { recursive: true })
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'd/L1.typ'), 'deck one')
  writeFileSync(join(dir, 'd/L2.typ'), 'deck two')
  writeFileSync(join(dir, 'notes.md'), 'notes')
  writeFileSync(join(dir, 'rules.md'), 'rules')
  writeFileSync(join(dir, 'scripts/check.sh'), 'echo "gate: 1 file(s) examined"\nexit 0\n')
  chmodSync(join(dir, 'scripts/check.sh'), 0o755)
  const args = {
    projectDir: dir, goal: 'audit the decks', readOnly: true, tasks: [],
    mechanicalChecks: [{ name: 'gate', cmd: 'bash scripts/check.sh' }],
    lens: { agentType: 'Explore', refs: [], prompt: 'raise MAJOR when the work is wrong' },
    scoredChecks: [scoredCheck(items, { refs: [join(dir, 'rules.md')] })],
    ...extra,
  }
  const plan = join(dir, 'plan.md')
  writeFileSync(plan, '# Plan\n\n## Run sizing\n\nnothing parked\n\n' +
    `<!-- work:dispatch\n${JSON.stringify({ runId: 'cf-run', args }, null, 2)}\n-->\n`)
  return { dir, plan, argsPath: join(dir, '.work', 'cf-run', 'args.json'), args }
}

function dispatch(f: { dir: string; plan: string }) {
  try {
    const out = execFileSync('bash', [DISPATCH, '--provider', 'claude', '--no-red-probe', '--no-mech-probe', '--no-suite-lint', f.plan],
      { timeout: 120_000, encoding: 'utf8', cwd: f.dir, env: { ...process.env, WORK_DISPATCH_DRYRUN: '1' } })
    return { code: 0, out }
  } catch (e: any) { return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') } }
}
const readArgs = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const fingerprintsOf = (argsPath: string) => {
  const r = spawnSync('bash', [DISPATCH, '--scored-fingerprints', argsPath], { encoding: 'utf8', timeout: 60_000 })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), fps: readArgs(argsPath).scoredFingerprints }
}

describe('work-dispatch.sh --scored-fingerprints', () => {
  test('E13: a fingerprint per object-form job; it moves with an input byte, a refs byte, the prompt or the components, not an unrelated file', () => {
    const f = project()
    expect(dispatch(f).code).toBe(0)
    const base = fingerprintsOf(f.argsPath).fps
    expect(Object.keys(base).sort()).toEqual(['slides::L1', 'slides::L2'])
    expect(base['slides::L1']).toMatch(/^[0-9a-f]{64}$/)
    expect(base['slides::L1']).not.toBe(base['slides::L2'])
    writeFileSync(join(f.dir, 'unrelated.txt'), 'x')
    expect(fingerprintsOf(f.argsPath).fps).toEqual(base)
    // an input byte: only the jobs that list it move
    writeFileSync(join(f.dir, 'd/L1.typ'), 'deck one, edited')
    const afterDeck = fingerprintsOf(f.argsPath).fps
    expect(afterDeck['slides::L1']).not.toBe(base['slides::L1'])
    expect(afterDeck['slides::L2']).toBe(base['slides::L2'])
    // a shared input moves both
    writeFileSync(join(f.dir, 'notes.md'), 'notes, edited')
    const afterNotes = fingerprintsOf(f.argsPath).fps
    expect(afterNotes['slides::L2']).not.toBe(base['slides::L2'])
    // a refs file: every job moves
    writeFileSync(join(f.dir, 'rules.md'), 'rules, edited')
    const afterRef = fingerprintsOf(f.argsPath).fps
    expect(afterRef['slides::L1']).not.toBe(afterNotes['slides::L1'])
    expect(afterRef['slides::L2']).not.toBe(afterNotes['slides::L2'])
    // the prompt, and the components
    for (const [k, v] of [['prompt', 'a different prompt'], ['components', [{ name: 'coverage', weight: 1, base: 9, penalties: { missing: 1 } }]]] as const) {
      const a = readArgs(f.argsPath)
      const before = fingerprintsOf(f.argsPath).fps
      a.scoredChecks[0][k] = v
      writeFileSync(f.argsPath, JSON.stringify(a))
      const after = fingerprintsOf(f.argsPath).fps
      expect(after['slides::L1'], k).not.toBe(before['slides::L1'])
    }
  })

  test('E14: an absent input, or an absent refs file, makes the fingerprint null', () => {
    const f = project()
    expect(dispatch(f).code).toBe(0)
    rmSync(join(f.dir, 'd/L2.typ'))
    const fps = fingerprintsOf(f.argsPath).fps
    expect(fps['slides::L2']).toBeNull()
    expect(fps['slides::L1']).toMatch(/^[0-9a-f]{64}$/)
    rmSync(join(f.dir, 'rules.md'))
    const none = fingerprintsOf(f.argsPath).fps
    expect(none['slides::L1']).toBeNull()
  })

  test('E15: dispatch writes them on a readOnly run, where the red probe returns early', () => {
    const f = project()
    const r = dispatch(f)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/red-probe: readOnly|scored-fingerprints/)
    const a = readArgs(f.argsPath)
    expect(a.readOnly).toBe(true)
    expect(Object.keys(a.scoredFingerprints).sort()).toEqual(['slides::L1', 'slides::L2'])
  })

  test('string items get no entry, and a plan without object items writes no scoredFingerprints key', () => {
    const f = project({}, ['L1', 'L2'])
    expect(dispatch(f).code).toBe(0)
    expect('scoredFingerprints' in readArgs(f.argsPath)).toBe(false)
  })

  test('E16: the sizing print is the plan stage fanOut, carried jobs excluded', () => {
    const seed = project()
    expect(dispatch(seed).code).toBe(0)
    const fps = fingerprintsOf(seed.argsPath).fps
    const prior = (item: string) => ({ key: 'slides', item, components: { coverage: 10 }, composite: 10, itemsChecked: 3, fingerprint: fps[`slides::${item}`] })
    const f = project({ priorResults: { implemented: [], verified: [], scores: [prior('L1')] } }, objItems, seed.dir)
    const r = dispatch(f)
    expect(r.code, r.out).toBe(0)
    expect(r.out).toMatch(/scored=1\b/)
    expect(r.out).toMatch(/scoredCarried=1\b/)
    expect(r.out).toMatch(/fan-out floor 2 vs maxAgents 50/)     // 1 fresh scored + 1 lens
  })
})

describe('work-checks.sh emits checks.scored', () => {
  test('E21: a fingerprint per object-form job, taken after the agents', () => {
    const f = project()
    expect(dispatch(f).code).toBe(0)
    const raw = join(f.dir, 'raw.json'), out = join(f.dir, 'checks.json')
    writeFileSync(raw, JSON.stringify({ stage: 'agents', agents: {}, checkPlan: { red: [], acceptance: [], mechanical: [], rules: [] } }))
    const before = fingerprintsOf(f.argsPath).fps
    // an input moves between dispatch and the checks: the checks report the NEW bytes
    writeFileSync(join(f.dir, 'd/L1.typ'), 'edited by someone mid-round')
    const r = spawnSync('bash', [CHECKS, f.argsPath, raw, out], { encoding: 'utf8', timeout: 120_000 })
    expect(r.status, r.stderr).toBe(0)
    const scored = readArgs(out).scored
    expect(Object.keys(scored).sort()).toEqual(['slides::L1', 'slides::L2'])
    expect(scored['slides::L1']).not.toBe(before['slides::L1'])
    expect(scored['slides::L2']).toBe(before['slides::L2'])
  })

  test('a run with no object-form items emits no scored record', () => {
    const f = project({}, ['L1'])
    expect(dispatch(f).code).toBe(0)
    const raw = join(f.dir, 'raw.json'), out = join(f.dir, 'checks.json')
    writeFileSync(raw, JSON.stringify({ stage: 'agents', agents: {}, checkPlan: { red: [], acceptance: [], mechanical: [], rules: [] } }))
    expect(spawnSync('bash', [CHECKS, f.argsPath, raw, out], { encoding: 'utf8', timeout: 120_000 }).status).toBe(0)
    expect('scored' in readArgs(out)).toBe(false)
  })
})

describe('work-redispatch.sh carries measured prior scores', () => {
  /** A dispatched readOnly run plus a previous result.json whose scores[] the redispatch reads. */
  function round2(scores: any[], extra: Record<string, unknown> = {}) {
    const f = project(extra)
    expect(dispatch(f).code).toBe(0)
    const runDir = join(f.dir, '.work', 'cf-run')
    const a = readArgs(f.argsPath)
    a.rounds = 1
    writeFileSync(f.argsPath, JSON.stringify(a, null, 2))
    writeFileSync(join(runDir, 'result.json'), JSON.stringify({
      overallPass: false, verdict: 'FAIL', implemented: [], verified: [], red: [], tasksThatFlagged: [],
      mechanicalThatFailed: [], rulesThatFailed: [], lensesThatFlagged: ['lens'], findings: [], routes: [], planFindings: [],
      scores,
    }, null, 2))
    return { ...f, runDir }
  }
  const redispatch = (f: { plan: string; argsPath: string }, ...extra: string[]) => {
    const farm = join(f.plan, '..', 'farm-stub.sh')
    writeFileSync(farm, '#!/usr/bin/env bash\nexit 0\n'); chmodSync(farm, 0o755)
    const r = spawnSync('bash', [REDISPATCH, f.plan, f.argsPath, '--provider', 'claude', '--dispatch', ...extra], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env, WORK_FARM: farm, WORK_ROUND: farm, WORK_NO_SCOPE: '1', WORK_DISPATCH_DRYRUN: '1' } })
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }
  const measured = (item: string, over: any = {}) => ({
    key: 'slides', item, components: { coverage: 9 }, composite: 9, itemsChecked: 4, fingerprint: `fp-${item}`, ...over })

  test('E17: the readOnly FULL path carries measured, fingerprinted scores into priorResults.scores and refreshes the fingerprints', () => {
    const f = round2([measured('L1'), measured('L2')])
    const r = redispatch(f)
    expect(r.code, r.out).toBe(0)
    const a = readArgs(f.argsPath)
    expect(a.priorResults.scores.map((s: any) => s.item)).toEqual(['L1', 'L2'])
    expect(a.scoredFingerprints['slides::L1']).toMatch(/^[0-9a-f]{64}$/)   // recomputed, not the stale one
    expect(r.out).toMatch(/scored-fingerprints/)
  })

  test('E19: --full drops them', () => {
    const f = round2([measured('L1'), measured('L2')])
    expect(redispatch(f, '--full').code).toBe(0)
    expect(readArgs(f.argsPath).priorResults?.scores).toBeUndefined()
  })

  test('E20: a null-composite or fingerprint-less prior entry is not carried', () => {
    const f = round2([measured('L1', { composite: null, reason: 'agent died or was skipped' }), measured('L2', { fingerprint: null }), measured('L3')])
    expect(redispatch(f).code).toBe(0)
    expect(readArgs(f.argsPath).priorResults.scores.map((s: any) => s.item)).toEqual(['L3'])
  })

  test('E18: the scoped path carries them too', () => {
    const mk = (i: number, path: string) => ({ id: `T${i}`, name: `task ${i}`, work: `edit ${path}`, writablePaths: [path], refs: [],
      redCommand: `bash scripts/red${i}.sh`, acceptance: `\`bash scripts/red${i}.sh\` exits 0` })
    const tasks = [mk(1, 'd/'), mk(2, 'other/')]
    const f = round2([measured('L1'), measured('L2')], { readOnly: false, tasks })
    for (const i of [1, 2]) {
      writeFileSync(join(f.dir, `scripts/red${i}.sh`), 'echo "1 failed"\nexit 1\n'); chmodSync(join(f.dir, `scripts/red${i}.sh`), 0o755)
    }
    // T1 flagged, T2 settled with a proven red pair => the scoped path
    const prev = JSON.parse(readFileSync(join(f.runDir, 'result.json'), 'utf8'))
    Object.assign(prev, { tasksThatFlagged: ['T1'], implemented: [{ id: 'T2', done: true }], verified: [{ id: 'T2', pass: true }],
      red: [{ id: 'T2', command: 'bash scripts/red2.sh', verdict: 'red-green' }] })
    writeFileSync(join(f.runDir, 'result.json'), JSON.stringify(prev))
    const r = redispatch(f)
    expect(r.code, r.out).toBe(0)
    const a = readArgs(f.argsPath)
    expect(a.onlyTasks).toEqual(['T1'])
    expect(a.priorResults.scores.map((s: any) => s.item)).toEqual(['L1', 'L2'])
  })
})
