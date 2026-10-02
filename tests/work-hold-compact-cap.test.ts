import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { capProvenance, globalArg, restoreLocal, writeLocalCap } from "../hooks/work-hold.ts";
import { HERMETIC_ENV } from "./helpers/hermetic-env";

const REPO = join(import.meta.dir, "..");

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ------------------------------------------------------------------ unit: the local settings file

test("no local file -> created, and removed again on restore", () => {
  const d = tmp("holdcap-");
  const p = join(d, ".claude", "settings.local.json");
  const rec = writeLocalCap(p, 250_000);
  expect(rec).toEqual({ path: p, window: 250_000, prior: null, created: true });
  expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ autoCompactWindow: 250_000 });
  restoreLocal(rec);
  expect(existsSync(p)).toBe(false);
});

test("other keys and their order survive the round trip", () => {
  const d = tmp("holdcap-");
  const p = join(d, "settings.local.json");
  writeFileSync(p, JSON.stringify({ zeta: 1, permissions: { allow: ["Bash(ls)"] }, alpha: "x" }, null, 2));
  const rec = writeLocalCap(p, 250_000);
  expect(rec.created).toBe(false);
  expect(rec.prior).toBeNull();
  expect(Object.keys(JSON.parse(readFileSync(p, "utf8")))).toEqual([
    "zeta", "permissions", "alpha", "autoCompactWindow",
  ]);
  restoreLocal(rec);
  const after = JSON.parse(readFileSync(p, "utf8"));
  expect(Object.keys(after)).toEqual(["zeta", "permissions", "alpha"]);
  expect(after.permissions).toEqual({ allow: ["Bash(ls)"] });
});

test("a prior window is put back, not deleted", () => {
  const d = tmp("holdcap-");
  const p = join(d, "settings.local.json");
  writeFileSync(p, JSON.stringify({ autoCompactWindow: 400_000 }));
  const rec = writeLocalCap(p, 250_000);
  expect(rec.prior).toBe(400_000);
  restoreLocal(rec);
  expect(JSON.parse(readFileSync(p, "utf8")).autoCompactWindow).toBe(400_000);
});

test("a window changed mid-run is left alone", () => {
  const d = tmp("holdcap-");
  const p = join(d, "settings.local.json");
  const rec = writeLocalCap(p, 250_000);
  writeFileSync(p, JSON.stringify({ autoCompactWindow: 600_000 }));
  restoreLocal(rec);
  expect(JSON.parse(readFileSync(p, "utf8")).autoCompactWindow).toBe(600_000);
});

test("a malformed local file does not make a release throw", () => {
  const d = tmp("holdcap-");
  const p = join(d, "settings.local.json");
  writeFileSync(p, "{not json");
  expect(() => restoreLocal({ path: p, window: 250_000, prior: null, created: false })).not.toThrow();
  expect(() => restoreLocal({ path: join(d, "gone.json"), window: 1, prior: null, created: true })).not.toThrow();
});

// ------------------------------------------------------- a cap the hold itself left behind is not a prior
//
// THE BUG THIS EXISTS FOR. A hold that was re-armed, or whose release was skipped, leaves the cap
// value in the local file; the next arm read it back as `prior` and the release then "restored" it
// as though the user had chosen it. Observed 2026-09-25 in /home/eh/projects/hidden-figures: the
// file was rewritten to {"autoCompactWindow": 250000} at release, which blocked `/autocompact auto`.

test("a cap value with no provenance is still treated as the user's", () => {
  const d = tmp("holdcap-prov-");
  const p = join(d, "settings.local.json");
  writeFileSync(p, JSON.stringify({ autoCompactWindow: 250_000 }));
  expect(writeLocalCap(p, 250_000, null).prior).toBe(250_000);
});

test("a LIVE CapRecord in another hold's state carries its prior forward", () => {
  const d = tmp("holdcap-prov-");
  const p = join(d, "settings.local.json");
  writeFileSync(p, JSON.stringify({ autoCompactWindow: 250_000 }));
  writeFileSync(join(d, "work-hold-other.json"), JSON.stringify({
    check: "exit 1", startedAt: 1, ceilingMinutes: 720, maxRounds: 8, rounds: 0,
    compact: { path: p, window: 250_000, prior: 400_000, created: false },
  }));
  const rec = writeLocalCap(p, 250_000, capProvenance(p, 250_000, d));
  expect(rec.prior).toBe(400_000);
  restoreLocal(rec);
  expect(JSON.parse(readFileSync(p, "utf8")).autoCompactWindow).toBe(400_000);
});

