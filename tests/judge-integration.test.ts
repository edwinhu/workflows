import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * End-to-end: state file -> hook -> judge -> decision.
 *
 * The parser and the HTTP call were tested apart; nothing exercised them together, so the feature
 * that gates every stop had never once been observed working.
 *
 * The stub judge runs OUT OF PROCESS. An in-test Bun.serve cannot answer, because spawnSync blocks
 * the very event loop that would serve the request — the hook then times out against a server
 * sitting in the same process that is waiting for the hook.
 */
function stubJudge(port: number, met: boolean, why: string) {
  const code = `
import json, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = json.dumps({"choices":[{"message":{"content": json.dumps({"met": ${met ? "True" : "False"}, "why": ${JSON.stringify(why)}})}}]}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`;
  return Bun.spawn(["python3", "-c", code], { stdout: "ignore", stderr: "ignore" });
}

function runHook(env: Record<string, string>, payload: unknown) {
  const p = Bun.spawnSync(["bun", "hooks/hound.ts"], {
    stdin: Buffer.from(JSON.stringify(payload)),
    // Jev is tried BEFORE the chat judge, and it reads the agenix key out of XDG_RUNTIME_DIR --
    // which process.env carries in. Without these two the suite silently made real billed calls
    // to the live Decisions API and every chat-judge assertion below tested the wrong judge.
    // Both are overridable, so a test that WANTS the Decisions path stubs it explicitly.
    env: {
      ...process.env,
      XDG_RUNTIME_DIR: "/nonexistent-so-no-agenix-key",
      HOUND_DECISIONS_URL: "http://127.0.0.1:1/decisions",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { out: p.stdout.toString(), err: p.stderr.toString() };
}

function fixture(session: string, goal: string, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "houndit-"));
  writeFileSync(join(dir, `hound-${session}.json`), JSON.stringify({
    check: "true",                    // exits 0: the floor is met
    goal,
    startedAt: Math.floor(Date.now() / 1000),
    ceilingMinutes: 600, maxRounds: 10, rounds: 0,
    ...extra,
  }));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, JSON.stringify({ message: { content: "some work happened" } }) + "\n");
  return { dir, transcript };
}

const settle = () => Bun.sleep(700);

test("a GREEN check with an UNMET goal blocks, carrying goal, evidence and continuation", async () => {
  const port = 18781;
  const srv = stubJudge(port, false, "two suites still red");
  await settle();
  const { dir, transcript } = fixture("it-unmet", "every suite in the repo is green", {
    authority: "You may commit without asking.",
    continuation: "Report at the ceiling, not at the first stopping point.",
  });
  const r = runHook(
    { TMPDIR: dir, HOUND_JUDGE_URL: `http://127.0.0.1:${port}/v1/chat/completions` },
    { session_id: "it-unmet", transcript_path: transcript },
  );
  srv.kill();
  expect(r.out).toContain('"decision":"block"');
  expect(r.out).toContain("two suites still red");
  expect(r.out).toContain("every suite in the repo is green");
  expect(r.out).toContain("Report at the ceiling");
}, 30000);

test("a GREEN check with a MET goal releases the hold", async () => {
  const port = 18782;
  const srv = stubJudge(port, true, "all green");
  await settle();
  const { dir, transcript } = fixture("it-met", "every suite is green");
  const r = runHook(
    { TMPDIR: dir, HOUND_JUDGE_URL: `http://127.0.0.1:${port}/v1/chat/completions` },
    { session_id: "it-met", transcript_path: transcript },
  );
  srv.kill();
  expect(r.out).not.toContain('"decision":"block"');
  expect(r.err).toContain("objective met");
}, 30000);

test("an UNREACHABLE judge releases rather than trapping the session", async () => {
  // Fails OPEN by design: a hook that blocks forever because a model is down is worse than one
  // that lets a turn end on the check alone.
  const { dir, transcript } = fixture("it-down", "anything at all");
  const r = runHook(
    { TMPDIR: dir, HOUND_JUDGE_URL: "http://127.0.0.1:1/v1/chat/completions" },
    { session_id: "it-down", transcript_path: transcript },
  );
  expect(r.out).not.toContain('"decision":"block"');
  expect(r.err).toContain("judge unavailable");
}, 30000);

/** The Decisions API's shape: one typed question in, a calibrated probability out. */
function stubDecisions(port: number, noul: number) {
  const code = `
import json, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = json.dumps({"answers":{"met":{"type":"noul","noul":${noul}}}}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`;
  return Bun.spawn(["python3", "-c", code], { stdout: "ignore", stderr: "ignore" });
}

test("Jev below the threshold blocks, and reports the probability it gave", async () => {
  const port = 18783;
  const srv = stubDecisions(port, 0.21);
  await settle();
  const { dir, transcript } = fixture("it-jev-low", "every suite is green");
  const r = runHook(
    {
      TMPDIR: dir,
      HOUND_JUDGE_TOKEN: "test-token",
      HOUND_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
      // Deliberately dead: if Jev were skipped, this would fail OPEN and the test would pass
      // for the wrong reason. Blocking proves the verdict came from the Decisions path.
      HOUND_JUDGE_URL: "http://127.0.0.1:1/v1/chat/completions",
    },
    { session_id: "it-jev-low", transcript_path: transcript },
  );
  srv.kill();
  expect(r.out).toContain('"decision":"block"');
  expect(r.out).toContain("21%");
}, 30000);

