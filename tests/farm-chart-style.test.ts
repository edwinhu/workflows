import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync, existsSync, cpSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')
const FARM = join(ROOT, 'skills', 'farm-out', 'scripts', 'farm.sh')
const LINT = join(ROOT, 'scripts', 'lib', 'brief-style-lint.ts')
const RUNNER = join(ROOT, 'bin', 'workflow-check')
const RULES_STUB = join(import.meta.dir, 'fixtures', 'ds-gate', 'rule-check-clean.sh')
const FIX = join(ROOT, 'tests', 'fixtures', 'ds-chart-typography')
const GATEFIX = join(ROOT, 'tests', 'fixtures', 'ds-gate')

function lint(row: Record<string, unknown>) {
  const r = spawnSync('bun', [LINT, '--row', JSON.stringify(row)], { encoding: 'utf8', timeout: 30_000 })
  return { rc: r.status, err: r.stderr }
}

const DATA_ONLY = 'Chart Nevada movers against matched Delaware controls: the share with a restatement in years 0 to +5, per venue. ' +
  'Read /data/nevada/data/output/table_restatements.csv. Style is set by the rules in ds-chart-type-system.md and ds-chart-palette-choice.md; ' +
  'run `python3 checks/ds/constraints/ds-chart-color.py scratch/wsj_final/`. Print the plotted values.'

// ---- the matcher ---------------------------------------------------------------------------

test('lint refuses a hex colour and names it', () => {
  const r = lint({ agent: 'ds', prompt: 'Plot restatement shares. Nevada bars in #E9B93B, Delaware #7BA05B.' })
  expect(r.rc).toBe(2)
  expect(r.err).toContain('"#E9B93B"')
  expect(r.err).toContain('belongs to the subagent')
})

test('lint refuses "use a sans-serif font" and a named face', () => {
  expect(lint({ agent: 'ds', prompt: 'Make a bar chart of the shares. Use a sans-serif font.' }).rc).toBe(2)
  const r = lint({ agent: 'ds', prompt: 'Make a bar chart; labels in Helvetica or Liberation Sans.' })
  expect(r.rc).toBe(2)
  expect(r.err).toContain('"Helvetica"')
})

test('lint refuses an X-style look directive', () => {
  expect(lint({ agent: 'ds', prompt: 'Build WSJ-style simple bar charts of the shares.' }).rc).toBe(2)
  expect(lint({ agent: 'ds', prompt: 'Give the figures the FT graphics look.' }).rc).toBe(2)
  expect(lint({ agent: 'ds', prompt: 'Use yellow bars for Nevada.' }).rc).toBe(2)
})

test('lint passes a brief that names only data and comparisons, and mentions the rule files', () => {
  expect(lint({ agent: 'ds', prompt: DATA_ONLY })).toEqual({ rc: 0, err: '' })
})

test('lint ignores fenced and quoted user content and paths', () => {
  const prompt = 'Chart the shares from the memo.\n\n```\nfont-family: Helvetica; color: #E9B93B\n```\n> the old figure used sans-serif\nRead /home/eh/scratch/serif_fonts/#abc123/report.md and wsj-style.css.'
  expect(lint({ agent: 'ds', prompt }).rc).toBe(0)
})

test('lint leaves non-chart rows alone and does not flag issue numbers or newspapers', () => {
  expect(lint({ prompt: 'Summarise the serif typeface section of the style guide for the memo.' }).rc).toBe(0)
  expect(lint({ agent: 'ds', prompt: 'Chart the shares; see issue #123 and the New York Times piece, Georgia and Courier filings.' }).rc).toBe(0)
})