test("a `capped` ledger line proves the hold wrote it, and the key is removed on restore", () => {
  const d = tmp("holdcap-prov-");
  const p = join(d, "settings.local.json");
  writeFileSync(p, JSON.stringify({ autoCompactWindow: 250_000 }));
  const rec0 = { path: p, window: 250_000, prior: null, created: true };
  writeFileSync(join(d, "work-hold-gone.releases.log"),
    `2026-09-25T00:00:00\tarmed\t{}\n2026-09-25T00:00:01\tcapped\t${JSON.stringify(rec0)}\n`);
  const rec = writeLocalCap(p, 250_000, capProvenance(p, 250_000, d));
  expect(rec.prior).toBeNull();
  expect(rec.created).toBe(true);     // the earlier cap created the file, so restore removes it
  restoreLocal(rec);
  expect(existsSync(p)).toBe(false);
});

test("provenance only counts for the same file and the same window", () => {
  const d = tmp("holdcap-prov-");
  const p = join(d, "settings.local.json");
  writeFileSync(join(d, "work-hold-other.json"), JSON.stringify({
    compact: { path: join(d, "elsewhere.json"), window: 250_000, prior: 400_000, created: false },
  }));
  expect(capProvenance(p, 250_000, d)).toBeNull();
  expect(capProvenance(join(d, "elsewhere.json"), 300_000, d)).toBeNull();
  expect(capProvenance(join(d, "elsewhere.json"), 250_000, d)?.prior).toBe(400_000);
});

test("an unreadable state file or ledger is not evidence, and does not throw", () => {
  const d = tmp("holdcap-prov-");
  writeFileSync(join(d, "work-hold-bad.json"), "{not json");
  writeFileSync(join(d, "work-hold-bad.releases.log"), "2026-09-25\tcapped\t{not json\n");
  expect(capProvenance(join(d, "settings.local.json"), 250_000, d)).toBeNull();
  expect(capProvenance("/whatever", 250_000, join(d, "nonexistent-dir"))).toBeNull();
});

test("globalArg reports the user file's current value, or auto when absent", () => {
  const d = tmp("holdcap-");
  const p = join(d, "settings.json");
  writeFileSync(p, JSON.stringify({ theme: "dark" }));
  process.env.WORK_HOLD_USER_SETTINGS = p;
  expect(globalArg()).toBe("auto");
  writeFileSync(p, JSON.stringify({ autoCompactWindow: 300_000 }));
  expect(globalArg()).toBe("300000");
  delete process.env.WORK_HOLD_USER_SETTINGS;
});

// ---------------------------------------------------------------- integration: arm.sh -> Stop hook

/**
 * A fake `herdr` that imitates Claude Code's `/autocompact`.
 *
 * It answers `agent list` with JSON naming the test session, and on `agent prompt <pane>
 * "/autocompact X"` writes X into WORK_HOLD_USER_SETTINGS (deleting the key for `auto`) and then logs
 * the MERGED value it would have applied -- the local file's key when present, else X. That log is
 * the only direct evidence the running session was capped.
 */
function fakeHerdr(dir: string, session: string, applied: string, user: string, local: string): string {
  const p = join(dir, "herdr");
  writeFileSync(p, `#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
if a[:2] == ["agent", "list"]:
    print(json.dumps({"result": {"agents": [
        {"pane_id": "%1", "agent_session": {"value": ${JSON.stringify(session)}}}]}}))
    sys.exit(0)
if a[:2] == ["agent", "prompt"]:
    arg = a[3].split()[-1]
    def load(p):
        try:
            return json.load(open(p))
        except Exception:
            return {}
    g = load(${JSON.stringify(user)})
    if arg == "auto":
        g.pop("autoCompactWindow", None)
    else:
        g["autoCompactWindow"] = int(arg)
    # Claude Code rewrites the file whatever the value; 2-space + trailing newline is its format,
    # so a no-op write stays byte-identical rather than differing only in whitespace.
    open(${JSON.stringify(user)}, "w").write(json.dumps(g, indent=2) + "\\n")
    merged = load(${JSON.stringify(local)}).get("autoCompactWindow", arg)
    open(${JSON.stringify(applied)}, "a").write(str(merged) + "\\n")
    sys.exit(0)
sys.exit(1)
`);
  chmodSync(p, 0o755);
  return p;
}