test("Jev above the threshold releases the hold", async () => {
  const port = 18784;
  const srv = stubDecisions(port, 0.93);
  await settle();
  const { dir, transcript } = fixture("it-jev-high", "every suite is green");
  const r = runHook(
    {
      TMPDIR: dir,
      HOUND_JUDGE_TOKEN: "test-token",
      HOUND_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
      HOUND_JUDGE_URL: "http://127.0.0.1:1/v1/chat/completions",
    },
    { session_id: "it-jev-high", transcript_path: transcript },
  );
  srv.kill();
  expect(r.out).not.toContain('"decision":"block"');
  expect(r.err).toContain("objective met");
}, 30000);

// ------------------------------------------- the compaction summary actually reaches the judge

/**
 * A Decisions stub that INSPECTS what was posted.
 *
 * A parser test proves the reader works; it proves nothing about the wiring. This answers with a
 * releasing probability only when a marker from the compaction summary is present in the posted
 * `state`, so block-vs-release is direct evidence the summary travelled from the transcript file
 * into the judge's request.
 */
function stubDecisionsEchoing(port: number, marker: string) {
  const code = `
import json, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        seen = ${JSON.stringify(marker)} in json.dumps(req.get("state", ""))
        b = json.dumps({"answers":{"met":{"type":"noul","noul": 0.97 if seen else 0.03}}}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(("127.0.0.1", ${port}), H).serve_forever()
`;
  return Bun.spawn(["python3", "-c", code], { stdout: "ignore", stderr: "ignore" });
}

/** A transcript whose compaction boundary sits far further back than any fixed tail window. */
function compactedTranscript(dir: string, marker: string | null) {
  const lines: string[] = [];
  if (marker)
    lines.push(JSON.stringify({
      type: "user", isCompactSummary: true,
      message: { content: `This session is being continued from a previous conversation that ran out of context.\n\nSummary: ${marker}` },
    }));
  for (let i = 0; i < 300; i++)
    lines.push(JSON.stringify({ type: "assistant", message: { content: `routine turn ${i}` } }));
  const p = join(dir, "compacted.jsonl");
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

test("the compaction summary REACHES the judge — a marker only in it flips the verdict", async () => {
  const port = 18785;
  const marker = "MARKER-ONLY-IN-THE-COMPACTION-SUMMARY";
  const srv = stubDecisionsEchoing(port, marker);
  await settle();
  const env = (dir: string) => ({
    TMPDIR: dir,
    HOUND_JUDGE_TOKEN: "test-token",
    HOUND_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
    // Deliberately dead, so a skipped Decisions call would fail OPEN and be visible as a release
    // for the wrong reason rather than passing quietly.
    HOUND_JUDGE_URL: "http://127.0.0.1:1/v1/chat/completions",
  });

  const withIt = fixture("it-sum-yes", "every suite is green");
  const rYes = runHook(env(withIt.dir),
    { session_id: "it-sum-yes", transcript_path: compactedTranscript(withIt.dir, marker) });

  const without = fixture("it-sum-no", "every suite is green");
  const rNo = runHook(env(without.dir),
    { session_id: "it-sum-no", transcript_path: compactedTranscript(without.dir, null) });

  srv.kill();
  // Summary present -> the judge saw it -> 0.97 -> released.
  expect(rYes.out).not.toContain('"decision":"block"');
  expect(rYes.err).toContain("objective met");
  // Same transcript minus the summary -> 0.03 -> blocked. The only difference is the summary.
  expect(rNo.out).toContain('"decision":"block"');
}, 60000);

test("the round record travels to the judge too", async () => {
  const port = 18786;
  const marker = "judge UNMET: the fixture is still stubbed";
  const srv = stubDecisionsEchoing(port, marker);
  await settle();
  const { dir, transcript } = fixture("it-hist", "every suite is green", {
    history: [{ round: 1, at: 1_700_000_000, exit: 1 },
               { round: 2, at: 1_700_003_600, exit: 0, note: marker }],
  });
  const r = runHook(
    { TMPDIR: dir, HOUND_JUDGE_TOKEN: "test-token",
      HOUND_DECISIONS_URL: `http://127.0.0.1:${port}/decisions`,
      HOUND_JUDGE_URL: "http://127.0.0.1:1/v1/chat/completions" },
    { session_id: "it-hist", transcript_path: transcript },
  );
  srv.kill();
  expect(r.err).toContain("objective met");
}, 30000);

// ------------------------------------------------- the SessionStart briefing after a compaction

function runBrief(dir: string, session: string) {
  const p = Bun.spawnSync(["bun", "hooks/hound.ts", "--brief"], {
    stdin: Buffer.from(JSON.stringify({ session_id: session, source: "compact" })),
    env: { ...process.env, TMPDIR: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { out: p.stdout.toString(), code: p.exitCode };
}

test("--brief is SILENT on a session that is not armed", () => {
  const dir = mkdtempSync(join(tmpdir(), "houndit-"));
  const r = runBrief(dir, "never-armed");
  expect(r.out.trim()).toBe("");
  expect(r.code).toBe(0);
});

test("--brief re-injects the goal, the check, the budget and the rounds after a compaction", () => {
  const { dir } = fixture("it-brief", "every suite in the repo is green", {
    check: "bun test",
    authority: "You may commit without asking.",
    history: [{ round: 1, at: 1_700_000_000, exit: 1 },
               { round: 2, at: 1_700_003_600, exit: 0, note: "judge UNMET: two suites still red" }],
    rounds: 2,
  });
  const r = runBrief(dir, "it-brief");
  expect(r.out).toContain("every suite in the repo is green");
  expect(r.out).toContain("bun test");
  expect(r.out).toContain("2 of 10 rounds");
  expect(r.out).toContain("You may commit without asking.");
  expect(r.out).toContain("two suites still red");
  expect(r.code).toBe(0);
});
