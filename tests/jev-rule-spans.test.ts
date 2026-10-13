/**
 * Every WIRED rule in the workflows sets declares SPANS, so a VIOLATED verdict names the lines it was
 * judged over instead of a file-level verdict a repair cannot act on. Each rule's own violating twin
 * from the calibration manifest runs through the real extractor and rule-check.ts; only the judge is
 * a stub that returns VIOLATED for every rule.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
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

// rule-check children in flight, and the synchronous spawns this file ran while any was: the stub judge
// answers on this event loop, so each such spawn stalls a child's judge call, and one that never returns
// leaves bun's per-test timeout no loop to fire on (the file then hangs to scripts/test.sh's wall cap)
let live = 0
let syncWhileLive = 0

/** Each rules directory's owning workflows, from ONE walk of the layout: the layout's answer, not a table
 *  (writing/legal for checks/writing/legal/rules). A level with no rules of its own (writing/general)
 *  inherits its parent's as its last ruleDir, so it does not count as an owner. */
let owners: Map<string, string[]> | undefined
function workflowOfDir(dir: string): string {
  if (!owners) {
    const found = new Map<string, string[]>()
    const walk = (rel: string) => {
      for (const n of readdirSync(join(ROOT, 'checks', rel))) {
        const p = rel ? `${rel}/${n}` : n
        if (/^[_.]/.test(n) || n === 'constraints' || n === 'rules' || !statSync(join(ROOT, 'checks', p)).isDirectory()) continue
        const r = spawnSync('python3', [join(ROOT, 'bin', 'workflow-check'), p, '--list'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, WORKFLOW_CHECKS_PATH: ROOT } })
        const own = resolve(ROOT, 'checks', p, 'rules')
        if (r.status === 0 && JSON.parse(r.stdout).ruleDirs.at(-1) === own) found.set(own, [...(found.get(own) ?? []), p])
        walk(p)
      }
    }
    walk('')
    owners = found
  }
  const found = owners.get(resolve(ROOT, dir)) ?? []
  expect(found, `the workflow owning ${dir}`).toHaveLength(1)
  return found[0]!
}

function wiredRules(spec: any): [string, any][] {
  return Object.entries<any>(spec.rules).filter(([rule]) => existsSync(join(ROOT, spec.rulesDir, `${rule}.py`)))
}

// rule-check.ts's argv for `rule`'s first violating case. Synchronous (git, workflow-check), so every
// case is prepared before the first child starts.
function prepare(spec: any, cases: any[], temps: string[]) {
  if (live) syncWhileLive++
  const c = cases.find(x => x.kind === 'violating')
  const input = caseInput(spec.layout, resolve(ROOT, c.path), temps, c.base && resolve(ROOT, c.base))
  const args = [RULE_CHECK, '--workflow', workflowOfDir(spec.rulesDir), '--files', ...input.files]
  if (input.plan) args.push('--plan', input.plan)
  if (input.changed) {
    const f = join(mkTmp('rule-spans-changed-'), 'changed.json')
    writeFileSync(f, JSON.stringify(input.changed))
    args.push('--changed-lines', f)
  }
  return { case: c.path, args }
}

// the verdict rule-check.ts gives `rule`; async, because the stub judge answers on this event loop.
// The spawn's own timeout fails a stuck child here, inside the test's.
async function violatedVerdict(rule: string, job: { case: string; args: string[] }) {
  live++
  try {
    const p = Bun.spawn(['bun', ...job.args], {
      stdout: 'pipe', stderr: 'pipe', timeout: 90_000,
      env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: 't', WORKFLOW_CHECKS_PATH: ROOT },
    })
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    expect({ code, signal: p.signalCode, err }).toEqual({ code: 2, signal: null, err: '' })
    return { case: job.case, verdict: JSON.parse(out).verdicts.find((v: any) => v.rule === rule) }
  } finally {
    live--
  }
}

for (const [set, spec] of Object.entries<any>(manifest.sets)) {
  test(`${set}: every wired rule's VIOLATED verdict carries file:line spans`, async () => {
    const rules = wiredRules(spec)
    expect(rules.length).toBeGreaterThan(0)
    const missing: string[] = []
    const temps: string[] = []
    let found
    try {
      const jobs = rules.map(([, cases]) => prepare(spec, cases, temps))
      found = await Promise.all(rules.map(([rule], i) => violatedVerdict(rule, jobs[i]!)))
    } finally {
      for (const d of temps) rmSync(d, { recursive: true, force: true })
    }
    for (const [i, [rule]] of rules.entries()) {
      const got = found[i]
      expect(got.verdict?.verdict).toBe('VIOLATED')
      const spans: string[] = got.verdict?.spans ?? []
      if (!spans.length || !spans.every(s => /:\d+$/.test(s))) missing.push(`${rule} (${got.case}): ${JSON.stringify(spans)}`)
    }
    expect(missing).toEqual([])
    expect(syncWhileLive, 'synchronous spawns run while a rule-check child waited on this loop').toBe(0)
  }, 150_000)
}
