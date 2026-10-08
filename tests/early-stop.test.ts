import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'
import { DEFAULT_THRESHOLD, INSTRUCTIONS, judgeContext, afkHold, afkHoldGoal, judgeState, latestUserTurn, noWakeUnderMandate, typedByHuman } from '../hooks/early-stop.ts'

const mkTmp = useTmp()

/**
 * End to end: Stop payload -> hook -> Jev -> decision, plus every path that must NOT reach Jev.
 *
 * The stub Decisions server runs OUT OF PROCESS for the reason judge-integration.test.ts records:
 * `decisionsCall` uses a blocking `spawnSync`, so an in-test `Bun.serve` would be waiting on the
 * same event loop the hook is blocking.
 *
 * Every stub below answers 0.99 — far above the threshold. So each allow assertion is evidence the
 * guard fired BEFORE the judge, not evidence that the judge was lenient or unreachable.
 */

const ROOT = dirname(import.meta.dir)
const HOOK = join(ROOT, 'hooks', 'early-stop.ts')

/** The Decisions API's shape: one typed question in, a calibrated probability out. */
function stubDecisions(port: number, noul: number) {
  const code = `
import json, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = json.dumps({"answers":{"early_stop":{"type":"noul","noul":${noul}}}}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`
  return Bun.spawn(['python3', '-c', code], { stdout: 'ignore', stderr: 'ignore' })
}

/** A server that is up and answering 500. curl exits 0 on a 500, so this is NOT the unreachable case. */
function stubBroken(port: number) {
  const code = `
import http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = b"upstream is on fire"
        self.send_response(500); self.send_header("content-type","text/plain")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`
  return Bun.spawn(['python3', '-c', code], { stdout: 'ignore', stderr: 'ignore' })
}

const settle = () => Bun.sleep(700)

/**
 * The child env.
 *
 * HERMETIC_ENV strips the ambient session identity; these three are stripped for the same reason one
 * layer down — THIS SUITE RUNS INSIDE A FARM-OUT CHILD, so `FARM_OUT_CHILD=1` is in `process.env`
 * and every block assertion would pass into an allow that proves nothing.
 */
function childEnv(dir: string, extra: Record<string, string> = {}): Record<string, string> {
  const {
    FARM_OUT_CHILD: _f,
    GRIND_ITERATION: _g,
    EARLY_STOP_HOOK: _e,
    ...rest
  } = HERMETIC_ENV
  return {
    ...rest,
    TMPDIR: dir,
    // No agenix key: a test must never reach the live, billed Decisions endpoint.
    XDG_RUNTIME_DIR: '/nonexistent-so-no-agenix-key',
    WORK_HOLD_JUDGE_TOKEN: 'test-token',
    ...extra,
  }
}

function fixture(turns: Array<{ uuid: string; text: string }> = [{ uuid: 'turn-1', text: 'build the parser and run the suite' }]) {
  const dir = mkTmp('earlystop-')
  const path = join(dir, 'transcript.jsonl')
  writeTranscript(path, turns)
  return { dir, transcript: path }
}

function writeTranscript(path: string, turns: Array<{ uuid: string; text: string }>) {
  const lines: string[] = []
  for (const t of turns) {
    lines.push(JSON.stringify({ type: 'user', uuid: t.uuid, message: { content: t.text } }))
    lines.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }))
    // A tool result: a `type:"user"` entry that is NOT a turn boundary.
    lines.push(JSON.stringify({
      type: 'user', uuid: `${t.uuid}-tr`, toolUseResult: { stdout: 'ok' },
      message: { content: [{ type: 'tool_result', content: 'ok' }] },
    }))
  }
  writeFileSync(path, lines.join('\n') + '\n')
}

const EARLY_STOP_MESSAGE =
  'I have wired the parser and the tests are written. Next I should run the suite and fix whatever ' +
  'it reports — want me to go ahead and do that?'

function runHook(
  env: Record<string, string>,
  payload: Record<string, unknown>,
): { out: string; err: string; code: number | null } {
  const p = Bun.spawnSync(['bun', HOOK], { timeout: 120_000,
    cwd: ROOT,
    stdin: Buffer.from(JSON.stringify(payload)),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { out: p.stdout.toString(), err: p.stderr.toString(), code: p.exitCode }
}

function stopPayload(session: string, transcript: string, message = EARLY_STOP_MESSAGE) {
  return {
    session_id: session,
    transcript_path: transcript,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: message,
  }
}

const decisionsAt = (port: number) => ({ WORK_HOLD_DECISIONS_URL: `http://127.0.0.1:${port}/decisions` })
/** A port nothing listens on: curl cannot connect, so `decisionsCall` reports it unreachable. */
const DEAD = { WORK_HOLD_DECISIONS_URL: 'http://127.0.0.1:1/decisions' }

// ------------------------------------------------------------------- the judged decision

test('an early stop at or above the threshold BLOCKS', async () => {
  const port = 18891
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-block', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
  expect(r.out).toContain('Do not end a turn while work the user asked for is still owed')
  expect(r.out).toContain('AskUserQuestion')
  expect(r.code).toBe(0)
}, 30000)

test('below the threshold the stop is ALLOWED', async () => {
  const port = 18892
  const srv = stubDecisions(port, 0.12)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-low', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(r.code).toBe(0)
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('below threshold')
}, 30000)

test('EARLY_STOP_THRESHOLD moves the bar', async () => {
  const port = 18893
  const srv = stubDecisions(port, 0.55)
  await settle()
  const high = fixture()
  const rHigh = runHook(childEnv(high.dir, decisionsAt(port)), stopPayload('es-thr-high', high.transcript))
  const low = fixture()
  const rLow = runHook(
    childEnv(low.dir, { ...decisionsAt(port), EARLY_STOP_THRESHOLD: '0.5' }),
    stopPayload('es-thr-low', low.transcript),
  )
  srv.kill()
  expect(rHigh.out).toBe('')                       // 0.55 < 0.8 default
  expect(rLow.out).toContain('"decision":"block"') // 0.55 >= 0.5
}, 30000)

// ------------------------------------------------------------------------ failing open

test('a judge that ERRORS allows the stop', async () => {
  const port = 18894
  const srv = stubBroken(port)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-500', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('judge unavailable')
}, 30000)

test('an UNREACHABLE judge allows the stop', () => {
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, DEAD), stopPayload('es-dead', transcript))
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('judge unavailable')
}, 30000)

