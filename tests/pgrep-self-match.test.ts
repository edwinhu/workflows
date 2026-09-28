import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = dirname(import.meta.dir);
const HOOK = join(ROOT, "hooks", "pgrep-self-match.ts");

/**
 * NO NETWORK. Every run sets `PGREP_GUARD_JEV_REPLY`, the hook's documented test seam, so the Jev
 * transport is never reached. HIGH/LOW are Decisions replies; UNAVAILABLE simulates the endpoint
 * being down.
 *
 * The seam is also how "the hook did not consult Jev" is PROVEN rather than assumed: a run with HIGH
 * that stays silent cannot have asked, because any answer at that probability produces output.
 */
const HIGH = JSON.stringify({ answers: { overbroad: { type: "noul", noul: 0.95 } } });
const LOW = JSON.stringify({ answers: { overbroad: { type: "noul", noul: 0.05 } } });
const UNAVAILABLE = "UNAVAILABLE";

interface Result {
  status: number;
  stdout: string;
  decision: string | null;
  reason: string | null;
  warning: string | null;
}

function runRaw(stdin: string, jev: string, tmp?: string): Result {
  const r = spawnSync("bun", [HOOK], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, PGREP_GUARD_JEV_REPLY: jev, ...(tmp ? { TMPDIR: tmp } : {}) },
  });
  const stdout = r.stdout ?? "";
  let decision: string | null = null;
  let reason: string | null = null;
  let warning: string | null = null;
  if (stdout.trim()) {
    const o = JSON.parse(stdout).hookSpecificOutput;
    decision = o.permissionDecision ?? null;
    reason = o.permissionDecisionReason ?? null;
    warning = o.additionalContext ?? null;
  }
  return { status: r.status ?? -1, stdout, decision, reason, warning };
}

function run(command: string, jev: string, toolName = "Bash", tmp?: string): Result {
  const res = runRaw(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      cwd: "/home/eh/projects/workflows",
      session_id: "test-session",
      tool_input: { command },
    }),
    jev,
    tmp,
  );
  // A hook that exits non-zero is treated as NON-BLOCKING; a gate must never do that.
  expect(res.status).toBe(0);
  return res;
}

/** The exact 2026-09-28 incident: both patterns bracketed, and it killed the invoking shell. */
const INCIDENT =
  "pkill -f '[f]arm.sh --tasks .*tasks11.json'; sleep 2; pgrep -f '[t]asks11.json' | xargs -r kill";

// ── LAYER 1: DETERMINISTIC SELF-MATCH DENIES ───────────────────────────────────────────────────

test("the incident command denies deterministically, with Jev unavailable", () => {
  const r = run(INCIDENT, UNAVAILABLE);
  expect(r.decision).toBe("deny");
  // The bracketed spelling, not the bare literal: the gate's own message must not carry text that
  // would itself match the pattern being complained about.
  expect(r.reason).toContain("[t]asks11.json");
  expect(r.reason).not.toContain("'tasks11.json'");
  expect(r.reason).toContain("own text");
  expect(r.reason).toContain("bracket the pattern");
});

test("a self-matching wait loop denies (it would never exit)", () => {
  const r = run("while pgrep -f worker.py; do sleep 5; done", UNAVAILABLE);
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("worker.py");
  expect(r.reason).toContain("never exits");
});

test("bare pkill -f denies and says it kills its own shell", () => {
  const r = run("pkill -f myjob", UNAVAILABLE);
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("kill it");
});

test("an absolute-path pattern is a self-match too (the old exemption was wrong)", () => {
  expect(run("pgrep -f /usr/bin/worker", UNAVAILABLE).decision).toBe("deny");
});

test("combined short flags and --full are parsed", () => {
  expect(run("pgrep -af 'claude -p'", UNAVAILABLE).decision).toBe("deny");
  expect(run("pgrep --full foo", UNAVAILABLE).decision).toBe("deny");
  expect(run("set -e; pgrep -fl myjob | wc -l", UNAVAILABLE).decision).toBe("deny");
});

// ── LAYER 2: JEV, KILL-SHAPED vs READ-ONLY ─────────────────────────────────────────────────────

test("a bracketed pattern that does not self-match is allowed when Jev is low", () => {
  const r = run("pgrep -f '[w]orker.py'", LOW);
  expect(r.stdout).toBe("");
});

test("read-only pgrep over threshold WARNS, never denies", () => {
  const r = run("pgrep -f '[w]orker.py'", HIGH);
  expect(r.decision).toBeNull();
  expect(r.warning).toContain("95%");
  expect(r.warning).toContain("Reading is not fatal");
});

test("kill-shaped pkill over threshold denies", () => {
  const r = run("pkill -f '[w]orker'", HIGH);
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("95%");
  expect(r.reason).toContain("other than the intended one");
});

test("kill-shaped pkill under threshold is allowed", () => {
  expect(run("pkill -f '[w]orker'", LOW).stdout).toBe("");
});

test("pgrep piped into xargs kill counts as kill-shaped", () => {
  const r = run("pgrep -f '[w]orker' | xargs -r kill", HIGH);
  expect(r.decision).toBe("deny");
});

test("kill $(pgrep ...) counts as kill-shaped", () => {
  const r = run("kill $(pgrep -f '[w]orker')", HIGH);
  expect(r.decision).toBe("deny");
});