/**
 * A fake `agent-msg`, imitating the same `/autocompact` behaviour as fakeHerdr.
 *
 * `send --as-user <cse> "/autocompact X"` applies the merged value and logs it prefixed with the
 * transport and the target it was given, so a test can tell WHICH transport carried the send.
 * `fail` makes every send exit 1 instead, which is the herdr-fallback case.
 */
function fakeAgentMsg(dir: string, applied: string, user: string, local: string, fail = false): string {
  const p = join(dir, "agent-msg");
  writeFileSync(p, `#!/usr/bin/env python3
import json, sys
a = sys.argv[1:]
if a[:1] == ["--help"]:
    sys.exit(0)
if a[:2] == ["send", "--as-user"]:
    if ${fail ? "True" : "False"}:
        sys.exit(1)
    target, arg = a[2], a[3].split()[-1]
    def load(p):
        try:
            return json.load(open(p))
        except Exception:
            return {}
    g = load(${JSON.stringify(user)})
    if arg == "auto":
        g.pop("autoCompactWindow", None)
    else:
        g["autoCompactWindow"] = int(arg)
    open(${JSON.stringify(user)}, "w").write(json.dumps(g, indent=2) + "\\n")
    merged = load(${JSON.stringify(local)}).get("autoCompactWindow", arg)
    open(${JSON.stringify(applied)}, "a").write("agent-msg %s %s\\n" % (target, merged))
    sys.exit(0)
sys.exit(1)
`);
  chmodSync(p, 0o755);
  return p;
}

function env(dir: string, session: string, herdr: string, user: string, project: string) {
  return {
    ...HERMETIC_ENV,
    CLAUDE_CODE_SESSION_ID: session,
    TMPDIR: dir,
    CLAUDE_PROJECT_DIR: project,
    WORK_HOLD_HERDR: herdr,
    WORK_HOLD_USER_SETTINGS: user,
    WORK_HOLD_SETTLE_MS: "0",
    // The suite inherits the REAL session's env, where a live bridge id plus a real agent-msg on
    // PATH would send `/autocompact` into the session running the tests. Both are pinned absent
    // here; the transport tests below opt back in explicitly.
    CLAUDE_CODE_BRIDGE_SESSION_ID: "",
    WORK_HOLD_AGENT_MSG: "/nonexistent-agent-msg",
    // Never a real billed judge call, and never the real agenix key -- see runHook in
    // tests/judge-integration.test.ts.
    XDG_RUNTIME_DIR: "/nonexistent-so-no-agenix-key",
    WORK_HOLD_DECISIONS_URL: "http://127.0.0.1:1/decisions",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "",
  } as Record<string, string>;
}

