/**
 * Every WIRED rule in the workflows sets declares SPANS, so a VIOLATED verdict names the lines it was
 * judged over instead of a file-level verdict a repair cannot act on. Each rule's own violating twin
 * from the calibration manifest runs through the real extractor and rule-check.ts; only the judge is
 * a stub that returns VIOLATED for every rule.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { caseInput } from '../skills/work/scripts/rule-calibrate.ts'
import { useTmp } from './helpers/tmp.ts'

const ROOT = resolve(import.meta.dir, '..')
const RULE_CHECK = join(ROOT, 'skills/work/scripts/rule-check.ts')
const manifest = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/jev/calibration.json'), 'utf8'))
const mkTmp = useTmp()

let server: ReturnType<typeof Bun.serve>
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.text()
      return new Response(JSON.stringify({ answers: { q0: { probabilities: { VIOLATED: 0.94 } } } }))
    },
  })
})
afterAll(() => server.stop(true))

function wiredRules(spec: any): [string, any][] {
  return Object.entries<any>(spec.rules).filter(([rule]) => existsSync(join(ROOT, spec.rulesDir, `${rule}.py`)))
}

// the verdict rule-check.ts gives `rule` on its first violating case
// async: the stub judge answers on this process's event loop, which a spawnSync would block
async function violatedVerdict(spec: any, rule: string, cases: any[]) {
  const c = cases.find(x => x.kind === 'violating')
  const temps: string[] = []
  try {
    const input = caseInput(spec.layout, resolve(ROOT, c.path), temps, c.base && resolve(ROOT, c.base))
    const args = [RULE_CHECK, '--rules', join(ROOT, spec.rulesDir), '--files', ...input.files]
    if (input.plan) args.push('--plan', input.plan)
    if (input.changed) {
      const f = join(mkTmp('rule-spans-changed-'), 'changed.json')
      writeFileSync(f, JSON.stringify(input.changed))
      args.push('--changed-lines', f)
    }
    const p = Bun.spawn(['bun', ...args], {
      stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: 't' },
    })
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    expect({ code, err }).toEqual({ code: 2, err: '' })
    return { case: c.path, verdict: JSON.parse(out).verdicts.find((v: any) => v.rule === rule) }
  } finally {
    for (const d of temps) rmSync(d, { recursive: true, force: true })
  }
}

for (const [set, spec] of Object.entries<any>(manifest.sets)) {
  test(`${set}: every wired rule's VIOLATED verdict carries file:line spans`, async () => {
    const rules = wiredRules(spec)
    expect(rules.length).toBeGreaterThan(0)
    const missing: string[] = []
    const found = await Promise.all(rules.map(([rule, cases]) => violatedVerdict(spec, rule, cases)))
    for (const [i, [rule]] of rules.entries()) {
      const got = found[i]
      expect(got.verdict?.verdict).toBe('VIOLATED')
      const spans: string[] = got.verdict?.spans ?? []
      if (!spans.length || !spans.every(s => /:\d+$/.test(s))) missing.push(`${rule} (${got.case}): ${JSON.stringify(spans)}`)
    }
    expect(missing).toEqual([])
  }, 120_000)
}
