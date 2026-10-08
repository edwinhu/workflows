import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { failingLegs, runFacts, runRounds, redispatchBlocked, lastLedgerEntry } from '../hooks/work-hold'
import { useTmp } from './helpers/tmp.ts'

const mkTmp = useTmp()
setDefaultTimeout(60_000)

const HOOK = join(import.meta.dir, '..', 'hooks', 'work-hold.ts')
const DISPATCH = join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-dispatch.sh')

// The secreg 1002-notes-18-repair-b verdict, cut to the fields the hold reads (2026-10-02). The goal
// excluded `hierarchy`, and it was the only failing leg; the lens left nothing blocking.
const GOAL =
  'Repair notes/18-insider.typ so that check.sh for lecture 18 names no failing leg other than hierarchy ' +
  "(a deck-side leg outside this run's write surface) and the notes-auditor lens returns no surviving " +
  'critical or major finding.'
const CHECK_TAIL = (legs: string[]) =>
  '=== leg: require-notes-inputs\nok: notes notes/18-insider.typ\n=== check: 1 lecture(s), 11 legs\n' +
  'check: FAIL (exit 1) — failing leg(s):\n' + legs.map((l) => `  - ${l}\n`).join('') +
  'advisory: poll-candidates and already-answered listed above — neither gates\n'
const result = (legs: string[], survivingBlocking = 0) => ({
  verdict: 'FAIL',
  overallPass: false,
  mechanical: [{ name: 'notes-mech', exitCode: 1, output: CHECK_TAIL(legs) }],
  red: [{ id: 'r18-style', command: 'bash check.sh --course . --lecture 18', verdict: 'green-not-green',
          beforeExit: 1, afterExit: 1, afterOutput: CHECK_TAIL(legs) }],
  scoreTable: { survivingBlocking, survivingMinor: 0, lensFindings: survivingBlocking },
  lensesThatFlagged: [],
  rulesThatFailed: ['N-UNCITED'],
  tasksThatFlagged: ['r18-style', 'r18-cover'],
  planFindings: [
    { failure: 'red:r18-style — owner r18-style', ownerTask: 'plan' },
    { failure: 'mechanical:notes-mech — owner r18-align', ownerTask: 'plan' },
  ],
})

const taskRouted = () => ({
  ...result(['alignment (exit 1)']),
  routes: [{ failure: 'rules:jev-notes-rules — owner unrouted (route it)', ownerTask: 'r18-cover' }],
})

/** A landed run: a plan with a dispatch block, args.json pinned to its hash, and a verdict. */
const TASKS = [{ id: 'r18-cover', writablePaths: ['notes/18.typ'], acceptance: 'true' }]
function landedRun(dir: string, res: object, o: { rounds?: number; amended?: boolean } = {}) {
  const plan = join(dir, 'plan.md')
  writeFileSync(plan, '# p\n<!-- work:dispatch\n{"goal":"g","tasks":[]}\n-->\n')
  const hash = spawnSync('bash', [DISPATCH, '--spec-hash', plan], { encoding: 'utf8', timeout: 30_000 }).stdout.trim()
  expect(hash).toMatch(/^[0-9a-f]{64}$/)
  if (o.amended) writeFileSync(plan, '# p\n<!-- work:dispatch\n{"goal":"g2","tasks":[]}\n-->\n')
  const run = join(dir, 'run')
  mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'args.json'), JSON.stringify({ planPath: plan, specHash: hash, rounds: o.rounds ?? 1, tasks: TASKS }))
  writeFileSync(join(run, 'result.json'), JSON.stringify(res))
  return run
}

/** A Decisions stub that records each request body and answers `noul`. Out of process. */
function stubJev(port: number, noul: number, log: string) {
  const code = `
import json, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        open(${JSON.stringify(log)}, "a").write(self.rfile.read(n).decode() + "\\n")
        b = json.dumps({"answers":{"met":{"type":"noul","noul":${noul}}}}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`
  return Bun.spawn(['python3', '-c', code], { stdout: 'ignore', stderr: 'ignore' })
}

