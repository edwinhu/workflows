import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(import.meta.dir);
const HOOK = join(ROOT, "hooks", "pgrep-self-match.ts");

/** Run the hook over a raw stdin string; return its exit code and stdout. */
function runRaw(stdin: string): { status: number; stdout: string } {
  const r = spawnSync("bun", [HOOK], { input: stdin, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

function run(command: string, toolName = "Bash"): { status: number; stdout: string } {
  return runRaw(JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { command },
  }));
}

/** The warning text, or null when the hook stayed silent. */
function warning(command: string, toolName = "Bash"): string | null {
  const { status, stdout } = run(command, toolName);
  expect(status).toBe(0);
  if (!stdout.trim()) return null;
  const parsed = JSON.parse(stdout);
  // WARN-ONLY: never a decision, on any input.
  expect(parsed.hookSpecificOutput.permissionDecision).toBeUndefined();
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  return parsed.hookSpecificOutput.additionalContext as string;
}

// ── FLAGGED ────────────────────────────────────────────────────────────────────────────────────

test("flags the wait loop that never exits", () => {
  const w = warning("while pgrep -f worker.py; do sleep 5; done");
  expect(w).toContain("worker.py");
  expect(w).toContain("own command line");
  expect(w).toContain("[x]yz");
});

test("flags pkill -f", () => {
  expect(warning("pkill -f myjob")).toContain("pkill -f 'myjob'");
});

test("flags combined short flags containing f", () => {
  expect(warning("pgrep -af 'claude -p'")).toContain("claude -p");
});

test("flags --full", () => {
  expect(warning("pgrep --full foo")).toContain("pgrep -f 'foo'");
});

test("flags -fl", () => {
  expect(warning("pgrep -fl worker")).toContain("worker");
});

test("flags a pgrep buried later in a pipeline", () => {
  expect(warning("set -e; pgrep -f myjob | wc -l")).toContain("myjob");
});

// ── NOT FLAGGED ────────────────────────────────────────────────────────────────────────────────

test("does not flag the bracket-class form", () => {
  expect(warning("pgrep -f '[w]orker.py'")).toBeNull();
});

test("does not flag -x (not a -f match at all)", () => {
  expect(warning("pgrep -x worker")).toBeNull();
});

test("does not flag pgrep without -f", () => {
  expect(warning("pgrep worker")).toBeNull();
});

test("does not flag an absolute-path anchored pattern", () => {
  expect(warning("pgrep -f /usr/bin/worker")).toBeNull();
});

test("does not flag a command with no pgrep at all", () => {
  expect(warning("ls -la && echo done")).toBeNull();
});

test("does not flag an explicit $$ exclusion", () => {
  expect(warning("pgrep -f myjob | grep -v $$")).toBeNull();
});

test("does not flag pgrep text quoted inside echo", () => {
  expect(warning('echo "pgrep -f x"')).toBeNull();
});

test("does not flag pgrep text in a single-quoted argument", () => {
  expect(warning("printf '%s\\n' 'pgrep -f x'")).toBeNull();
});

// ── PAYLOAD SHAPES ─────────────────────────────────────────────────────────────────────────────

test("reads the Monitor tool payload the same way", () => {
  expect(warning("pgrep -f myjob", "Monitor")).toContain("myjob");
});

test("silent when tool_input carries no command", () => {
  const { status, stdout } = runRaw(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  expect(status).toBe(0);
  expect(stdout).toBe("");
});

// ── CRASH PATH: FAIL OPEN ──────────────────────────────────────────────────────────────────────

test("malformed JSON exits 0 with no output", () => {
  const { status, stdout } = runRaw("not json at all {");
  expect(status).toBe(0);
  expect(stdout).toBe("");
});

test("a non-object payload exits 0 with no output", () => {
  const { status, stdout } = runRaw("[1,2,3]");
  expect(status).toBe(0);
  expect(stdout).toBe("");
});

test("empty stdin exits 0 with no output", () => {
  const { status, stdout } = runRaw("");
  expect(status).toBe(0);
  expect(stdout).toBe("");
});

// ── REGISTRATION ───────────────────────────────────────────────────────────────────────────────

test("registered in hooks.json as PreToolUse for Bash|Monitor", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
  const entry = cfg.hooks.PreToolUse.find((e: { matcher: string }) => e.matcher === "Bash|Monitor");
  expect(entry).toBeDefined();
  expect(entry.hooks.some((h: { command: string }) => h.command.includes("pgrep-self-match.ts"))).toBe(true);
});