test('no key and no token: unavailable, so the stop is allowed', () => {
  const { dir, transcript } = fixture()
  const env = childEnv(dir, decisionsAt(18895))
  delete env.WORK_HOLD_JUDGE_TOKEN
  const r = runHook(env, stopPayload('es-nokey', transcript))
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('judge unavailable')
}, 30000)

// --------------------------------------------------------- the paths that never reach the judge

test('FARM_OUT_CHILD=1 allows immediately', async () => {
  const port = 18896
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(
    childEnv(dir, { ...decisionsAt(port), FARM_OUT_CHILD: '1' }),
    stopPayload('es-farm', transcript),
  )
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('FARM_OUT_CHILD=1')
}, 30000)

test('GRIND_ITERATION allows immediately', async () => {
  const port = 18897
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(
    childEnv(dir, { ...decisionsAt(port), GRIND_ITERATION: '7' }),
    stopPayload('es-grind', transcript),
  )
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('GRIND_ITERATION=7')
}, 30000)

test('EARLY_STOP_HOOK=0 opts the session out', async () => {
  const port = 18898
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(
    childEnv(dir, { ...decisionsAt(port), EARLY_STOP_HOOK: '0' }),
    stopPayload('es-optout', transcript),
  )
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('EARLY_STOP_HOOK=0')
}, 30000)

test('an ARMED work-hold stands this hook down, so the two never both block', async () => {
  const port = 18899
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  // What `work-hold.sh` arms: the per-session state file, in the same TMPDIR.
  writeFileSync(join(dir, 'work-hold-es-hold.json'), JSON.stringify({
    check: 'bun test', goal: 'every suite green',
    startedAt: Math.floor(Date.now() / 1000), ceilingMinutes: 600, maxRounds: 10, rounds: 0,
  }))
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-hold', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('work-hold is armed')
}, 30000)

test('an EMPTY last_assistant_message allows immediately', async () => {
  const port = 18900
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-empty', transcript, '   '))
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('empty last_assistant_message')
}, 30000)

test('a transcript with no genuine user request allows immediately', async () => {
  const port = 18901
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  // Only system injections and tool results — neither is a turn boundary.
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', uuid: 'meta-1', isMeta: true, message: { content: 'Stop hook feedback:\nkeep going' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }),
  ].join('\n') + '\n')
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-noturn', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('no genuine user request')
}, 30000)

// -------------------------------------------------------------------------------- the cap

test('two blocks per user turn, then the third stop is allowed — and a NEW turn blocks again', async () => {
  const port = 18902
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const env = childEnv(dir, decisionsAt(port))
  const payload = stopPayload('es-cap', transcript)

  const first = runHook(env, payload)
  const second = runHook(env, payload)
  const third = runHook(env, payload)

  // A blocked stop is recorded by the harness as an isMeta user entry. It must NOT rotate the turn
  // marker, or the cap would reset on this hook's own output and loop forever.
  writeFileSync(transcript, readFileSync(transcript, 'utf8') +
    JSON.stringify({ type: 'user', uuid: 'hook-feedback', isMeta: true, message: { content: 'Stop hook feedback:\nkeep going' } }) + '\n')
  const afterFeedback = runHook(env, payload)

  writeTranscript(transcript, [
    { uuid: 'turn-1', text: 'build the parser and run the suite' },
    { uuid: 'turn-2', text: 'now wire it into the CLI' },
  ])
  const newTurn = runHook(env, payload)
  srv.kill()

  expect(first.out).toContain('"decision":"block"')
  expect(second.out).toContain('"decision":"block"')
  expect(third.out).toBe('')
  expect(afterFeedback.out).toBe('')
  expect(newTurn.out).toContain('"decision":"block"')
  const log = readFileSync(join(dir, 'early-stop.log'), 'utf8')
  expect(log).toContain('cap: 2 blocks already this turn')
}, 60000)

test('an UNWRITABLE counter fails open rather than blocking uncapped', async () => {
  const port = 18903
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  // A READ-ONLY counter, holding a valid record for a DIFFERENT turn: it reads cleanly and says
  // zero blocks spent on this turn, so the judge is reached and a block is decided — and then the
  // write fails with EACCES. The audit log beside it is still writable, so the log is the evidence
  // this failed open at the counter write rather than anywhere earlier.
  const counter = join(dir, 'early-stop-es-nocounter.json')
  writeFileSync(counter, JSON.stringify({ turn: 'some-older-turn', blocks: 1 }))
  chmodSync(counter, 0o444)
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-nocounter', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(r.code).toBe(0)
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('counter unwritable')
}, 30000)

