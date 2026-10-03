import { expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'

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

test('a LIVE owned run in an interactive session on 2.1.287+ ALLOWS: the watcher wakes it', async () => {
  const port = 18909
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  // The test runner's own pid: alive for as long as the hook runs.
  farmEvents(dir, 'es-live', process.pid, [START('alpha')])
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

/**
 * A compiled fake `claude` that reports `version` and, like the harness, runs the hook through `sh -c`
 * as its child — so the hook's ancestry names it. A shell-script fake cannot: its exe is the shell.
 */
function fakeClaudeParent(dir: string, version: string): string {
  const exe = join(dir, 'installs', 'claude', version, 'claude')
  mkdirSync(dirname(exe), { recursive: true })
  const src = join(dir, 'fake-claude.ts')
  writeFileSync(src, [
    `if (process.argv.includes('--version')) { console.log('${version} (Claude Code)'); process.exit(0) }`,
    `const r = Bun.spawnSync(['/bin/sh', '-c', process.env.FAKE_HOOK_CMD!], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })`,
    'process.exit(r.exitCode ?? 1)',
  ].join('\n'))
  const b = Bun.spawnSync(['bun', 'build', '--compile', src, '--outfile', exe], { stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
  if (b.exitCode !== 0) throw new Error(`bun build --compile failed: ${b.stderr.toString()}`)
  return exe
}

test('a STALE inherited CLAUDE_CODE_EXECPATH does not hide the running 2.1.287: a live owned run ALLOWS', async () => {
  // The lead session was launched by a 2.1.257 parent, uninstalled since; its hooks inherit that path,
  // so `$CLAUDE_CODE_EXECPATH --version` cannot run — and the hook blocked with a live run going.
  const port = 18915
  const srv = stubDecisions(port, 0.99)
  await settle()
  const { dir, transcript } = fixture()
  farmEvents(dir, 'es-stale', process.pid, [START('alpha')])
  const claude = fakeClaudeParent(dir, '2.1.287')
  const env = interactiveEnv(dir, port, {
    CLAUDE_CODE_EXECPATH: join(dir, 'installs', 'claude', '2.1.257', 'claude'),
    FAKE_HOOK_CMD: `bun ${HOOK}`,
  })
  const p = Bun.spawnSync([claude], {
    timeout: 120_000, cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe',
    stdin: Buffer.from(JSON.stringify(stopPayload('es-stale', transcript))),
  })
  srv.kill()
  expect(p.stdout.toString()).toBe('')
  expect(readFileSync(join(dir, 'early-stop.log'), 'utf8')).toContain('owned runs live, the watcher wakes the session: alpha')
}, 90000)

test('below 2.1.287, or with no readable version, mods do not load: it BLOCKS', async () => {
  const port = 18914
  const srv = stubDecisions(port, 0.99)
  await settle()
  const old = fixture()
  farmEvents(old.dir, 'es-old', process.pid, [START('alpha')])
  const rOld = runHook(
    interactiveEnv(old.dir, port, { CLAUDE_CODE_EXECPATH: fakeClaude(old.dir, '2.1.286') }),
    stopPayload('es-old', old.transcript),
  )
  const none = fixture()
  farmEvents(none.dir, 'es-nover', process.pid, [START('alpha')])
  const envNone = interactiveEnv(none.dir, port)
  delete envNone.CLAUDE_CODE_EXECPATH
  const rNone = runHook(envNone, stopPayload('es-nover', none.transcript))
  srv.kill()
  expect(rOld.out).toContain('"decision":"block"')
  expect(rNone.out).toContain('"decision":"block"')
}, 30000)