/** One Stop through the real hook, with a check-less hold on `run`, judged by the stub on `port`. */
function stop(dir: string, sid: string, hold: object, port: number) {
  const path = join(dir, `work-hold-${sid}.json`)
  if (!existsSync(path))
    writeFileSync(path, JSON.stringify({
      check: '', goal: GOAL, startedAt: Math.floor(Date.now() / 1000),
      ceilingMinutes: 720, maxRounds: 6, rounds: 0, ...hold,
    }))
  const transcript = join(dir, 't.jsonl')
  writeFileSync(transcript, JSON.stringify({ message: { content: 'work-loop: FAIL on round 1\nverdict: FAIL  (overallPass=false)' } }) + '\n')
  const r = spawnSync('bun', [HOOK], {
    timeout: 120_000, encoding: 'utf8',
    input: JSON.stringify({ session_id: sid, transcript_path: transcript }),
    env: {
      ...HERMETIC_ENV, TMPDIR: dir, XDG_RUNTIME_DIR: '/nonexistent-so-no-agenix-key',
      WORK_HOLD_JUDGE_TOKEN: 'test-token',
      WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
      WORK_HOLD_JUDGE_URL: 'http://127.0.0.1:1/v1/chat/completions',
    },
  })
  return { ...r, path, state: existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null }
}

const sent = (log: string) => readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

describe('item 20: the judge reads the facts the goal names, not only overallPass', () => {
  test('failingLegs reads check.sh\'s list, and nothing else', () => {
    expect(failingLegs(CHECK_TAIL(['hierarchy (exit 1)']))).toEqual(['hierarchy (exit 1)'])
    expect(failingLegs(CHECK_TAIL(['alignment (exit 1)', 'hierarchy (exit 1)']))).toEqual(['alignment (exit 1)', 'hierarchy (exit 1)'])
    expect(failingLegs('check: PASS')).toEqual([])
  })

  test('runFacts names each failing leg, survivingBlocking and the failed rules, and labels overallPass last', () => {
    const dir = mkTmp('judgefacts-')
    const f = runFacts(landedRun(dir, result(['hierarchy (exit 1)'])))
    expect(f).toContain('mechanical check notes-mech: exit 1; failing leg(s), as the check names them: hierarchy (exit 1)')
    expect(f).toContain('red command r18-style')
    expect(f).toContain('exit 1 after the round (it exited 1 before)')
    expect(f).not.toContain('green-not-green')
    expect(f).toContain('survivingBlocking 0')
    expect(f).toContain('rules that failed: N-UNCITED')
    const lines = f.split('\n')
    expect(lines[lines.length - 1]).toContain('overallPass=false) — this aggregates EVERY gate')
  })

  test('the state sent to Jev LEADS with the run facts, and the question is the goal against them', async () => {
    const dir = mkTmp('judgefacts-')
    const run = landedRun(dir, result(['hierarchy (exit 1)']))
    const log = join(dir, 'jev.log')
    const port = 18831
    const srv = stubJev(port, 0.9, log)
    await Bun.sleep(700)
    const r = stop(dir, 'facts-met', { run }, port)
    srv.kill()
    const [body] = sent(log)
    expect(body.state.startsWith('RUN FACTS')).toBe(true)
    expect(body.state).toContain('hierarchy (exit 1)')
    expect(body.state).toContain('survivingBlocking 0')
    expect(body.state.indexOf('hierarchy (exit 1)')).toBeLessThan(body.state.indexOf('overallPass=false'))
    // facts ONLY: the transcript's paraphrase ("overallPass=false") is what pulled the score down
    expect(body.state).not.toContain('MOST RECENT TURNS')
    expect(body.questions.met.instructions).toContain('Judged ONLY against the RUN FACTS')
    expect(body.questions.met.instructions).toContain('every condition this goal states holds')
    expect(body.questions.met.instructions).toContain(GOAL)
    expect(lastLedgerEntry(join(dir, 'work-hold-facts-met.releases.log'))?.verb).toBe('passed-goal-met')
    expect(r.state).toBeNull()
  }, 30000)

  test('a NON-excluded failing leg reaches the judge by name', async () => {
    const dir = mkTmp('judgefacts-')
    const run = landedRun(dir, result(['alignment (exit 1)', 'hierarchy (exit 1)']))
    const log = join(dir, 'jev.log')
    const port = 18832
    const srv = stubJev(port, 0.1, log)
    await Bun.sleep(700)
    const r = stop(dir, 'facts-unmet', { run }, port)
    srv.kill()
    expect(sent(log)[0].state).toContain('alignment (exit 1), hierarchy (exit 1)')
    expect(JSON.parse(r.stdout).decision).toBe('block')
  }, 30000)
})