/**
 * The ENOENT distinction, which is the whole reason the counter read is not a bare try/catch.
 *
 * Absent means "no block spent yet" and is safe to block on, because the write that follows records
 * it. Present-but-unreadable means the cap is ALREADY broken: treating it as zero would block, fail
 * to learn anything, and read zero again at the next stop — the 2,2,2,2,2,2 loop
 * teammate-idle-report-check.sh measured. Each case below answers 0.99, so an allow can only come
 * from the counter, never from a lenient judge.
 */
test('a counter that EXISTS but cannot be parsed fails open', async () => {
  const port = 18906
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  writeFileSync(join(dir, 'early-stop-es-garbage.json'), 'this is not json{{{')
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-garbage', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(r.code).toBe(0)
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('counter unreadable')
}, 30000)

test('a counter that EXISTS but cannot be READ fails open', async () => {
  const port = 18907
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  // A DIRECTORY at the counter path: readFileSync raises EISDIR, which is not ENOENT.
  mkdirSync(join(dir, 'early-stop-es-unreadable.json'))
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-unreadable', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(r.code).toBe(0)
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('counter unreadable')
}, 30000)

test('an ABSENT counter is the only read that counts as zero blocks: it BLOCKS', async () => {
  const port = 18908
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-absent', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
  expect(JSON.parse(readFileSync(join(dir, 'early-stop-es-absent.json'), 'utf8')))
    .toEqual({ turn: 'turn-1', blocks: 1 })
}, 30000)

test('a TMPDIR that does not exist survives: no counter, no audit, still an allow', async () => {
  const port = 18905
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const r = runHook(
    childEnv(dir, { ...decisionsAt(port), TMPDIR: join(dir, 'no', 'such', 'dir') }),
    stopPayload('es-notmp', transcript),
  )
  srv.kill()
  expect(r.out).toBe('')
  expect(r.code).toBe(0)
}, 30000)

// ------------------------------------------------------------------------------ the audit

test('every decision writes one audit line: session, turn, p, verdict', async () => {
  const port = 18904
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  runHook(childEnv(dir, decisionsAt(port)), stopPayload('es-audit', transcript))
  srv.kill()
  const lines = readFileSync(join(dir, 'early-stop.log'), 'utf8').trim().split('\n')
  expect(lines.length).toBe(1)
  const f = lines[0].split('\t')
  expect(f[1]).toBe('es-audit')
  expect(f[2]).toBe('turn-1')
  expect(f[3]).toBe('99')
  expect(f[4]).toBe('block')
}, 30000)

// ------------------------------------------------------------------------------- the wiring

test('registered in hooks.json under Stop, after work-hold.ts, with a 20 s timeout', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'))
  const commands: string[] = []
  let entry: { command: string; timeout?: number } | undefined
  for (const group of cfg.hooks.Stop ?? []) {
    for (const h of group.hooks ?? []) {
      commands.push(h.command)
      if (h.command.includes('early-stop.ts')) entry = h
    }
  }
  expect(entry, 'early-stop.ts is not wired under Stop').toBeDefined()
  expect(entry!.command).toBe('bun ${CLAUDE_PLUGIN_ROOT}/hooks/early-stop.ts')
  expect(entry!.timeout).toBe(20)
  const iHold = commands.findIndex((c) => c.includes('work-hold.ts'))
  const iEarly = commands.findIndex((c) => c.includes('early-stop.ts'))
  expect(iHold).toBeGreaterThanOrEqual(0)
  expect(iEarly).toBeGreaterThan(iHold)
})

// ------------------------------------------------- owned runs the watcher will wake the session for

/** A fake `claude` binary: the hook reads the version from `$CLAUDE_CODE_EXECPATH --version`. */
function fakeClaude(dir: string, version: string): string {
  const bin = join(dir, `claude-${version}`)
  mkdirSync(bin, { recursive: true })
  const exe = join(bin, 'claude')
  writeFileSync(exe, `#!/bin/sh\necho '${version} (Claude Code)'\n`)
  chmodSync(exe, 0o755)
  return exe
}

/** One farm.sh-shaped event file for `pid` under `<dir>/farm-events/<session>`. */
function farmEvents(dir: string, session: string, pid: number, lines: string[]): void {
  const d = join(dir, 'farm-events', session)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, `${pid}.ndjson`), lines.join('\n') + '\n')
}

/** What a ticking watcher leaves in the session's event directory: epoch seconds, `ageS` ago. */
function beacon(dir: string, session: string, ageS = 0): void {
  const d = join(dir, 'farm-events', session)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'watcher.alive'), String(Math.floor(Date.now() / 1000) - ageS))
}

const START = (label: string) => `farm: START ${label} t=${Math.floor(Date.now() / 1000)} cwd=/x`

/** A pid that has exited: the child is reaped by spawnSync before it returns. */
function deadPid(): number {
  return Bun.spawnSync(['true'], { timeout: 5000 }).pid
}

function interactiveEnv(dir: string, port: number, extra: Record<string, string> = {}) {
  return childEnv(dir, {
    ...decisionsAt(port),
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_EXECPATH: fakeClaude(dir, '2.1.287'),
    ...extra,
  })
}

