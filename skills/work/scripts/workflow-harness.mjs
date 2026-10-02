// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the lens and task literals here are
// test INPUTS to workflow.js, not workflow declarations carrying domain rules.
// P7 governs what workflow-creator EMITS.
// Executes workflow.js for real against stubbed harness globals, so the gate's arithmetic can be
// tested without dispatching an agent. `node --check` proves only that the file parses.
//
// The script is a Workflow module: top-level await, `export const meta`, and the hooks
// (agent/phase/parallel/pipeline/log) supplied as free variables rather than imports. So it cannot
// be `import`ed — it is read, the `export` stripped, and the body compiled as an AsyncFunction whose
// parameters ARE those hooks. That is why this file exists instead of a normal import.
import { readFileSync } from 'node:fs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export const WORKFLOW = new URL('../workflow.js', import.meta.url).pathname

function load(path) {
  const src = readFileSync(path, 'utf8').replace('export const meta =', 'const meta =')
  return new AsyncFunction('args', 'agent', 'phase', 'parallel', 'pipeline', 'log', src)
}

/**
 * Run a whole work ROUND under stubs: the AGENTS stage, then the commands work-checks.sh would run,
 * then the DIGEST stage, the ONE lens row work-stage.mjs would farm out, and the GATE stage.
 * @param args      the args object the workflow receives (args.round set => one stage, as given)
 * @param agentReply (label, prompt, opts) => result | null   — null models a dead/skipped agent, and
 *                   for a scripted command (red:before/red:after/acceptance/mechanical/rules) a
 *                   command that could not run (exit -1)
 * @param overrides  replace a hook wholesale, e.g. {pipeline: () => Promise.reject(...)}. The
 *                   default stubs swallow a per-ITEM throw, so a LEG-level rejection — what a real
 *                   dispatcher does on budget exhaustion — is only reachable by replacing the hook.
 *                   `checks` is merged over the simulated work-checks.sh output (e.g. {suite: …}).
 * @returns {{result, dispatched, workflowDispatched, scripted, order, logs, prompts, optsMap, stages}}
 *   dispatched         every MODEL agent the round cost: workflow.js's agents plus the farmed lens
 *   workflowDispatched only what workflow.js itself dispatched through agent()
 *   scripted           every command a script ran, labelled red:before:<id>, red:after:<id>,
 *                      acceptance:<id>, mechanical:<name>, rules:<name>
 *   order              agents and scripted commands interleaved, in the order the round ran them
 */
export async function run(args, agentReply, path = WORKFLOW, overrides = {}) {
  const dispatched = []
  const workflowDispatched = []
  const scripted = []
  const order = []
  const logs = []
  const prompts = new Map()
  const optsMap = new Map()
  const stages = []
  const agent = async (prompt, opts) => {
    dispatched.push(opts.label)
    order.push(opts.label)
    workflowDispatched.push(opts.label)
    prompts.set(opts.label, prompt)
    optsMap.set(opts.label, opts)
    return agentReply(opts.label, prompt, opts)
  }
  const phase = () => {}
  // Match the real concurrent barrier, including null slots for throwing thunks.
  const parallel = thunks => Promise.all(thunks.map(async th => {
    try { return await th() } catch { return null }
  }))
  const pipeline = async (items, ...stages) => {
    const out = []
    for (let i = 0; i < items.length; i++) {
      let v = items[i]
      try {
        for (const s of stages) v = await s(v, items[i], i)
        out.push(v)
      } catch { out.push(null) }
    }
    return out
  }
  const log = m => logs.push(m)
  const { checks: checksOverride, ...hookOverrides } = overrides
  const hooks = { agent, phase, parallel, pipeline, log, ...hookOverrides }
  const fn = load(path)
  const exec = a => fn(a, hooks.agent, hooks.phase, hooks.parallel, hooks.pipeline, hooks.log)
  const out = extra => ({ dispatched, workflowDispatched, scripted, order, logs, prompts, optsMap, stages, ...extra })

  if (args.round) return out({ result: await exec(args) })
  // A scripted command: the reply's exitCode, or -1 for a command that could not run.
  const command = async (label, cmd) => {
    scripted.push(label)
    order.push(label)
    prompts.set(label, cmd)
    let r = null
    try { r = await agentReply(label, cmd, { label, scripted: true }) } catch { r = null }
    return r && Number.isInteger(r.exitCode) ? { exitCode: r.exitCode, output: String(r.output ?? '') }
      : { exitCode: -1, output: `could not run: ${cmd}` }
  }
  // work-dispatch.sh: the PLAN stage (sizing + which tasks need a probe), then the before-probe,
  // unless the test supplies the recorded map itself — all before any agent is launched.
  const planStage = await exec({ ...args, round: { plan: true } })
  stages.push('plan')
  let redBefore = args.redBefore
  if (redBefore === undefined) {
    redBefore = {}
    for (const { id, command: c } of planStage.checkPlan.red) redBefore[id] = await command(`red:before:${id}`, c)
  }
  const agentsStage = await exec({ ...args, redBefore })
  stages.push('agents')
  if (!agentsStage || agentsStage.stage !== 'agents') return out({ result: agentsStage })
  const plan = agentsStage.checkPlan
  const checks = {
    red: [], acceptance: [], mechanical: [], rules: [], suite: { checked: 0, changed: [] },
  }
  for (const { id, command: c } of plan.red) checks.red.push({ id, command: c, ...(await command(`red:after:${id}`, c)) })
  for (const { id, command: c } of plan.acceptance) checks.acceptance.push({ id, command: c, ...(await command(`acceptance:${id}`, c)) })
  for (const { name, cmd } of plan.mechanical) checks.mechanical.push({ name, cmd, ...(await command(`mechanical:${name}`, cmd)) })
  // A rule check's reply is {exitCode, stdout}; one that could not run records -1, as work-checks.sh does.
  for (const { name, cmd } of plan.rules || []) {
    scripted.push(`rules:${name}`)
    order.push(`rules:${name}`)
    prompts.set(`rules:${name}`, cmd)
    let r = null
    try { r = await agentReply(`rules:${name}`, cmd, { label: `rules:${name}`, scripted: true }) } catch { r = null }
    checks.rules.push(r && Number.isInteger(r.exitCode)
      ? { name, cmd, exitCode: r.exitCode, stdout: String(r.stdout ?? ''), output: '' }
      : { name, cmd, exitCode: -1, stdout: '', output: `could not run: ${cmd}` })
  }
  Object.assign(checks, checksOverride || {})

  const staged = { ...args, redBefore }
  const digestStage = await exec({ ...staged, round: { agents: agentsStage.agents, checks } })
  stages.push('digest')
  if (!digestStage || digestStage.stage !== 'digest') return out({ result: digestStage, checks, redBefore })
  const spec = digestStage.lens
  dispatched.push(spec.label)
  order.push(spec.label)
  prompts.set(spec.label, spec.prompt)
  optsMap.set(spec.label, spec)
  let lens = null
  try { lens = await agentReply(spec.label, spec.prompt, spec) } catch { lens = null }
  const result = await exec({ ...staged, round: { agents: agentsStage.agents, checks, lens } })
  stages.push('gate')
  return out({ result, checks, redBefore, fanOut: agentsStage.fanOut, checkPlan: plan, digestStage })
}

