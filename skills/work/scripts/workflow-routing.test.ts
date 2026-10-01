// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task and lens literals are INPUTS to workflow.js.
/**
 * workflow.js picks each leg's model from args.routing.kindModels, the per-kind map work-dispatch
 * resolves through route.ts.
 *
 * Precedence, highest first:
 *   1. an explicit model in args — implementerModel, verifierModel, probeModel, lens.model;
 *   2. args.routing.kindModels — the implementer takes kindModels[task.kind ?? 'judgement'], the
 *      verifier and every probe (red, mechanical, third-party) take kindModels.script, and the lens
 *      takes kindModels.review;
 *   3. today's defaults — probe sonnet, verifier sonnet, implementer inherit, lens sonnet. Those are
 *      already pinned by workflow.test.ts ("the lens defaults to sonnet…") and are not restated here.
 *
 * task.kind, when present, is one of script|judgement|review|bulk; anything else throws at run start
 * and names the task.
 *
 * The map's values are sentinels no default could produce, so a leg that reads the wrong source shows
 * as the wrong string rather than as a plausible model id.
 *
 * Run: bun test ./skills/work/scripts/workflow-routing.test.ts
 */
import { test, expect, describe, setDefaultTimeout } from 'bun:test'
import { run, runCatching, baseArgs, task, replies } from './workflow-harness.mjs'

setDefaultTimeout(60_000)

const KIND_MODELS = { judgement: 'judgement-model', script: 'script-model', review: 'review-model' }
const routing = (kindModels: Record<string, string> = KIND_MODELS) => ({
  kindModels, source: 'table', decisions: {},
})

/** One run that dispatches every routed leg: implement, verify, red before/after, mechanical, third-party, lens. */
const allLegs = (over: any = {}, taskOver: any = {}) => ({
  ...baseArgs,
  tasks: [task({ redCommand: 'bash scripts/check.sh', ...taskOver })],
  mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
  thirdParty: ['codex'],
  lens: { prompt: 'raise MAJOR when the work is wrong', refs: [] },
  routing: routing(),
  ...over,
})

const dispatchOpts = async (args: any) => {
  const opts = new Map<string, any>()
  const reply = replies()
  await run(args, (label: string, prompt: string, o: any) => { opts.set(label, o); return reply(label, prompt, o) })
  return opts
}

const PROBES = ['red:before:T1', 'red:after:T1', 'mechanical:tests', 'third-party:codex']

describe('kindModels routes each leg when no explicit model is given', () => {
  test('the implementer of a kind-less task takes kindModels.judgement', async () => {
    const opts = await dispatchOpts(allLegs())
    expect(opts.get('implement:T1')?.model).toBe('judgement-model')
  })

  test("the implementer of a task with kind takes that kind's model", async () => {
    const opts = await dispatchOpts(allLegs({}, { kind: 'script' }))
    expect(opts.get('implement:T1')?.model).toBe('script-model')
    const review = await dispatchOpts(allLegs({}, { kind: 'review' }))
    expect(review.get('implement:T1')?.model).toBe('review-model')
  })

  test('the verifier takes kindModels.script', async () => {
    const opts = await dispatchOpts(allLegs())
    expect(opts.get('verify:T1')?.model).toBe('script-model')
  })

  test('every probe — red before/after, mechanical, third-party — takes kindModels.script', async () => {
    const opts = await dispatchOpts(allLegs())
    for (const label of PROBES) {
      expect(opts.has(label)).toBe(true)
      expect({ label, model: opts.get(label)?.model }).toEqual({ label, model: 'script-model' })
    }
  })

  test('the lens takes kindModels.review over its own sonnet default', async () => {
    const opts = await dispatchOpts(allLegs())
    expect(opts.get('lens')?.model).toBe('review-model')
  })
})

describe('an explicit model in args beats kindModels, leg by leg', () => {
  test('implementerModel wins for the implementer; the other legs still route', async () => {
    const opts = await dispatchOpts(allLegs({ implementerModel: 'explicit-impl' }))
    expect(opts.get('implement:T1')?.model).toBe('explicit-impl')
    expect(opts.get('verify:T1')?.model).toBe('script-model')
    expect(opts.get('lens')?.model).toBe('review-model')
  })

  test('implementerModel wins over a task kind too', async () => {
    const opts = await dispatchOpts(allLegs({ implementerModel: 'explicit-impl' }, { kind: 'script' }))
    expect(opts.get('implement:T1')?.model).toBe('explicit-impl')
    expect(opts.get('verify:T1')?.model).toBe('script-model')
  })

  test('verifierModel wins for the verifier; the probes still route', async () => {
    const opts = await dispatchOpts(allLegs({ verifierModel: 'explicit-verify' }))
    expect(opts.get('verify:T1')?.model).toBe('explicit-verify')
    for (const label of PROBES) expect({ label, model: opts.get(label)?.model }).toEqual({ label, model: 'script-model' })
    expect(opts.get('implement:T1')?.model).toBe('judgement-model')
  })

  test('probeModel wins for every probe; the verifier still routes', async () => {
    const opts = await dispatchOpts(allLegs({ probeModel: 'explicit-probe' }))
    for (const label of PROBES) expect({ label, model: opts.get(label)?.model }).toEqual({ label, model: 'explicit-probe' })
    expect(opts.get('verify:T1')?.model).toBe('script-model')
    expect(opts.get('implement:T1')?.model).toBe('judgement-model')
  })

  test("lens.model wins for the lens; the implementer still routes", async () => {
    const opts = await dispatchOpts(allLegs({ lens: { prompt: 'p', refs: [], model: 'explicit-lens' } }))
    expect(opts.get('lens')?.model).toBe('explicit-lens')
    expect(opts.get('implement:T1')?.model).toBe('judgement-model')
  })
})

describe('task.kind is validated at run start', () => {
  test('an unknown kind throws, names the task, and dispatches nothing', async () => {
    const r = await runCatching({
      ...baseArgs, routing: routing(),
      tasks: [task(), task({ id: 'T7', kind: 'bogus' })],
    }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/T7/)
    expect(String(r.error)).toMatch(/kind/)
    expect(r.dispatched).toEqual([])
  })

  test('an unknown kind throws even without a routing map', async () => {
    const r = await runCatching({ ...baseArgs, tasks: [task({ id: 'T7', kind: 'Script' })] }, replies())
    expect(r.threw).toBe(true)
    expect(String(r.error)).toMatch(/T7/)
  })

  test('each of the four kinds is accepted (bulk included) and the run reaches its legs', async () => {
    // Paired with the routed assertion so this is RED today: acceptance alone already holds.
    for (const kind of ['script', 'judgement', 'review', 'bulk']) {
      const r = await runCatching({
        ...baseArgs, routing: routing({ ...KIND_MODELS, bulk: 'bulk-model' }), tasks: [task({ kind })],
      }, replies())
      expect({ kind, threw: r.threw }).toEqual({ kind, threw: false })
      expect({ kind, model: (r as any).optsMap?.get?.('implement:T1')?.model }).toEqual({ kind, model: `${kind}-model` })
    }
  })
})
