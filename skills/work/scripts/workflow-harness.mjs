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
 * Run workflow.js under stubs.
 * @param args      the args object the workflow receives
 * @param agentReply (label, prompt, opts) => result | null   — null models a dead/skipped agent
 * @param overrides  replace a hook wholesale, e.g. {pipeline: () => Promise.reject(...)}. The
 *                   default stubs swallow a per-ITEM throw, so a LEG-level rejection — what a real
 *                   dispatcher does on budget exhaustion — is only reachable by replacing the hook.
 * @returns {{result, dispatched: string[], logs: string[], prompts: Map<string,string>}}
 */
export async function run(args, agentReply, path = WORKFLOW, overrides = {}) {
  const dispatched = []
  const logs = []
  const prompts = new Map()
  const agent = async (prompt, opts) => {
    dispatched.push(opts.label)
    prompts.set(opts.label, prompt)
    return agentReply(opts.label, prompt, opts)
  }
  const phase = () => {}
  // Sequential, but a throwing thunk resolves to null — the contract parallel() actually offers.
  const parallel = async thunks => {
    const out = []
    for (const th of thunks) {
      try { out.push(await th()) } catch { out.push(null) }
    }
    return out
  }
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
  const hooks = { agent, phase, parallel, pipeline, log, ...overrides }
  const result = await load(path)(args, hooks.agent, hooks.phase, hooks.parallel, hooks.pipeline, hooks.log)
  return { result, dispatched, logs, prompts }
}

/** Throws-or-not, without losing what got dispatched first. */
export async function runCatching(args, agentReply, path = WORKFLOW) {
  const dispatched = []
  try {
    const r = await run(args, (l, p, o) => { dispatched.push(l); return agentReply(l, p, o) }, path)
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
 */
export function replies({ red = {}, impl = {}, verify = {}, lens = {}, mech = {}, refute } = {}) {
  return (label, _prompt, _opts) => {
    const [kind, rest] = [label.split(':')[0], label.split(':').slice(1).join(':')]
    if (kind === 'implement') return impl[rest] !== undefined ? impl[rest] : { id: rest, done: true, changedFiles: ['x'], evidence: 'e' }
    if (kind === 'verify') return verify[rest] !== undefined ? verify[rest] : { id: rest, pass: true, evidence: 'e', failures: [] }
    if (kind === 'lens') return lens[rest] !== undefined ? lens[rest] : { findings: [] }
    if (kind === 'mechanical' || kind === 'mech') return mech[rest] !== undefined ? mech[rest] : { name: rest, exitCode: 0, output: '' }
    if (kind === 'red') {
      // Labels are red:before:<id> / red:after:<id>. Default to the HEALTHY pair (fails before,
      // passes after) so a test that does not care about the red gate does not accidentally
      // assert on a red-not-red it never meant to create.
      const side = rest.split(':')[0]
      if (!(side in red)) return { name: rest, exitCode: side === 'before' ? 1 : 0, output: 'o' }
      const v = red[side]
      return v === null ? null : { name: rest, exitCode: v, output: 'o' }
    }
    if (kind === 'refute') return refute !== undefined ? refute : { refuted: true, reason: 'r' }
    return null
  }
}