describe('a hold that watches NO run keeps the transcript judge and its two-clause question', () => {
  test('state is the transcript, question is "met AND no obvious open work"', async () => {
    const dir = mkTmp('judgefacts-')
    const log = join(dir, 'jev.log')
    const port = 18837
    const srv = stubJev(port, 0.1, log)
    await Bun.sleep(700)
    stop(dir, 'no-run', {}, port)
    srv.kill()
    const [body] = sent(log)
    expect(body.state).toContain('MOST RECENT TURNS')
    expect(body.state).not.toContain('RUN FACTS')
    expect(body.questions.met.instructions).toContain('This goal is met AND no obvious open work remains')
  }, 30000)
})

describe('item 20b: no redispatch advice when the redispatch is refused at Tier 1', () => {
  test('plan-routed items under an unchanged spec hash: the block says what blocks, not "redispatch"', async () => {
    const dir = mkTmp('judgetier1-')
    const run = landedRun(dir, result(['alignment (exit 1)']))
    const port = 18833
    const srv = stubJev(port, 0.1, join(dir, 'jev.log'))
    await Bun.sleep(700)
    const r = stop(dir, 'tier1', { run, authority: 'A.', continuation: 'C.' }, port)
    srv.kill()
    const reason = JSON.parse(r.stdout).reason
    expect(reason).not.toContain('advance it with `work-redispatch.sh')
    expect(reason).toContain('Do NOT redispatch')
    expect(reason).toContain('Tier 1 gate')
    expect(reason).toContain('red:r18-style — owner r18-style')
  }, 30000)

  test('once the plan is amended (new hash) the redispatch advice comes back', () => {
    const dir = mkTmp('judgetier1-')
    const run = landedRun(dir, result(['alignment (exit 1)']), { amended: true })
    expect(redispatchBlocked({ run })).toBe('')
  })

  test('a failure routed to a TASK lets the round proceed, so the advice stays', () => {
    const dir = mkTmp('judgetier1-')
    const run = landedRun(dir, taskRouted())
    expect(redispatchBlocked({ run })).toBe('')
  })

  // The hook mirrors work-redispatch.sh's gate; this runs the script itself (dry, gates only) on
  // the same three fixtures, so a change to either side that the other misses goes red here.
  test.each([
    ['plan-only, unchanged hash', () => result(['alignment (exit 1)']), {}],
    ['a failure routed to a task', taskRouted, {}],
    ['plan amended', () => result(['alignment (exit 1)']), { amended: true }],
  ] as const)('the hook and work-redispatch.sh agree: %s', (_l, res, o) => {
    const dir = mkTmp('judgexchk-')
    const run = landedRun(dir, res(), o)
    const g = spawnSync('bash', [join(import.meta.dir, '..', 'skills', 'work', 'scripts', 'work-redispatch.sh'),
      join(dir, 'plan.md'), join(run, 'args.json'), '--dispatch', '--no-lint', '--provider', 'claude'], {
      cwd: dir, encoding: 'utf8', timeout: 60_000,
      env: { ...HERMETIC_ENV, TMPDIR: dir, WORK_REDISPATCH_DRYRUN: '1' },
    })
    const refused = g.status === 3 && g.stderr.includes('BLOCKED:')
    expect(redispatchBlocked({ run }) !== '').toBe(refused)
  })
})

