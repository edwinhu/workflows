// <!-- wc-probe: ignore-refs -->
// Fixtures below are executed, not declared: the task and lens literals are INPUTS to workflow.js.
/**
 * The third-party runners are retired; lensProvider replaces them.
 *
 *   any args.thirdParty key (including [])  -> throws at arg validation, before any agent() call,
 *   any args.thirdPartyEffort key              and the message names lensProvider
 *   a normal run                            -> no `third-party:` label is dispatched, the result has
 *                                              no `thirdParty` key and scoreTable has no
 *                                              `thirdPartyAdvisoryFindings`
 *
 * The dispatcher resolves lensProvider to a model and hands it over as args.lensModel (with
 * routing {source:'flag', provider, lens}); those args must be accepted. Which model the lens then
 * runs on is NOT pinned: the spec does not say whether args.lensModel should beat the lens's own
 * 'sonnet' default, and today it does not.
 *
 * Run: bun test ./skills/work/scripts/workflow-lens-provider.test.ts
 */
import { test, expect, describe, setDefaultTimeout } from 'bun:test'
import { run, runCatching, baseArgs, task, replies } from './workflow-harness.mjs'

setDefaultTimeout(60_000)

/** Every leg a run can have short of scored checks: red-gated task, a mechanical check, the lens. */
const fullRun = (over: any = {}) => ({
  ...baseArgs,
  tasks: [task({ redCommand: 'bash scripts/check.sh' })],
  mechanicalChecks: [{ name: 'tests', cmd: 'bun test' }],
  lens: { prompt: 'raise MAJOR when the work is wrong', refs: [] },
  ...over,
})

describe('a retired third-party arg throws before anything is dispatched', () => {
  const RETIRED: [string, object][] = [
    ["thirdParty: ['codex']", { thirdParty: ['codex'] }],
    ["thirdParty: ['codex', 'gemini']", { thirdParty: ['codex', 'gemini'] }],
    ['thirdParty: [] (the key alone is enough)', { thirdParty: [] }],
    ["thirdPartyEffort: 'low'", { thirdPartyEffort: 'low' }],
    ['thirdPartyEffort: null', { thirdPartyEffort: null }],
  ]
  for (const [name, over] of RETIRED) {
    test(`${name}: throws, names lensProvider, dispatches nothing`, async () => {
      const r = await runCatching(fullRun(over), replies())
      expect(r.threw).toBe(true)
      expect(String(r.error)).toMatch(/lensProvider/)
      expect(r.dispatched).toEqual([])
    })
  }
})

describe('a normal run carries no trace of the third-party leg', () => {
  test("no 'third-party:' label is dispatched", async () => {
    const { dispatched } = await run(fullRun(), replies())
    expect(dispatched.filter((l: string) => l.startsWith('third-party:'))).toEqual([])
    // The run did reach its legs, so the absence above is not an empty run.
    expect(dispatched).toContain('lens')
    expect(dispatched).toContain('implement:T1')
  })

  test('the result has no thirdParty key', async () => {
    const { result } = await run(fullRun(), replies())
    expect(Object.keys(result)).not.toContain('thirdParty')
  })

  test('scoreTable has no thirdPartyAdvisoryFindings', async () => {
    const { result } = await run(fullRun(), replies())
    expect(result.scoreTable).toBeDefined()
    expect(Object.keys(result.scoreTable)).not.toContain('thirdPartyAdvisoryFindings')
  })

  test('the dispatcher hand-over — lensProvider, lensModel, flag routing with a lens decision — is accepted and runs', async () => {
    const decision = {
      provider: 'codex', model: 'gpt-6.1-sol', kind: 'review', candidate: 'sol', source: 'table',
      shadow: { unavailable: 'provider-constrained row: codex' },
    }
    const r = await runCatching(fullRun({
      lensProvider: 'codex', lensModel: 'gpt-6.1-sol',
      routing: { source: 'flag', provider: 'claude', lens: decision },
    }), replies())
    expect({ threw: r.threw, error: r.threw ? String(r.error) : null }).toEqual({ threw: false, error: null })
    expect(r.dispatched).toContain('lens')
    expect(r.dispatched.filter((l: string) => l.startsWith('third-party:'))).toEqual([])
  })
})