test("arming caps the session locally and every release puts it back", () => {
  const dir = tmp("holdcap-it-");
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  const session = "cap-it-1";
  const applied = join(dir, "applied.log");
  const user = join(dir, "settings.json");
  const seed = JSON.stringify({ theme: "dark", model: "opus" }, null, 2) + "\n";
  writeFileSync(user, seed);
  const local = join(project, ".claude", "settings.local.json");
  const herdr = fakeHerdr(dir, session, applied, user, local);
  const flag = join(dir, "flag");

  const arm = Bun.spawnSync(
    ["bash", join(REPO, "skills/work/scripts/work-hold.sh"), `test -f ${flag}`, "--rounds", "8"],
    { timeout: 120_000, env: env(dir, session, herdr, user, project), stdout: "pipe", stderr: "pipe" },
  );
  const armOut = arm.stdout.toString() + arm.stderr.toString();
  expect(armOut).toContain("ARMED");
  expect(armOut).toContain("capped at 250000");

  // The cap reached the running session, the global file is untouched, and the record is in the
  // ONE existing state object rather than a file of its own.
  expect(readFileSync(applied, "utf8").trim().split("\n")).toEqual(["250000"]);
  expect(readFileSync(user, "utf8")).toBe(seed);
  expect(JSON.parse(readFileSync(local, "utf8")).autoCompactWindow).toBe(250_000);
  const state = JSON.parse(readFileSync(join(dir, `work-hold-${session}.json`), "utf8"));
  expect(state.compact).toEqual({ path: local, window: 250_000, prior: null, created: true });

  // Now make the check pass and run the REAL Stop hook.
  writeFileSync(flag, "");
  const stop = Bun.spawnSync(["bun", join(REPO, "hooks/work-hold.ts")], { timeout: 120_000,
    stdin: Buffer.from(JSON.stringify({ session_id: session, transcript_path: join(dir, "none.jsonl") })),
    env: env(dir, session, herdr, user, project),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stop.stdout.toString()).not.toContain('"decision":"block"');
  expect(readFileSync(applied, "utf8").trim().split("\n")).toEqual(["250000", "auto"]);
  expect(existsSync(local)).toBe(false);
  expect(readFileSync(user, "utf8")).toBe(seed);
});

test("the expired release restores the window too", () => {
  const dir = tmp("holdcap-it-");
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  const session = "cap-it-2";
  const applied = join(dir, "applied.log");
  const user = join(dir, "settings.json");
  const seed = JSON.stringify({ autoCompactWindow: 300_000 }, null, 2) + "\n";
  writeFileSync(user, seed);
  const local = join(project, ".claude", "settings.local.json");
  const herdr = fakeHerdr(dir, session, applied, user, local);
  const flag = join(dir, "never");

  const arm = Bun.spawnSync(
    ["bash", join(REPO, "skills/work/scripts/work-hold.sh"), `test -f ${flag}`, "--rounds", "1"],
    { timeout: 120_000, env: env(dir, session, herdr, user, project), stdout: "pipe", stderr: "pipe" },
  );
  expect(arm.stdout.toString()).toContain("capped at 250000");
  // A global key already set is what /autocompact is sent, so its own write is a no-op.
  expect(readFileSync(applied, "utf8").trim().split("\n")).toEqual(["250000"]);

  // rounds=1 with a red check: the first Stop is already at the ceiling.
  const state = join(dir, `work-hold-${session}.json`);
  const s = JSON.parse(readFileSync(state, "utf8"));
  s.rounds = 1;
  writeFileSync(state, JSON.stringify(s));
  const stop = Bun.spawnSync(["bun", join(REPO, "hooks/work-hold.ts")], { timeout: 120_000,
    stdin: Buffer.from(JSON.stringify({ session_id: session })),
    env: env(dir, session, herdr, user, project),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stop.stderr.toString()).toContain("Hold released UNMET");
  expect(readFileSync(applied, "utf8").trim().split("\n")).toEqual(["250000", "300000"]);
  expect(existsSync(local)).toBe(false);
  expect(readFileSync(user, "utf8")).toBe(seed);
});

test("RE-ARMING does not turn the hold's own cap into the user's setting", () => {
  const dir = tmp("holdcap-it-");
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  const session = "cap-it-3";
  const applied = join(dir, "applied.log");
  const user = join(dir, "settings.json");
  writeFileSync(user, JSON.stringify({ theme: "dark" }, null, 2) + "\n");
  const local = join(project, ".claude", "settings.local.json");
  const herdr = fakeHerdr(dir, session, applied, user, local);
  const flag = join(dir, "flag");
  const e = env(dir, session, herdr, user, project);
  const armOnce = () =>
    Bun.spawnSync(
      ["bash", join(REPO, "skills/work/scripts/work-hold.sh"), `test -f ${flag}`, "--rounds", "8"],
      { timeout: 120_000, env: e, stdout: "pipe", stderr: "pipe" },
    );

  expect(armOnce().stdout.toString()).toContain("capped at 250000");
  expect(JSON.parse(readFileSync(local, "utf8")).autoCompactWindow).toBe(250_000);

  // The second arm finds the cap still in the file. Before the fix it recorded prior=250000, and
  // the release then wrote {"autoCompactWindow": 250000} back as the user's own setting.
  expect(armOnce().stdout.toString()).toContain("capped at 250000");
  const state = JSON.parse(readFileSync(join(dir, `work-hold-${session}.json`), "utf8"));
  expect(state.compact.prior).toBeNull();

  writeFileSync(flag, "");
  Bun.spawnSync(["bun", join(REPO, "hooks/work-hold.ts")], { timeout: 120_000,
    stdin: Buffer.from(JSON.stringify({ session_id: session })),
    env: e, stdout: "pipe", stderr: "pipe",
  });
  expect(existsSync(local)).toBe(false);
});

// ------------------------------------------------------------------------- transport selection

/** Arm with both fakes installed, then run the real Stop hook on a check that has gone green. */
function armAndRelease(session: string, bridge: string, agentMsgFails: boolean) {
  const dir = tmp("holdcap-tx-");
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  const applied = join(dir, "applied.log");
  const user = join(dir, "settings.json");
  const seed = JSON.stringify({ theme: "dark" }, null, 2) + "\n";
  writeFileSync(user, seed);
  const local = join(project, ".claude", "settings.local.json");
  const herdr = fakeHerdr(dir, session, applied, user, local);
  const agentMsg = fakeAgentMsg(dir, applied, user, local, agentMsgFails);
  const flag = join(dir, "flag");
  const e = {
    ...env(dir, session, herdr, user, project),
    CLAUDE_CODE_BRIDGE_SESSION_ID: bridge,
    WORK_HOLD_AGENT_MSG: agentMsg,
  };

  const arm = Bun.spawnSync(
    ["bash", join(REPO, "skills/work/scripts/work-hold.sh"), `test -f ${flag}`, "--rounds", "8"],
    { timeout: 120_000, env: e, stdout: "pipe", stderr: "pipe" },
  );
  const armOut = arm.stdout.toString() + arm.stderr.toString();
  const armLog = readFileSync(applied, "utf8").trim().split("\n");
  // Read before the release: a passed hold deletes its own state file.
  const state = JSON.parse(readFileSync(join(dir, `work-hold-${session}.json`), "utf8"));

  writeFileSync(flag, "");
  const stop = Bun.spawnSync(["bun", join(REPO, "hooks/work-hold.ts")], { timeout: 120_000,
    stdin: Buffer.from(JSON.stringify({ session_id: session })),
    env: e,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    armOut,
    armLog,
    log: readFileSync(applied, "utf8").trim().split("\n"),
    state,
    user: readFileSync(user, "utf8"),
    seed,
    local,
    stop,
  };
}

test("a bridge id sends over agent-msg, and herdr is never called", () => {
  const r = armAndRelease("cap-tx-1", "session_abc123", false);
  expect(r.armOut).toContain("capped at 250000");
  expect(r.armOut).toContain("over agent-msg");
  expect(r.armLog).toEqual(["agent-msg cse_abc123 250000"]);
  // The cse is resolved at ARM time and carried in the one state object, so the release does not
  // depend on the Stop hook's own env.
  expect(r.state.compact.cse).toBe("cse_abc123");
  expect(r.log).toEqual(["agent-msg cse_abc123 250000", "agent-msg cse_abc123 auto"]);
  expect(existsSync(r.local)).toBe(false);
  expect(r.user).toBe(r.seed);
});

test("an agent-msg that refuses falls back to the herdr pane", () => {
  const r = armAndRelease("cap-tx-2", "session_def456", true);
  expect(r.armOut).toContain("over herdr");
  expect(r.log).toEqual(["250000", "auto"]);
  expect(r.state.compact.cse).toBe("cse_def456");
  expect(existsSync(r.local)).toBe(false);
  expect(r.user).toBe(r.seed);
});

test("no transport at all skips the cap and writes no local file", () => {
  const dir = tmp("holdcap-tx-");
  const project = join(dir, "project");
  mkdirSync(project, { recursive: true });
  const session = "cap-tx-3";
  const user = join(dir, "settings.json");
  writeFileSync(user, "{}\n");
  const arm = Bun.spawnSync(
    ["bash", join(REPO, "skills/work/scripts/work-hold.sh"), "exit 1", "--rounds", "8"],
    { timeout: 120_000,
      env: { ...env(dir, session, "/nonexistent-herdr", user, project) },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = arm.stdout.toString() + arm.stderr.toString();
  expect(out).toContain("Not capped");
  expect(out).toContain("no agent-msg id and no Herdr pane");
  expect(existsSync(join(project, ".claude", "settings.local.json"))).toBe(false);
});