describe('item 21: a round is a DISPATCH, not a Stop', () => {
  test('two UNMET Stops with no dispatch between them leave the round count where args.json has it', async () => {
    const dir = mkTmp('judgerounds-')
    const run = landedRun(dir, result(['alignment (exit 1)']), { amended: true })
    const port = 18834
    const srv = stubJev(port, 0.1, join(dir, 'jev.log'))
    await Bun.sleep(700)
    const a = stop(dir, 'rounds', { run }, port)
    const b = stop(dir, 'rounds', {}, port)
    // a redispatch actually ran: the run's own counter advances, and so does the hold's
    const args = JSON.parse(readFileSync(join(run, 'args.json'), 'utf8'))
    writeFileSync(join(run, 'args.json'), JSON.stringify({ ...args, rounds: 2 }))
    const c = stop(dir, 'rounds', {}, port)
    srv.kill()
    expect(JSON.parse(a.stdout).reason).toContain('1/6 rounds dispatched')
    expect(JSON.parse(b.stdout).reason).toContain('1/6 rounds dispatched')
    expect(JSON.parse(b.stdout).reason).not.toContain('Round 2/6')
    expect(b.state.rounds).toBe(1)
    expect(JSON.parse(c.stdout).reason).toContain('2/6 rounds dispatched')
    expect(c.state.rounds).toBe(2)
    expect(runRounds({ run })).toBe(2)
  }, 60000)

  test('six Stops do not expire a hold whose run dispatched one round', async () => {
    const dir = mkTmp('judgerounds-')
    const run = landedRun(dir, result(['alignment (exit 1)']), { amended: true })
    const port = 18835
    const srv = stubJev(port, 0.1, join(dir, 'jev.log'))
    await Bun.sleep(700)
    let last = stop(dir, 'drain', { run }, port)
    for (let i = 0; i < 6; i++) last = stop(dir, 'drain', {}, port)
    srv.kill()
    expect(JSON.parse(last.stdout).decision).toBe('block')
    expect(lastLedgerEntry(join(dir, 'work-hold-drain.releases.log'))).toBeNull()
  }, 60000)

  test('the run in flight on its LAST allowed round is not expired by the round ceiling', () => {
    const dir = mkTmp('judgerounds-')
    const run = landedRun(dir, result([]), { rounds: 6 })
    // a redispatch rotated result.json away: the round is in flight
    spawnSync('mv', [join(run, 'result.json'), join(run, 'result-round5.json')], { timeout: 30_000 })
    const r = stop(dir, 'inflight', { run }, 1)
    expect(r.stdout).toBe('')
    expect(r.state).not.toBeNull()
    expect(lastLedgerEntry(join(dir, 'work-hold-inflight.releases.log'))).toBeNull()
  })

  test('the round ceiling still binds on dispatched rounds', async () => {
    const dir = mkTmp('judgerounds-')
    const run = landedRun(dir, result(['alignment (exit 1)']), { rounds: 6, amended: true })
    const port = 18836
    const srv = stubJev(port, 0.1, join(dir, 'jev.log'))
    await Bun.sleep(700)
    const r = stop(dir, 'capped', { run }, port)
    srv.kill()
    expect(lastLedgerEntry(join(dir, 'work-hold-capped.releases.log'))?.verb).toBe('expired')
    expect(r.stderr).toContain('6 rounds, at the 6 ceiling')
  }, 30000)

  test('a hold that watches NO run still counts its red Stops (nothing else to count)', () => {
    const dir = mkTmp('judgerounds-')
    const r = stop(dir, 'norun', { check: 'exit 1', goal: undefined }, 1)
    expect(JSON.parse(r.stdout).reason).toContain('Round 1/6')
    expect(r.state.rounds).toBe(1)
  })
})

describe('a DISARMED hold is inert', () => {
  test('after a user release the Stop hook prints nothing and restores nothing', () => {
    const dir = mkTmp('judgedisarm-')
    const sid = 'disarmed'
    const st = { check: '', goal: GOAL, startedAt: Math.floor(Date.now() / 1000), ceilingMinutes: 720, maxRounds: 6, rounds: 0 }
    writeFileSync(join(dir, `work-hold-${sid}.releases.log`),
      `2026-10-02T22:06:52-04:00\tarmed\t${JSON.stringify(st)}\n` +
      '2026-10-02T22:52:06-04:00\treleased by user (permission prompt)\t\n')
    const r = spawnSync('bun', [HOOK], {
      timeout: 120_000, encoding: 'utf8', input: JSON.stringify({ session_id: sid }),
      env: { ...HERMETIC_ENV, TMPDIR: dir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(existsSync(join(dir, `work-hold-${sid}.json`))).toBe(false)
  })
})

describe('a check-less, run-less afk hold is never judged: the ceiling clock is its only release', () => {
  test('before the ceiling: allow, no round, and no request reaches the judge', async () => {
    const dir = mkTmp('judgefacts-')
    const log = join(dir, 'jev.log')
    writeFileSync(log, '')
    const port = 18838
    const srv = stubJev(port, 0.1, log)
    await Bun.sleep(700)
    const r = stop(dir, 'afk-quiet', { origin: 'afk' }, port)
    srv.kill()
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.state.rounds).toBe(0)
    expect(readFileSync(log, 'utf8')).toBe('')
  }, 30000)

  test('past the ceiling: released `expired`, still without asking the judge', async () => {
    const dir = mkTmp('judgefacts-')
    const log = join(dir, 'jev.log')
    writeFileSync(log, '')
    const port = 18839
    const srv = stubJev(port, 0.1, log)
    await Bun.sleep(700)
    const r = stop(dir, 'afk-done', { origin: 'overnight', startedAt: Math.floor(Date.now() / 1000) - 3600, ceilingMinutes: 30 }, port)
    srv.kill()
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('Hold released UNMET')
    expect(r.state).toBeNull()
    expect(lastLedgerEntry(join(dir, 'work-hold-afk-done.releases.log'))?.verb).toBe('expired')
    expect(readFileSync(log, 'utf8')).toBe('')
  }, 30000)
})
