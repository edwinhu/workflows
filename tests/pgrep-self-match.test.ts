import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(import.meta.dir);
const HOOK = join(ROOT, "hooks", "pgrep-self-match.ts");

interface Result {
  status: number;
  stdout: string;
  decision: string | null;
  reason: string | null;
  warning: string | null;
  ms: number;
}

function runRaw(stdin: string): Result {
  const t0 = Date.now();
  const r = spawnSync("bun", [HOOK], { input: stdin, encoding: "utf8" });
  const ms = Date.now() - t0;
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
  return { status: r.status ?? -1, stdout, decision, reason, warning, ms };
}

function run(command: string, toolName = "Bash"): Result {
  const res = runRaw(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      cwd: "/home/eh/projects/workflows",
      session_id: "test-session",
      tool_input: { command },
    }),
  );
  // A hook that exits non-zero is treated as NON-BLOCKING; a gate must never do that.
  expect(res.status).toBe(0);
  return res;
}

/** The exact 2026-09-28 incident: both patterns bracketed, and it killed the invoking shell. */
const INCIDENT =
  "pkill -f '[f]arm.sh --tasks .*tasks11.json'; sleep 2; pgrep -f '[t]asks11.json' | xargs -r kill";

// ── THE SELF-TEST DENIES ───────────────────────────────────────────────────────────────────────

test("the incident command denies", () => {
  const r = run(INCIDENT);
  expect(r.decision).toBe("deny");
  // The bracketed spelling, not the bare literal: the gate's own message must not carry text that
  // would itself match the pattern being complained about.
  expect(r.reason).toContain("[t]asks11.json");
  expect(r.reason).not.toContain("'tasks11.json'");
  expect(r.reason).toContain("own text");
  expect(r.reason).toContain("bracket the pattern");
});

test("a self-matching wait loop denies (it would never exit)", () => {
  const r = run("while pgrep -f worker.py; do sleep 5; done");
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("worker.py");
  expect(r.reason).toContain("never exits");
});

test("bare pkill -f denies and says it kills its own shell", () => {
  const r = run("pkill -f myjob");
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("kill it");
});

test("an absolute-path pattern is a self-match too (the old exemption was wrong)", () => {
  expect(run("pgrep -f /usr/bin/worker").decision).toBe("deny");
});

test("combined short flags and --full are parsed", () => {
  expect(run("pgrep -af 'claude -p'").decision).toBe("deny");
  expect(run("pgrep --full foo").decision).toBe("deny");
  expect(run("set -e; pgrep -fl myjob | wc -l").decision).toBe("deny");
});

// ── NO SELF-MATCH: SILENT ALLOW ────────────────────────────────────────────────────────────────

test("a bracketed pattern that does not self-match is allowed silently", () => {
  expect(run("pgrep -f '[w]orker.py'").stdout).toBe("");
});

test("a bracketed pkill is allowed silently", () => {
  expect(run("pkill -f '[w]orker'").stdout).toBe("");
});

test("a bracketed pgrep fed into kill is allowed silently", () => {
  expect(run("pgrep -f '[w]orker' | xargs -r kill").stdout).toBe("");
  expect(run("kill $(pgrep -f '[w]orker')").stdout).toBe("");
});

test("pgrep -x is untouched", () => {
  expect(run("pgrep -x worker").stdout).toBe("");
  expect(run("pkill -x worker").stdout).toBe("");
});

test("pgrep without -f is untouched", () => {
  expect(run("pgrep worker").stdout).toBe("");
  expect(run("pgrep worker | xargs -r kill").stdout).toBe("");
});

test("a command with no pgrep at all is untouched", () => {
  expect(run("ls -la && echo done").stdout).toBe("");
});

test("pgrep text inside quotes is not a command position", () => {
  expect(run('echo "pgrep -f x"').stdout).toBe("");
  expect(run("printf '%s\\n' 'pgrep -f x'").stdout).toBe("");
});

test("an explicit $$ exclusion suppresses the deny", () => {
  expect(run("pgrep -f myjob | grep -v $$").stdout).toBe("");
});

// ── PATTERNS THE TEXT CANNOT SETTLE: ALLOW SILENTLY ────────────────────────────────────────────
// pgrep itself reports an uncompilable pattern; with no model layer left there is nothing to judge.

test("a pattern that will not compile is allowed silently", () => {
  expect(run("pgrep -f '[unclosed'").stdout).toBe("");
  expect(run("pkill -f '[unclosed'").stdout).toBe("");
});

test("a POSIX character class does not crash the gate", () => {
  const r = run("pgrep -f '[[:alpha:]]+job'");
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
});

// ── rg WITH NO PATH: IT READS A STDIN THAT NEVER CLOSES ────────────────────────────────────────
// Measured 2026-09-28, ripgrep 15.2.0, stdin a fifo held open by a sleeping writer: `rg foo` blocks
// until killed (exit 124) and `rg foo .` exits 0 immediately. See the hook header.

/** The exact 2026-09-28 command that hung for 34 minutes. Note the pipe is on the WRONG side. */
const RG_INCIDENT = "rg -n -i craft --hidden -g '!.git' -g '!CHANGELOG.md' -c | sort";

test("the rg incident command denies with the one-line fix", () => {
  const r = run(RG_INCIDENT);
  expect(r.decision).toBe("deny");
  expect(r.reason).toContain("no path argument");
  expect(r.reason).toContain("rg reads stdin when given no path");
  expect(r.reason).toContain("rg PATTERN .");
});

test("a path argument allows", () => {
  expect(run("rg -n foo .").stdout).toBe("");
  expect(run("rg -n foo src tests").stdout).toBe("");
});