test("Jev unavailable on a kill allows, with a warning that the check did not run", () => {
  const r = run("pkill -f '[w]orker'", UNAVAILABLE);
  expect(r.decision).toBeNull();
  expect(r.warning).toContain("did not run");
  expect(r.warning).toContain("bracket the pattern");
});

test("Jev unavailable on a read-only pgrep is silent", () => {
  expect(run("pgrep -f '[w]orker'", UNAVAILABLE).stdout).toBe("");
});

// ── NOT CONSULTED AT ALL ───────────────────────────────────────────────────────────────────────
// HIGH would produce output if the hook asked, so silence here proves no Jev call was made.

test("pgrep -x is untouched and never reaches Jev", () => {
  expect(run("pgrep -x worker", HIGH).stdout).toBe("");
  expect(run("pkill -x worker", HIGH).stdout).toBe("");
});

test("pgrep without -f and without a kill is untouched", () => {
  expect(run("pgrep worker", HIGH).stdout).toBe("");
});

test("a command with no pgrep at all is untouched", () => {
  expect(run("ls -la && echo done", HIGH).stdout).toBe("");
});

test("pgrep text inside quotes is not a command position", () => {
  expect(run('echo "pgrep -f x"', HIGH).stdout).toBe("");
  expect(run("printf '%s\\n' 'pgrep -f x'", HIGH).stdout).toBe("");
});

test("an explicit $$ exclusion suppresses the deterministic deny", () => {
  const r = run("pgrep -f myjob | grep -v $$", LOW);
  expect(r.decision).toBeNull();
});

// ── PATTERNS TEXT CANNOT DECIDE ────────────────────────────────────────────────────────────────

test("a pattern that will not compile is handed to Jev, not denied deterministically", () => {
  const unavail = run("pgrep -f '[unclosed'", UNAVAILABLE);
  expect(unavail.decision).toBeNull();
  const high = run("pgrep -f '[unclosed'", HIGH);
  expect(high.decision).toBeNull(); // read-only
  expect(high.warning).toContain("95%");
  expect(run("pkill -f '[unclosed'", HIGH).decision).toBe("deny");
});

test("a POSIX character class does not crash the gate", () => {
  const r = run("pgrep -f '[[:alpha:]]+job'", LOW);
  expect(r.status).toBe(0);
  expect(r.decision).toBeNull();
});

// ── PAYLOAD SHAPES ─────────────────────────────────────────────────────────────────────────────

test("reads the Monitor tool payload the same way", () => {
  const r = run("pkill -f myjob", UNAVAILABLE, "Monitor");
  expect(r.decision).toBe("deny");
});

test("a Monitor warning carries the Monitor event name", () => {
  const r = run("pgrep -f '[w]orker.py'", HIGH, "Monitor");
  const o = JSON.parse(r.stdout).hookSpecificOutput;
  expect(o.hookEventName).toBe("PreToolUse"); // the payload's hook_event_name, not the tool name
  expect(o.additionalContext).toContain("95%");
});

test("silent when tool_input carries no command", () => {
  const r = runRaw(JSON.stringify({ tool_name: "Bash", tool_input: {} }), HIGH);
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
});

// ── CRASH POLICY: A BLOCKING GATE DENIES ON A PAYLOAD IT CANNOT READ ───────────────────────────

test("malformed JSON denies rather than silently allowing", () => {
  const r = runRaw("not json at all {", HIGH);
  expect(r.status).toBe(0);
  expect(r.decision).toBe("deny");
});

test("a non-object payload denies", () => {
  expect(runRaw("[1,2,3]", HIGH).decision).toBe("deny");
});

// ── AUDIT LOG ──────────────────────────────────────────────────────────────────────────────────

test("every Jev decision appends one JSONL line under TMPDIR", () => {
  const tmp = mkdtempSync(join(tmpdir(), "pgrep-guard-test-"));
  run("pkill -f '[w]orker'", HIGH, "Bash", tmp);
  run("pgrep -f '[w]orker.py'", LOW, "Bash", tmp);
  const dir = join(tmp, "pgrep-guard");
  const files = readdirSync(dir);
  expect(files.length).toBe(1);
  const lines = readFileSync(join(dir, files[0]), "utf8").trim().split("\n").map(l => JSON.parse(l));
  expect(lines.length).toBe(2);
  expect(lines[0].p).toBe(0.95);
  expect(lines[0].decision).toBe("deny");
  expect(lines[0].kill_shaped).toBe(true);
  expect(lines[0].cmd_sha256).toMatch(/^[0-9a-f]{16}$/);
  expect(lines[1].decision).toBe("allow");
});

test("a deterministic deny does not consult Jev and writes no log line", () => {
  const tmp = mkdtempSync(join(tmpdir(), "pgrep-guard-test-"));
  expect(run("pkill -f myjob", HIGH, "Bash", tmp).decision).toBe("deny");
  expect(readdirSync(tmp)).toEqual([]);
});

// ── REGISTRATION ───────────────────────────────────────────────────────────────────────────────

test("registered in hooks.json as PreToolUse for Bash|Monitor", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
  const entry = cfg.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash|Monitor");
  expect(entry).toBeDefined();
  expect(entry.hooks.some((h: { command: string }) => h.command.includes("pgrep-self-match.ts"))).toBe(true);
});