test('userStyle: the user\'s verbatim words in the prompt are the only override', () => {
  const words = 'Use Helvetica and #E9B93B for Nevada'
  const prompt = `Chart the shares by venue. The user asked: "${words}".`
  expect(lint({ agent: 'ds', prompt }).rc).toBe(2)
  const ok = lint({ agent: 'ds', prompt, userStyle: words })
  expect(ok.rc).toBe(0)
  expect(ok.err).toContain('userStyle override accepted')
  // style outside the quoted span is still refused
  expect(lint({ agent: 'ds', prompt: prompt + ' Also make it sans-serif.', userStyle: words }).rc).toBe(2)
  // a userStyle that is not in the prompt (or is empty) is not an override
  expect(lint({ agent: 'ds', prompt, userStyle: 'something else' }).rc).toBe(2)
  expect(lint({ agent: 'ds', prompt, userStyle: '' }).rc).toBe(2)
})

// ---- farm.sh: launch refusal and the output gate -------------------------------------------

// A stub claude-code that records that it ran and, optionally, copies a fixture into its cwd.
function farm(rows: Record<string, unknown>[], copyFixture?: string, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'farmstyle-'))
  const cwd = join(root, 'cwd'); const bin = join(root, 'bin')
  mkdirSync(cwd, { recursive: true }); mkdirSync(bin, { recursive: true })
  const ran = join(root, 'ran')
  writeFileSync(join(bin, 'claude-code'), `#!/usr/bin/env bash\n: > "${ran}"\n${copyFixture ? `mkdir -p figs && cp ${copyFixture}/* figs/\n` : ''}printf '{"type":"result","result":"done"}\\n'\n`)
  chmodSync(join(bin, 'claude-code'), 0o755)
  const tasks = join(root, 'tasks.json')
  writeFileSync(tasks, JSON.stringify(rows))
  const res = spawnSync('bash', [FARM, '--provider', 'claude', '--tasks', tasks, '--cwd', cwd], {
    encoding: 'utf8', timeout: 300_000, cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FARM_OUT_CHILD: '1', FARM_OUTCOMES: join(root, 'outcomes.jsonl'),
           TMPDIR: root, CLAUDE_CODE_SESSION_ID: 'farm-chart-style-test', DOMAIN_GATE_RULE_CHECK: RULES_STUB, WORKFLOW_CHECKS_PATH: ROOT, ...env } })
  const out = { status: res.status, stderr: res.stderr, ran: existsSync(ran), rows: JSON.parse(res.stdout || '[]'),
                outcomes: existsSync(join(root, 'outcomes.jsonl')) ? readFileSync(join(root, 'outcomes.jsonl'), 'utf8') : '' }
  rmSync(root, { recursive: true, force: true })
  return out
}

test('farm.sh refuses a styling brief at launch: exit 2, names the text, no row runs', () => {
  const r = farm([{ label: 'ok', agent: 'ds', prompt: DATA_ONLY }, { label: 'bad', agent: 'ds', prompt: 'Chart the shares in clean sans-serif with #E9B93B bars.' }])
  expect(r.status).toBe(2)
  expect(r.stderr).toContain('task 1 (bad) refused by the brief style lint')
  expect(r.stderr).toContain('"#E9B93B"')
  expect(r.stderr).toContain('1 of 2 row(s) refused')
  expect(r.ran).toBe(false)
})

test('farm.sh runs a styling brief when the row carries the user\'s verbatim words in userStyle', () => {
  const words = 'make it sans-serif'
  const r = farm([{ label: 'u', agent: 'ds', prompt: `Chart the shares. The user said: ${words}.`, userStyle: words }])
  expect(r.stderr).toContain('userStyle override accepted')
  expect(r.ran).toBe(true)
})

const GATE_MSG = 'ds constraint gate failed'

test('output gate marks a ds row wrong when the child left a sans-serif chart theme', () => {
  const r = farm([{ label: 'g', agent: 'ds', prompt: DATA_ONLY }], join(FIX, 'founder-v2'))
  expect(r.ran).toBe(true)
  const row = r.rows[0]
  expect(row.ok).toBe(false)
  expect(row.failure).toContain(GATE_MSG)
  expect(row.failure).toContain('ds-chart-typography exit 1')
  expect(r.stderr).toContain('UNVERIFIED')
  const verdict = r.outcomes.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.type === 'verdict')
  expect(verdict.verdict).toBe('wrong')
  expect(verdict.checks).toContain('ds-constraints')
  expect(verdict.why).toContain(GATE_MSG)
})

test('output gate passes a compliant serif chart fixture', () => {
  const r = farm([{ label: 'g', agent: 'ds', prompt: DATA_ONLY }], join(FIX, 'serif-600'))
  expect(r.rows[0].ok).toBe(true)
  expect(r.rows[0].failure).toBeUndefined()
})

test('a writing row is gated by writing\'s checks, not ds\'s: a ds chart theme does not fail it', () => {
  const r = farm([{ label: 'g', agent: 'writing', prompt: 'Draft the memo section on shares.' }], join(FIX, 'founder-v2'))
  expect(r.rows[0].ok).toBe(true)
})

// ---- the runner (bin/workflow-check ds) on a farmed row's scope, directly ---------------------

test('ds-gate sees a chart under a directory named scratch (the colour linter used to prune it)', () => {
  const root = mkdtempSync(join(tmpdir(), 'chartgate-'))
  const d = join(root, 'scratch', 'figs'); mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'c.py'), 'import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\n')
  const r = spawnSync('python3', [join(ROOT, 'checks', 'ds', 'constraints', 'ds-chart-color.py'), '--project-dir', root, '--files', join(d, 'c.py')], { encoding: 'utf8', timeout: 60_000 })
  expect(r.stdout.split('\n')[0]).toMatch(/^ds-chart-color: 1 \S.* examined/)
  rmSync(root, { recursive: true, force: true })
})

test('ds-gate with nothing chart-shaped touched says so: an explicit empty scope, exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'chartgate-'))
  writeFileSync(join(root, 'stamp'), ''); writeFileSync(join(root, 'log'), '')
  const past = new Date(Date.now() - 60_000); utimesSync(join(root, 'stamp'), past, past)
  writeFileSync(join(root, 'notes.md'), 'x')
  const r = spawnSync('python3', [RUNNER, 'ds', '--constraints-only', '--cwd', root, '--stamp', join(root, 'stamp'), '--log', join(root, 'log')],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, WORKFLOW_CHECKS_PATH: ROOT } })
  expect(r.status).toBe(0)
  expect(r.stdout).toMatch(/^ds-chart-color: 0 \S.* examined.*nothing in scope \(/m)
  rmSync(root, { recursive: true, force: true })
})

// ---- the code checkers (every ds-* rule, not only A5/A6) -----------------------------------

test('output gate marks a ds row wrong for a non-chart rule: unaudited join, unlogged dropna, no schema contract, bare OLS', () => {
  const r = farm([{ label: 'g', agent: 'ds', prompt: DATA_ONLY }], join(GATEFIX, 'bad'))
  const row = r.rows[0]
  expect(row.ok).toBe(false)
  expect(row.failure).toContain('ds constraint gate failed')
  for (const c of ['ds-join-audits', 'ds-error-handling', 'ds-schema-contracts', 'ds-standard-error-spec'])
    expect(row.failure).toContain(`${c} exit 1`)
  expect(row.failure).toContain('pipeline.py:')
})

test('a row declaring workflow dev is gated by the dev domain: its Jev verdict fails the row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devstub-'))
  const stub = join(dir, 'rc.sh')
  writeFileSync(stub, `#!/usr/bin/env bash\necho '{"verdicts":[{"rule":"MOCK","p":0.93,"verdict":"VIOLATED","spans":["figs/pipeline.py:3"]}],"unavailable":[]}'\n`); chmodSync(stub, 0o755)
  const r = farm([{ label: 'd', agent: 'general-purpose', workflow: 'dev', prompt: 'Add the feature.' }], join(GATEFIX, 'clean'), { DOMAIN_GATE_RULE_CHECK: stub })
  rmSync(dir, { recursive: true, force: true })
  expect(r.rows[0].ok).toBe(false)
  expect(r.rows[0].failure).toContain('dev constraint gate failed')
  expect(r.rows[0].failure).toContain('MOCK p=0.93')
  const verdict = r.outcomes.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.type === 'verdict')
  expect(verdict.checks).toContain('dev-constraints')
})

test('output gate passes a clean pipeline', () => {
  const r = farm([{ label: 'g', agent: 'ds', prompt: DATA_ONLY }], join(GATEFIX, 'clean'))
  expect(r.rows[0].ok).toBe(true)
})

function gateRun(opts: { files: Record<string, string>, constraints?: Record<string, string> }) {
  const root = mkdtempSync(join(tmpdir(), 'dsgate-'))
  // a private copy of the ds layout, so a checker can be replaced with one that cannot run
  const plug = join(root, 'plug')
  cpSync(join(ROOT, 'checks', 'ds'), join(plug, 'checks', 'ds'), { recursive: true })
  cpSync(join(ROOT, 'checks', '_jev'), join(plug, 'checks', '_jev'), { recursive: true })
  for (const [n, body] of Object.entries(opts.constraints ?? {})) writeFileSync(join(plug, 'checks', 'ds', 'constraints', n), body)
  const cwd = join(root, 'cwd'); mkdirSync(cwd)
  writeFileSync(join(root, 'stamp'), ''); writeFileSync(join(root, 'log'), '')
  const past = new Date(Date.now() - 60_000); utimesSync(join(root, 'stamp'), past, past)
  for (const [n, body] of Object.entries(opts.files)) { mkdirSync(join(cwd, n, '..'), { recursive: true }); writeFileSync(join(cwd, n), body) }
  const r = spawnSync('python3', [RUNNER, 'ds', '--cwd', cwd, '--stamp', join(root, 'stamp'), '--log', join(root, 'log')],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, DOMAIN_GATE_RULE_CHECK: RULES_STUB, WORKFLOW_CHECKS_PATH: plug } })
  rmSync(root, { recursive: true, force: true })
  return { rc: r.status, out: r.stdout }
}
const BAD = readFileSync(join(GATEFIX, 'bad', 'pipeline.py'), 'utf8')
const CLEAN = readFileSync(join(GATEFIX, 'clean', 'pipeline.py'), 'utf8')

test('ds-gate checks code under a scratch/ directory and reports the original path', () => {
  const r = gateRun({ files: { 'scratch/run1/pipeline.py': BAD } })
  expect(r.rc).toBe(1)
  expect(r.out).toContain('scratch/run1/pipeline.py:')
})

test('ds-gate respects a waiver that carries a reason', () => {
  const waived = BAD.replace('m = a.merge(b, on="k")', 'm = a.merge(b, on="k")  # ds-join-audits: fixture merge, counted by the caller test')
  const r = gateRun({ files: { 'scratch/p.py': waived } })
  expect(r.out).not.toContain('ds-join-audits exit')
})

test('ds-gate: a clean file passes and says what ran; a figure-only row says the code checkers had nothing', () => {
  const ok = gateRun({ files: { 'p.py': CLEAN } })
  expect(ok.rc).toBe(0)
  expect(ok.out).toMatch(/^ds-join-audits: 1 \S.* examined/m)
  const fig = gateRun({ files: { 'f.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' } })
  expect(fig.out).toMatch(/^ds-join-audits: 0 \S.* examined.*nothing in scope \(/m)
})

test('ds-gate exits 2, never 0, when a checker crashes or prints no verdict', () => {
  const crash = gateRun({ files: { 'p.py': CLEAN }, constraints: { 'ds-determinism.py': '1/0\n' } })
  expect(crash.rc).toBe(2)
  expect(crash.out).toContain('COULD-NOT-CHECK: ds-determinism')
  expect(crash.out).toContain('ZeroDivisionError')
  const mute = gateRun({ files: { 'p.py': CLEAN }, constraints: { 'ds-idempotency.py': 'pass\n' } })
  expect(mute.rc).toBe(2)
  expect(mute.out).toContain('COULD-NOT-CHECK: ds-idempotency printed no count line first')
})