test("a segment fed by a pipe allows — stdin is a source that ends", () => {
  expect(run("echo x | rg foo").stdout).toBe("");
  expect(run("cmd | rg -c foo | sort").stdout).toBe("");
});

test("an input redirect allows", () => {
  expect(run("rg foo < file").stdout).toBe("");
  expect(run("rg foo <file").stdout).toBe("");
  expect(run("rg foo <<< \"$text\"").stdout).toBe("");
});

test("-e/-f supply the pattern, so the FIRST positional is already a path", () => {
  // No positional at all: the pattern came from the flag and there is still no path.
  expect(run("rg -e foo -e bar").decision).toBe("deny");
  expect(run("rg -f patterns.txt").decision).toBe("deny");
  // One positional IS the path.
  expect(run("rg -e foo src").stdout).toBe("");
  expect(run("rg -f patterns.txt src").stdout).toBe("");
});

test("a value-taking flag's operand is not a path", () => {
  expect(run("rg -g '!x' foo").decision).toBe("deny");
  expect(run("rg -t py foo").decision).toBe("deny");
  expect(run("rg -C 3 foo").decision).toBe("deny");
  expect(run("rg --max-depth 2 foo").decision).toBe("deny");
  expect(run("rg --glob=*.ts foo").decision).toBe("deny");
  // ...and the same flags allow once a real path follows.
  expect(run("rg -g '!x' foo .").stdout).toBe("");
  expect(run("rg -C 3 foo src").stdout).toBe("");
});

test("no-pattern modes never read stdin and are allowed", () => {
  expect(run("rg --files").stdout).toBe("");
  expect(run("rg --files -g '*.ts'").stdout).toBe("");
  expect(run("rg --version").stdout).toBe("");
  expect(run("rg --help").stdout).toBe("");
  expect(run("rg --type-list").stdout).toBe("");
});

test("rg with no pattern at all is a usage error, not a hang", () => {
  // Verified: exit 2, immediate — rg never reaches stdin.
  expect(run("rg").stdout).toBe("");
  expect(run("rg -c").stdout).toBe("");
});

test("an explicit `-` is the deliberate read-stdin spelling", () => {
  expect(run("rg foo -").stdout).toBe("");
});

test("rga is guarded the same way", () => {
  expect(run("rga -i foo").decision).toBe("deny");
  expect(run("rga -i foo .").stdout).toBe("");
});

test("rg text inside quotes is not a command position", () => {
  expect(run('echo "rg foo"').stdout).toBe("");
  expect(run("printf '%s\\n' 'rg foo'").stdout).toBe("");
});

test("an output redirect is not a path", () => {
  expect(run("rg foo > out.txt").decision).toBe("deny");
  expect(run("rg foo 2>/dev/null").decision).toBe("deny");
  expect(run("rg foo . > out.txt").stdout).toBe("");
});

test("`--` ends the flags and the positionals still count", () => {
  expect(run("rg -- -foo").decision).toBe("deny");
  expect(run("rg -- -foo .").stdout).toBe("");
});

test("a command with no rg at all is untouched", () => {
  expect(run("grep -r foo").stdout).toBe("");
  expect(run("xargs rg foo").stdout).toBe("");
});

// ── PAYLOAD SHAPES ─────────────────────────────────────────────────────────────────────────────

test("reads the Monitor tool payload the same way", () => {
  expect(run("pkill -f myjob", "Monitor").decision).toBe("deny");
  expect(run(RG_INCIDENT, "Monitor").decision).toBe("deny");
  expect(run("rg -n foo .", "Monitor").stdout).toBe("");
});

test("silent when tool_input carries no command", () => {
  const r = runRaw(JSON.stringify({ tool_name: "Bash", tool_input: {} }));
  expect(r.status).toBe(0);
  expect(r.stdout).toBe("");
});

// ── CRASH POLICY: A BLOCKING GATE DENIES ON A PAYLOAD IT CANNOT READ ───────────────────────────

test("malformed JSON denies rather than silently allowing", () => {
  const r = runRaw("not json at all {");
  expect(r.status).toBe(0);
  expect(r.decision).toBe("deny");
});

test("a non-object payload denies", () => {
  expect(runRaw("[1,2,3]").decision).toBe("deny");
});

// ── NO MODEL LAYER ─────────────────────────────────────────────────────────────────────────────

test("the hook consults nothing: no hound import, no decisions call, no child process", () => {
  const src = readFileSync(HOOK, "utf8");
  for (const needle of ["hound", "decisions", "decisionsCall", "jev", "Jev", "JEV", "spawnSync", "child_process", "fetch("]) {
    expect(src).not.toContain(needle);
  }
});

test("a decision is text-only and returns fast", () => {
  // A network or subprocess leg cost seconds; the whole gate is now bun startup plus a regex.
  expect(run(INCIDENT).ms).toBeLessThan(3000);
  expect(run("pkill -f '[w]orker'").ms).toBeLessThan(3000);
});

// ── REGISTRATION ───────────────────────────────────────────────────────────────────────────────

test("registered in the plugin mod as PreToolUse for Bash|Monitor, and no longer spawned by hooks.json", async () => {
  const { GUARDS } = await import("../hooks/guards/mod.ts");
  const spec = GUARDS.find((g: { script: string }) => g.script === "pgrep-self-match.ts");
  expect(spec).toBeDefined();
  expect(spec.event).toBe("PreToolUse");
  expect([...spec.tools].sort()).toEqual(["Bash", "Monitor"]);
  // Exactly one registration: the settings hook and the mod both running would judge every call twice.
  expect(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).not.toContain("pgrep-self-match.ts");
});
