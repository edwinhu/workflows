/**
 * The non-vacuity convention (leg_counts.py, leg-counts.sh): every mechanical leg prints
 * `<leg>: N <unit> examined`, and a leg with no count line or a bare zero is COULD-NOT-CHECK.
 *
 *   work-checks.sh   audits every command's FULL output and turns an exit 0/1 into 2, naming the leg
 *   canary.sh        assertion 3 reads output through the same parser (no second regex)
 *   check.sh         every leg of the dev, ds, writing and workshop gates goes through legcount_run
 *   rule-check.ts    a rule whose inventory examined 0 over a covered file is unavailable, not MET
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from '../../../tests/helpers/tmp.ts'
import { unexamined } from './rule-check.ts'

const mkTmp = useTmp()
const HERE = import.meta.dir
const ROOT = join(HERE, '..', '..', '..')
const CHECKS = join(HERE, 'work-checks.sh')
const PY = join(HERE, 'leg_counts.py')

function checks(mechanical: { name: string; cmd: string }[]) {
  const dir = mkTmp('leg-counts-')
  const a = join(dir, 'args.json'), raw = join(dir, 'raw.json'), out = join(dir, 'checks.json')
  writeFileSync(a, JSON.stringify({ projectDir: dir, tasks: [] }))
  writeFileSync(raw, JSON.stringify({ stage: 'agents', agents: {}, checkPlan: { red: [], acceptance: [], mechanical } }))
  const r = spawnSync('bash', [CHECKS, a, raw, out], { encoding: 'utf8', timeout: 60_000 })
  return { out: (r.stdout || '') + (r.stderr || ''), checks: JSON.parse(readFileSync(out, 'utf8')) }
}
const mech = (r: ReturnType<typeof checks>, name: string) => r.checks.mechanical.find((m: any) => m.name === name)

describe('work-checks.sh fails a leg that examined nothing', () => {
  test('a leg with no count line turns exit 0 into 2, named in the output tail and the summary', () => {
    const r = checks([{ name: 'gate', cmd: `printf '=== leg: a\\na: 3 line(s) examined\\n=== leg: b\\nall clean\\n'` }])
    expect(mech(r, 'gate').exitCode).toBe(2)
    expect(mech(r, 'gate').output).toContain('COULD-NOT-CHECK: leg b printed no count line')
    expect(mech(r, 'gate').output).not.toContain('leg a printed')
    expect(r.out).toContain('work-checks: COULD-NOT-CHECK mechanical:gate leg b printed no count line')
  })

  test('a bare zero is 2 even over a violation exit; a workflows `leg NAME exit=` header counts as a leg', () => {
    const r = checks([
      { name: 'zero', cmd: `echo 'case-cites: 0 added (CP N) cite(s) examined in 1 file(s), clean'; exit 1` },
      { name: 'dev', cmd: `echo 'leg tests exit=0'` },
    ])
    expect(mech(r, 'zero').exitCode).toBe(2)
    expect(mech(r, 'zero').output).toContain('COULD-NOT-CHECK: leg case-cites examined 0 — vacuous')
    expect(mech(r, 'dev').exitCode).toBe(2)
    expect(mech(r, 'dev').output).toContain('leg tests printed no count line')
  })

  test('a zero that declares an empty scope, a counted leg and a plain command keep their own exit', () => {
    const r = checks([
      { name: 'scope', cmd: `echo 'american-english: 0 added line(s) examined in 1 file(s) — nothing in scope (no line added over HEAD), clean'` },
      { name: 'found', cmd: `printf '=== leg: a\\na: 9 line(s) examined\\n'; exit 1` },
      { name: 'plain', cmd: `echo ok` },
    ])
    expect(mech(r, 'scope').exitCode).toBe(0)
    expect(mech(r, 'found').exitCode).toBe(1)
    expect(mech(r, 'plain').exitCode).toBe(0)
    expect(r.out).not.toContain('COULD-NOT-CHECK')
  })

  test('the audit reads the FULL output: a header cut from the 60-line tail is still audited', () => {
    const r = checks([{ name: 'long', cmd: `echo '=== leg: early'; seq 1 100` }])
    expect(mech(r, 'long').exitCode).toBe(2)
    expect(mech(r, 'long').output.split('\n').length).toBe(60)
    expect(mech(r, 'long').output).toContain('leg early printed no count line')
  })
})

describe('one parser', () => {
  test('canary.sh assertion 3 imports leg_counts and carries no count regex of its own', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'canary.sh'), 'utf8')
    expect(src).toContain('from leg_counts import audit as leg_audit')
    expect(src).not.toMatch(/COUNT = re\.compile/)
    expect(readFileSync(CHECKS, 'utf8')).toContain('from leg_counts import audit')
  })

  test('leg_counts.py tests recognises the runners the gates use, and nothing else', () => {
    const count = (text: string, ...a: string[]) => {
      const f = join(mkTmp('leg-tests-'), 'out.txt')
      writeFileSync(f, text)
      return spawnSync('python3', [PY, 'tests', ...a, f], { encoding: 'utf8', timeout: 30_000 }).stdout.trim()
    }
    expect(count(' 1 pass\n 0 fail\nRan 1 test across 1 file. [7.00ms]\n')).toBe('1 bun')
    expect(count('==== 2 failed, 5 passed in 1.2s ====\n')).toBe('7 pytest')
    expect(count('5 passed, 1 warning in 0.12s\n')).toBe('5 pytest')
    expect(count('ok  \texample.com/a\t0.1s\nok  \texample.com/b\t(cached)\n?   \texample.com/c\t[no test files]\n')).toBe('2 go')
    expect(count('test result: ok. 4 passed; 1 failed; 0 ignored\n')).toBe('5 cargo')
    expect(count('all good\n')).toBe('')
    expect(count('checked 7 cases\n', '--re', 'checked (\\d+) cases')).toBe('7 custom')
  })
})

describe('every leg of every workflows check.sh goes through the audit', () => {
  // `report LEG STATUS` is how a leg reaches the verdict. Its status must be the audited LEG_STATUS
  // (or a literal derived from it, or an undeclared leg's 0, or a refusal's 2) — never `$?` or a
  // variable the audit did not set — and every leg reported must have been run by legcount_run.
  const GATES = ['dev', 'ds', 'writing', 'workshop'].map(s => join(ROOT, 'skills', s, 'scripts', 'check.sh'))
  for (const gate of GATES) {
    test(gate.split('/').slice(-3, -2)[0], () => {
      const src = readFileSync(gate, 'utf8')
      expect(src).toMatch(/^\. "\$HERE\/\.\.\/\.\.\/work\/scripts\/leg-counts\.sh"$/m)
      const reports = [...src.matchAll(/\breport ("?\$?[\w-]+"?) (\S+)/g)].filter(m => m[1] !== '()')
      expect(reports.length).toBeGreaterThan(0)
      for (const [, leg, status] of reports) {
        expect(['"$LEG_STATUS"', '0', '1', '2']).toContain(status)
        const name = leg.replace(/"/g, '')
        expect(src).toContain(`legcount_run ${name === '$name' ? '"$name"' : name} `)
      }
      for (const m of src.matchAll(/\breport ("?\$?[\w-]+"?) 0 "not declared"/g)) {
        expect(src).toMatch(/count_line "?\$?[\w-]+"? 0 "command\(s\)" "— nothing in scope \(not declared\)"/)
      }
    })
  }
})

describe('rule-check: an inventory that examined nothing is unavailable, never MET', () => {
  const state = (lines: number, extra: Record<string, unknown> = {}) => ({ files: [{ path: 'notes/18.typ', lines }], ...extra })

  test('the pure decision', () => {
    expect(unexamined({ state: state(500, { n: 0 }), examinedKey: 'n', examined: 0 })).toMatch(/examined 0 n in 1 covered file/)
    expect(unexamined({ state: state(500), examinedKey: 'n', examined: undefined })).toMatch(/carries no count n/)
    expect(unexamined({ state: state(500), examinedKey: 'n', examined: 3 })).toBeNull()
    expect(unexamined({ state: state(0), examinedKey: 'n', examined: 0 })).toBeNull()       // covers no non-empty file
    expect(unexamined({ state: state(500), examined: 0 })).toBeNull()                        // declares no EXAMINED
  })

  test('end to end: the zero-count rule is unavailable without a judge call; its sibling is judged', async () => {
    const dir = mkTmp('rule-unexamined-')
    const rules = join(dir, 'rules')
    mkdirSync(rules)
    const rule = (name: string, n: number) => writeFileSync(join(rules, `${name}.py`), [
      `PROPOSITION = 'Some item is wrong.'`,
      `CRITERIA = {'VIOLATED': 'an item is wrong', 'SATISFIED': 'every item is right'}`,
      `SPANS = ('items',)`,
      `EXAMINED = 'n_items'`,
      `def evidence(files, plan_lines=None):`,
      `    return {'files': [{'path': f[0], 'lines': 10} for f in files], 'items': [], 'n_items': ${n}}`,
      '',
    ].join('\n'))
    rule('R-EMPTY', 0)
    rule('R-READ', 4)
    const target = join(dir, 'notes.typ')
    writeFileSync(target, 'x\n'.repeat(10))
    let calls = 0
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.text(); calls++
        return new Response(JSON.stringify({ answers: { q0: { probabilities: { VIOLATED: 0.1 }, choice: 'MET' } } }))
      },
    })
    try {
      // Async: a spawnSync would block the event loop the stub judge answers on.
      const p = Bun.spawn(['bun', join(HERE, 'rule-check.ts'), '--files', target, '--rules', rules], {
        stdout: 'pipe', stderr: 'pipe',
        env: { ...process.env, WORK_HOLD_DECISIONS_URL: `http://localhost:${server.port}/`, WORK_HOLD_JUDGE_TOKEN: 't' },
      })
      const r = { stdout: await new Response(p.stdout).text(), status: await p.exited }
      const out = JSON.parse(r.stdout.trim().split('\n').pop()!)
      expect(out.unavailable).toEqual([{ rule: 'R-EMPTY', reason: expect.stringContaining('examined 0 n_items') }])
      expect(out.verdicts.map((v: any) => v.rule)).toEqual(['R-READ'])
      expect(calls).toBe(1)
      expect(r.status).toBe(1)
    } finally {
      server.stop(true)
    }
    expect(existsSync(target)).toBe(true)
  })
})