/** Throws-or-not, without losing what got dispatched first. */
export async function runCatching(args, agentReply, path = WORKFLOW) {
  const dispatched = []
  try {
    const r = await run(args, (l, p, o) => { if (!(o && o.scripted)) dispatched.push(l); return agentReply(l, p, o) }, path)
    return { threw: false, error: null, ...r }
  } catch (error) {
    return { threw: true, error, result: null, dispatched, logs: [] }
  }
}

export const HASH = 'a'.repeat(64)
export const baseArgs = { projectDir: '/tmp/proj', planPath: '/tmp/plan.md', specHash: HASH, goal: 'g' }
export const task = (over = {}) => ({ id: 'T1', name: 'n', work: 'w', acceptance: 'a', ...over })

/**
 * Default replies: everything succeeds. Override per label to model failure or death.
 * @param over  {label-prefix or exact label: result|null}, plus `red: {before, after}` exit codes.
 *              `accept` maps a task id to its acceptanceCmd result ({exitCode, output} or null).
 *              `lens` is ONE value, not a map — there is one lens and its label is exactly `lens`.
 *              Pass null for a dead lens, or a LENS_SCHEMA object ({routes?, findings?, carried?,
 *              dispositions?}) for a lens that reported. Default: a lens that ran and found nothing.
 */
export function replies({ red = {}, impl = {}, verify = {}, lens, mech = {}, accept = {}, attempt = {}, rules = {} } = {}) {
  return (label, _prompt, _opts) => {
    const [kind, rest] = [label.split(':')[0], label.split(':').slice(1).join(':')]
    if (kind === 'implement') return impl[rest] !== undefined ? impl[rest] : { id: rest, done: true, changedFiles: ['x'], evidence: 'e' }
    if (kind === 'verify') return verify[rest] !== undefined ? verify[rest] : { id: rest, pass: true, evidence: 'e', failures: [] }
    // The single lens. `label` is the bare key, so there is no `rest` to route on.
    if (label === 'lens') return lens !== undefined ? lens : { routes: [], findings: [], carried: [], dispositions: [] }
    if (kind === 'attempt') return attempt[rest] !== undefined ? attempt[rest] : { key: rest, answer: 'default answer' }
    if (kind === 'mechanical' || kind === 'mech') return mech[rest] !== undefined ? mech[rest] : { name: rest, exitCode: 0, output: '' }
    if (kind === 'acceptance') return accept[rest] !== undefined ? accept[rest] : { exitCode: 0, output: 'ok' }
    if (kind === 'rules') return rules[rest] !== undefined ? rules[rest] : { name: rest, exitCode: 0, stdout: '{"verdicts":[],"unavailable":[]}' }
    if (kind === 'red') {
      // Labels are red:before:<id> / red:after:<id>. Default to the HEALTHY pair (fails before,
      // passes after) so a test that does not care about the red gate does not accidentally
      // assert on a red-not-red it never meant to create.
      const side = rest.split(':')[0]
      if (!(side in red)) return { name: rest, exitCode: side === 'before' ? 1 : 0, output: 'o' }
      const v = red[side]
      return v === null ? null : { name: rest, exitCode: v, output: 'o' }
    }
    return null
  }
}

/** Every carried finding ruled `closed` with evidence — the "the fixes landed" lens reply. */
export const closes = (ids, extra = {}) => ({
  routes: [], findings: [], dispositions: [],
  carried: ids.map(id => ({ id, status: 'closed', evidence: 'ran the command; it passes' })),
  ...extra,
})