test('a LIVE owned run with a FRESH watcher beacon ALLOWS: the watcher wakes it', async () => {
  const port = 18909
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  // The test runner's own pid: alive for as long as the hook runs.
  farmEvents(dir, 'es-live', process.pid, [START('alpha')])
  beacon(dir, 'es-live')
  const r = runHook(interactiveEnv(dir, port), stopPayload('es-live', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('owned runs live, the watcher wakes the session: alpha')
}, 30000)

test('a FINISHED owned run (DONE line) leaves the judge in charge: it BLOCKS', async () => {
  const port = 18910
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  farmEvents(dir, 'es-done', process.pid, [START('alpha'), 'farm: DONE alpha ok rc=0'])
  beacon(dir, 'es-done')
  const r = runHook(interactiveEnv(dir, port), stopPayload('es-done', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
}, 30000)

test('a GONE owned run (no DONE, pid dead) leaves the judge in charge: it BLOCKS', async () => {
  const port = 18911
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  farmEvents(dir, 'es-gone', deadPid(), [START('alpha')])
  beacon(dir, 'es-gone')
  const r = runHook(interactiveEnv(dir, port), stopPayload('es-gone', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
}, 30000)

test("ANOTHER session's live run does not count: it BLOCKS", async () => {
  const port = 18912
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  farmEvents(dir, 'some-other-session', process.pid, [START('theirs')])
  beacon(dir, 'es-mine')
  const r = runHook(interactiveEnv(dir, port), stopPayload('es-mine', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
}, 30000)

test('HEADLESS (entrypoint sdk-cli) with a live owned run: no watcher, so it BLOCKS', async () => {
  const port = 18913
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  farmEvents(dir, 'es-headless', process.pid, [START('alpha')])
  const r = runHook(interactiveEnv(dir, port, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), stopPayload('es-headless', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
}, 30000)

test('a STALE beacon (the watcher stopped ticking) leaves the judge in charge: it BLOCKS', async () => {
  const port = 18915
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  farmEvents(dir, 'es-stale', process.pid, [START('alpha')])
  beacon(dir, 'es-stale', 61)
  const r = runHook(interactiveEnv(dir, port), stopPayload('es-stale', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
}, 30000)

// The secreg session e3b75752 (2026-10-02): interactive, Claude Code 2.1.287, its notes repair
// 1002-notes-18-repair-b live — and NO beacon, because Claude Code served its hooks-modules rollout
// switch off and loaded no mod: no watcher, so nothing would wake it. The lines are its event files
// 2692394/2692410/2693151 verbatim, with the run dir moved into the fixture and t= made recent.
test('secreg e3b75752: live owned runs on 2.1.287 but NO beacon (mods never loaded): it BLOCKS', async () => {
  const port = 18914
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  const R = join(dir, 'craft', '1002-notes-18-repair-b')
  const t = Math.floor(Date.now() / 1000) - 120
  const S = 'e3b75752-8459-4201-8118-4b52c8e0bc9c'
  farmEvents(dir, S, process.pid, [
    `farm: START work-round cwd=/home/eh/areas/secreg out=${R}/result.json expect=1 t=${t}`,
    `farm: CLAIM work-round path=${R}/result.json `,
  ])
  farmEvents(dir, S, process.ppid, [
    `farm: START work-loop cwd=/home/eh/areas/secreg out=${R}/loop.exit expect=1 t=${t + 2}`,
  ])
  const r = runHook(interactiveEnv(dir, port), stopPayload(S, transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).not.toContain('the watcher wakes the session')
}, 30000)

// ---- the judge input: the standing mandate and the heartbeat fact (no network) ----

const entry = (o: Record<string, unknown>) => JSON.stringify(o)
const human = (uuid: string, text: string, ts: string, extra: Record<string, unknown> = {}) =>
  entry({ type: 'user', uuid, timestamp: ts, origin: { kind: 'human' }, message: { role: 'user', content: text }, ...extra })
const wake = (uuid: string, text: string, ts: string) =>
  entry({ type: 'user', uuid, timestamp: ts, origin: { kind: 'plugin', name: 'workflows' }, message: { role: 'user', content: text } })
const tick = (uuid: string, ts: string) =>
  entry({ type: 'user', uuid, timestamp: ts, isMeta: true, turnOrigin: 'scheduled', message: { role: 'user', content: 'and? (work run x)' } })
const toolResult = (ts: string, text: string) =>
  entry({ type: 'user', timestamp: ts, toolUseResult: { id: 'x' }, message: { role: 'user', content: [{ type: 'tool_result', content: text }] } })

const MANDATE = "I'm gonna go to bed. Just do whatever you think is best, don't ask me questions."

test('mandate selection skips ticks, plugin wakes, task notifications and relays: the typed standing message wins', () => {
  const t = [
    human('u1', MANDATE, '2026-10-07T01:00:00.000Z'),
    human('u2', 'and? (grind scratch/x)', '2026-10-07T02:00:00.000Z'),
    tick('u3', '2026-10-07T03:00:00.000Z'),
    wake('u4', 'The workflows plugin sent a message:\ngrind loop x finished', '2026-10-07T04:00:00.000Z'),
    entry({ type: 'user', uuid: 'u5', timestamp: '2026-10-07T05:00:00.000Z', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>\n<task-id>b</task-id>' } }),
    entry({ type: 'user', uuid: 'u6', timestamp: '2026-10-07T06:00:00.000Z', message: { role: 'user', content: '<bash-stdout>do whatever you think</bash-stdout>' } }),
  ].join('\n')
  const c = judgeContext(t)
  expect(c.standing).toBe(MANDATE)
  expect(c.latestTyped).toBeNull() // the only typed message IS the mandate
  expect(latestUserTurn(t)?.marker).toBe('u6') // the cap's turn key is untouched by this change
  expect(c.hoursSinceTyped).toBeCloseTo(5, 1)
})

test('a later typed message that is not a mandate is shown beside the older mandate', () => {
  const t = [
    human('u1', MANDATE, '2026-10-07T01:00:00.000Z'),
    human('u2', 'why is the figure jagged', '2026-10-07T09:00:00.000Z'),
    wake('u3', 'The workflows plugin sent a message:\nrun done', '2026-10-07T09:30:00.000Z'),
  ].join('\n')
  const c = judgeContext(t)
  expect(c.standing).toBe(MANDATE)
  expect(c.latestTyped).toBe('why is the figure jagged')
  const s = judgeState('The workflows plugin sent a message:\nrun done', 'Nothing left.', c)
  expect(s).toContain("STANDING MANDATE")
  expect(s).toContain(MANDATE)
  expect(s).toContain('why is the figure jagged')
  expect(s.indexOf('STANDING MANDATE')).toBeLessThan(s.indexOf('NEWEST REQUEST'))
  expect(s.indexOf('NEWEST REQUEST')).toBeLessThan(s.indexOf("FINAL MESSAGE"))
})

test('no standing instruction anywhere: no mandate section, the latest typed message still shows', () => {
  const c = judgeContext(human('u1', 'fix the parser', '2026-10-07T01:00:00.000Z'))
  expect(c.standing).toBeNull()
  expect(c.latestTyped).toBe('fix the parser')
  expect(judgeState('fix the parser', 'done', c)).not.toContain('STANDING MANDATE')
})

test('typedByHuman: the origin tag decides, text shape only when the tag is absent', () => {
  expect(typedByHuman({ origin: { kind: 'human' } }, 'hello')).toBe(true)
  expect(typedByHuman({ origin: { kind: 'plugin' } }, 'hello')).toBe(false)
  expect(typedByHuman({ origin: { kind: 'human' } }, 'and? (work run x)')).toBe(false)
  expect(typedByHuman({}, '<task-notification>\n<task-id>')).toBe(false)
  expect(typedByHuman({}, 'plain old transcript line')).toBe(true)
  expect(typedByHuman({ promptSource: 'sdk', turnOrigin: 'sdk' }, 'headless prompt')).toBe(false)
})

const cronCreate = (id: string, ts: string) =>
  toolResult(ts, `Scheduled recurring job ${id} (Every hour at :07). Session-only (not written to disk, dies when Claude exits).`)
const cronDelete = (id: string, ts: string) => toolResult(ts, `Cancelled job ${id}.`)

test('heartbeat cron: alive = created minus cancelled; a refused delete leaves it alive', () => {
  const base = [human('u1', MANDATE, '2026-10-07T01:00:00.000Z'), cronCreate('aaaa1111', '2026-10-07T01:01:00.000Z')]
  expect(judgeContext(base.join('\n')).heartbeatAlive).toBe(true)
  const refused = toolResult('2026-10-07T02:00:00.000Z', 'PreToolUse:CronDelete hook error: A hold is ARMED')
  expect(judgeContext([...base, refused].join('\n')).heartbeatAlive).toBe(true)
  expect(judgeContext([...base, cronDelete('aaaa1111', '2026-10-07T02:00:00.000Z')].join('\n')).heartbeatAlive).toBe(false)
  expect(judgeContext(human('u1', 'hi', '2026-10-07T01:00:00.000Z')).heartbeatAlive).toBe(false)
})

test('a replaced heartbeat stays alive; deleting only the new one does not', () => {
  const t = [
    human('u1', MANDATE, '2026-10-07T01:00:00.000Z'),
    cronCreate('aaaa1111', '2026-10-07T01:01:00.000Z'),
    cronCreate('bbbb2222', '2026-10-07T02:01:00.000Z'),
    cronDelete('aaaa1111', '2026-10-07T02:01:05.000Z'),
  ].join('\n')
  expect(judgeContext(t).heartbeatAlive).toBe(true)
  expect(judgeContext(`${t}\n${cronDelete('bbbb2222', '2026-10-07T03:00:00.000Z')}`).heartbeatAlive).toBe(false)
})

test('deletedThisTurn is true only for a delete AFTER the turn request', () => {
  const before = [
    human('u1', MANDATE, '2026-10-07T01:00:00.000Z'),
    cronCreate('aaaa1111', '2026-10-07T01:01:00.000Z'),
    cronDelete('aaaa1111', '2026-10-07T01:02:00.000Z'),
    wake('u2', 'The workflows plugin sent a message:\nrun done', '2026-10-07T03:00:00.000Z'),
  ].join('\n')
  expect(judgeContext(before).deletedThisTurn).toBe(false)
  const during = [
    human('u1', MANDATE, '2026-10-07T01:00:00.000Z'),
    cronCreate('aaaa1111', '2026-10-07T01:01:00.000Z'),
    wake('u2', 'The workflows plugin sent a message:\nrun done', '2026-10-07T03:00:00.000Z'),
    cronDelete('aaaa1111', '2026-10-07T03:01:00.000Z'),
  ].join('\n')
  const c = judgeContext(during)
  expect(c.deletedThisTurn).toBe(true)
  expect(c.heartbeatAlive).toBe(false)
  const s = judgeState('x', 'y', c)
  expect(s).toContain('NOT alive')
  expect(s).toContain('DELETED a cron job')
})

test('the judge input is bounded and the instructions keep the four ways and the exemptions', () => {
  const long = 'do whatever you think. ' + 'x'.repeat(20000)
  const s = judgeState('r'.repeat(20000), 'm'.repeat(20000), judgeContext(human('u1', long, '2026-10-07T01:00:00.000Z')))
  expect(s.length).toBeLessThan(2000 + 4000 + 1500 + 600 + 1000)
  for (const phrase of ['(1) a summary', '(4) stopping because', 'genuinely blocking question', 'AskUserQuestion hand-off', 'STANDING MANDATE'])
    expect(INSTRUCTIONS).toContain(phrase)
})

// ---- the bar and the deterministic leg: a stop that leaves no wake under a standing mandate ----

test('the threshold default is 0.8', () => {
  expect(DEFAULT_THRESHOLD).toBe(0.8)
})

/** A transcript whose typed mandate is followed by `extra` entries, then a plugin wake that started this turn. */
function mandateSession(extra: string[] = []) {
  const dir = mkTmp('earlystop-leg-')
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, [
    human('u1', MANDATE, '2026-10-07T01:00:00.000Z'),
    ...extra,
    wake('u2', 'The workflows plugin sent a message:\nfarm run x finished', '2026-10-07T06:00:00.000Z'),
  ].join('\n') + '\n')
  return { dir, transcript: path }
}

const LEG_LOG = 'no wake under mandate'

test('leg fires: mandate, no heartbeat, no owned run -> BLOCK before the judge, logged with its own prefix', () => {
  const { dir, transcript } = mandateSession()
  const r = runHook(childEnv(dir, DEAD), stopPayload('leg-fire', transcript, 'All done, nothing is running.'))
  expect(r.out).toContain('"decision":"block"')
  expect(r.out).toContain('no wake left')
  expect(r.out).toContain('CronCreate')
  const log = readFileSync(join(dir, 'early-stop.log'), 'utf8')
  expect(log).toContain(LEG_LOG)
  expect(log).not.toContain('judge unavailable')
}, 30000)

test('leg counts toward the same cap: two blocks per user turn, then the third stop is allowed', () => {
  const { dir, transcript } = mandateSession()
  const env = childEnv(dir, DEAD)
  const outs = [1, 2, 3].map(() => runHook(env, stopPayload('leg-cap', transcript)).out)
  expect(outs[0]).toContain('"decision":"block"')
  expect(outs[1]).toContain('"decision":"block"')
  expect(outs[2]).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('cap: 2 blocks already this turn')
}, 60000)

test('leg stays quiet with a live heartbeat cron', () => {
  const { dir, transcript } = mandateSession([cronCreate('aaaa1111', '2026-10-07T01:01:00.000Z')])
  const r = runHook(childEnv(dir, DEAD), stopPayload('leg-cron', transcript))
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).not.toContain(LEG_LOG)
}, 30000)

test('leg stays quiet with no standing mandate', () => {
  const { dir, transcript } = fixture()
  const r = runHook(childEnv(dir, DEAD), stopPayload('leg-nomandate', transcript))
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).not.toContain(LEG_LOG)
}, 30000)

test('leg stays quiet with a live owned run: the watcher allows it earlier, and a beaconless run still counts', () => {
  const a = mandateSession()
  farmEvents(a.dir, 'leg-run', process.pid, [START('alpha')])
  beacon(a.dir, 'leg-run')
  const withWatcher = runHook(childEnv(a.dir, { ...DEAD, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_EXECPATH: fakeClaude(a.dir, '2.1.287') }), stopPayload('leg-run', a.transcript))
  expect(withWatcher.out).toBe('')
  expect(readFileSync(join(a.dir, 'early-stop.log'), 'utf8')).toContain('owned runs live, the watcher wakes the session')

  const b = mandateSession()
  farmEvents(b.dir, 'leg-run2', process.pid, [START('beta')])
  const noWatcher = runHook(childEnv(b.dir, DEAD), stopPayload('leg-run2', b.transcript))
  expect(noWatcher.out).toBe('')
  expect(readFileSync(join(b.dir, 'early-stop.log'), 'utf8')).not.toContain(LEG_LOG)
}, 60000)

test('EARLY_STOP_HOOK=0 opts out of the leg too', () => {
  const { dir, transcript } = mandateSession()
  const r = runHook(childEnv(dir, { ...DEAD, EARLY_STOP_HOOK: '0' }), stopPayload('leg-optout', transcript))
  expect(r.out).toBe('')
}, 30000)

test('noWakeUnderMandate: the three facts, each one alone defeating it', () => {
  const ctx = judgeContext(human('u1', MANDATE, '2026-10-07T01:00:00.000Z'))
  expect(noWakeUnderMandate(ctx, [])).toBe(true)
  expect(noWakeUnderMandate(ctx, ['alpha'])).toBe(false)
  expect(noWakeUnderMandate({ ...ctx, heartbeatAlive: true }, [])).toBe(false)
  expect(noWakeUnderMandate({ ...ctx, monitorLive: true }, [])).toBe(false)
  expect(noWakeUnderMandate({ ...ctx, standing: null }, [])).toBe(false)
  expect(noWakeUnderMandate(undefined, [])).toBe(false)
})

test('a Monitor event in the last 45 minutes is a live wake; an older one is not', () => {
  const note = (ts: string) => entry({ type: 'user', uuid: 'n', timestamp: ts, origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>\n<summary>Monitor event: "farm-out runs"</summary>\n<event>grind: ITER i=3</event>' } })
  const end = wake('w', 'The workflows plugin sent a message:\nx', '2026-10-07T06:00:00.000Z')
  const m = human('u1', MANDATE, '2026-10-07T01:00:00.000Z')
  expect(judgeContext([m, note('2026-10-07T05:40:00.000Z'), end].join('\n')).monitorLive).toBe(true)
  expect(judgeContext([m, note('2026-10-07T04:00:00.000Z'), end].join('\n')).monitorLive).toBe(false)
})

test('the mandate is a typed instruction: pasted prompts, relays and questions about a mandate are not one', () => {
  const at = '2026-10-07T01:00:00.000Z'
  expect(judgeContext(human('u1', '\n\n<pasted_content id="a">\nkeep going until it is done\n</pasted_content>', at)).standing).toBeNull()
  expect(judgeContext(human('u1', 'From the tools session: keep going, do whatever you think', at)).standing).toBeNull()
  expect(judgeContext(human('u1', 'did you use overnight autonomous?', at)).standing).toBeNull()
  expect(judgeContext(human('u1', 'ok i\'m going to bed work overnight autonomously', at)).standing).not.toBeNull()
})

test('an unpunctuated question about overnight mode is not a mandate', () => {
  const at = '2026-10-07T01:00:00.000Z'
  expect(judgeContext(human('u1', 'how do i activate overnight mode', at)).standing).toBeNull()
  expect(judgeContext(human('u1', 'did you use overnight autonomous', at)).standing).toBeNull()
  expect(judgeContext(human('u1', '  Can you work overnight', at)).standing).toBeNull()
  expect(judgeContext(human('u1', 'going to bed, work autonomously', at)).standing).not.toBeNull()
})

test('"do whatever…" and "do not ask…" are mandates, not questions', () => {
  const at = '2026-10-07T01:00:00.000Z'
  expect(judgeContext(human('u1', 'Do whatever you think is best, I\'m going to bed', at)).standing).not.toBeNull()
  expect(judgeContext(human('u1', 'do not ask questions, work overnight', at)).standing).not.toBeNull()
  expect(judgeContext(human('u1', 'do i need to work overnight', at)).standing).toBeNull()
})

test('only clear sign-off phrases set a standing mandate: talk about overnight mode and bare words do not', () => {
  const at = '2026-10-07T01:00:00.000Z'
  for (const t of [
    'i mean i could just have a skill called overnight that i invoke myself',
    'and that has trigger words',
    'the overnight cron stopped',
    'keep going',
    'make it autonomous',
  ]) expect(judgeContext(human('u1', t, at)).standing).toBeNull()
})

test('every incident mandate text in the calibration fixture is still a mandate, plus the canonical sign-offs', () => {
  const at = '2026-10-07T01:00:00.000Z'
  const cases = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/early-stop-cal/cases.json'), 'utf8')).cases as {
    incident: boolean
    context: { standing: string | null }
  }[]
  // 10 incident cases; the tenth carries no mandate (the leg's known miss), so nine texts, two distinct
  const texts = cases.filter((c) => c.incident && c.context.standing).map((c) => c.context.standing as string)
  expect(texts.length).toBe(9)
  for (const t of [...texts, "Grind away I'm going to bed", "Do whatever you think is best, I'm going to bed", 'do not ask questions, work overnight'])
    expect(judgeContext(human('u1', t, at)).standing).not.toBeNull()
})

test('an armed overnight hold is a mandate in force: its goal stands in, and a typed mandate still wins', () => {
  const at = '2026-10-07T01:00:00.000Z'
  expect(judgeContext(human('u1', 'fix the parser', at), 'ship the parser').standing).toBe('ship the parser')
  expect(judgeContext(human('u1', MANDATE, at), 'ship the parser').standing).toBe(MANDATE)
  expect(afkHoldGoal('no-such-session-for-hold')).toBeNull()
})

// ---- an armed afk hold: work-hold.ts never blocks a check-less one, so this hook speaks for it ----

/** What arm.sh writes: a check-less afk hold, in the hook's TMPDIR. */
function afkHoldFile(dir: string, sid: string, extra: Record<string, unknown> = {}) {
  writeFileSync(join(dir, `work-hold-${sid}.json`), JSON.stringify({
    check: '', goal: 'Afk mandate: ship the parser.', origin: 'afk',
    startedAt: Math.floor(Date.now() / 1000), ceilingMinutes: 600, maxRounds: 1500, rounds: 0, ...extra,
  }))
}

test('afk hold, no wake left: the no-wake block sends questions to the morning report, not AskUserQuestion', () => {
  const { dir, transcript } = mandateSession()
  afkHoldFile(dir, 'afk-nowake')
  const r = runHook(childEnv(dir, DEAD), stopPayload('afk-nowake', transcript, 'All done, nothing is running.'))
  expect(r.out).toContain('"decision":"block"')
  expect(r.out).toContain('morning report')
  expect(r.out).toContain('do not use AskUserQuestion until the ceiling')
  expect(r.out).not.toContain('ask with AskUserQuestion')
}, 30000)

test('afk hold, judged early stop: the afk BLOCK_REASON variant', async () => {
  const port = 18961
  const srv = stubDecisions(port, 0.99)
  await settle()
  // A live heartbeat, so the no-wake leg stays quiet and the judge is asked.
  const { dir, transcript } = mandateSession([cronCreate('bbbb2222', '2026-10-07T01:01:00.000Z')])
  afkHoldFile(dir, 'afk-judged')
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('afk-judged', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
  expect(r.out).toContain('Do not end a turn while work the user asked for is still owed')
  expect(r.out).toContain('write the open questions into the morning report')
  expect(r.out).not.toContain('say what blocks and use AskUserQuestion')
}, 30000)

test('an afk hold past its ceiling, or with a check, still stands this hook down', async () => {
  const port = 18962
  const srv = stubDecisions(port, 0.99)
  await settle()
  const past = fixture()
  afkHoldFile(past.dir, 'afk-past', { startedAt: Math.floor(Date.now() / 1000) - 7200, ceilingMinutes: 60 })
  const rPast = runHook(childEnv(past.dir, decisionsAt(port)), stopPayload('afk-past', past.transcript))
  const checked = fixture()
  afkHoldFile(checked.dir, 'afk-check', { check: 'bun test' })
  const rCheck = runHook(childEnv(checked.dir, decisionsAt(port)), stopPayload('afk-check', checked.transcript))
  srv.kill()
  expect(rPast.out).toBe('')
  expect(rCheck.out).toBe('')
  expect(readFileSync(join(past.dir, 'early-stop.log'), 'utf8')).toContain('work-hold is armed')
  expect(readFileSync(join(checked.dir, 'early-stop.log'), 'utf8')).toContain('work-hold is armed')
}, 30000)

// ---- an afk hold queued behind a borrowed work-run hold (nevada e83fb488, 2026-10-08) ----

const HOLD_SH = join(ROOT, 'skills/work/scripts/work-hold.sh')
const ARM_SH = join(ROOT, 'skills/afk/scripts/arm.sh')
const WORK_HOLD = join(ROOT, 'hooks/work-hold.ts')

/** A work run with its verdict on disk, held by a non-afk hold whose check is `test -f <dir>/DONE`. */
function borrowedHold(dir: string, sid: string) {
  const run = join(dir, 'runs', '1007-nevada-otc')
  mkdirSync(run, { recursive: true })
  writeFileSync(join(run, 'args.json'), JSON.stringify({ planPath: '/plans/otc.md' }))
  writeFileSync(join(run, 'result.json'), '{"overallPass":true}')
  const env = { ...childEnv(dir), CLAUDE_CODE_SESSION_ID: sid, WORK_HOLD_COMPACT_WINDOW: '0' }
  const sh = (args: string[], extra: Record<string, string> = {}) =>
    Bun.spawnSync(['bash', ...args], { env: { ...env, ...extra }, stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
  expect(sh([HOLD_SH, `test -f ${join(dir, 'DONE')}`, '--run', run, '--minutes', '600']).exitCode).toBe(0)
  const now = new Date()
  const armed = sh([ARM_SH, sid, 'ship the parser'], { AFK_NOW: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}` })
  expect(armed.stdout.toString()).toContain('queued behind')
  return { run, env }
}

test('(c) a non-afk hold on top with an afk hold queued: this hook stands down, and the queued mandate is recognised', async () => {
  const port = 18963
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = mandateSession([cronCreate('cccc3333', '2026-10-07T01:01:00.000Z')])
  const { run } = borrowedHold(dir, 'afk-queued')
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('afk-queued', transcript))
  srv.kill()
  expect(r.out).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('work-hold is armed')
  expect(JSON.parse(readFileSync(join(dir, 'work-hold-afk-queued.json'), 'utf8')).run).toBe(run)
  const prev = process.env.TMPDIR
  process.env.TMPDIR = dir
  try {
    const a = afkHold('afk-queued')
    expect(a?.goal).toContain('Afk mandate: ship the parser.')
    expect(a?.silent).toBe(false)
    // A queued afk hold past its own ceiling is no mandate.
    expect(afkHold('afk-queued', Math.floor(Date.now() / 1000) + 25 * 3600)).toBeNull()
  } finally {
    process.env.TMPDIR = prev
  }
}, 60000)

test('(d) after the borrowed hold releases, the promoted afk hold makes this hook use AFK_BLOCK_REASON', async () => {
  const port = 18964
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = mandateSession([cronCreate('dddd4444', '2026-10-07T01:01:00.000Z')])
  const { env } = borrowedHold(dir, 'afk-promoted')
  writeFileSync(join(dir, 'DONE'), '')
  const rel = Bun.spawnSync(['bun', WORK_HOLD], {
    env, stdin: Buffer.from(JSON.stringify({ session_id: 'afk-promoted' })), stdout: 'pipe', stderr: 'pipe', timeout: 60_000,
  })
  expect(rel.stdout.toString().trim()).toBe('')
  expect(JSON.parse(readFileSync(join(dir, 'work-hold-afk-promoted.json'), 'utf8')).origin).toBe('afk')
  const r = runHook(childEnv(dir, decisionsAt(port)), stopPayload('afk-promoted', transcript))
  srv.kill()
  expect(r.out).toContain('"decision":"block"')
  expect(r.out).toContain('write the open questions into the morning report')
  expect(r.out).not.toContain('say what blocks and use AskUserQuestion')
}, 60000)
