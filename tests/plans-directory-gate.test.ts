import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCRIPT = join(ROOT, "scripts", "ensure-plans-directory.ts");
const GATE = join(ROOT, "hooks", "plans-directory-restart-gate.ts");

let sandbox: string;
let tmpOverride: string;
let project: string;
let fakeHome: string;

/** Each case gets its own HOME so markers never leak between tests or onto the real machine. */
function runScript(sessionId?: string) {
  const proc = Bun.spawnSync(["bun", SCRIPT, ...(sessionId ? [sessionId] : [])], {
    cwd: project,
    env: { ...process.env, HOME: fakeHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { out: new TextDecoder().decode(proc.stdout), code: proc.exitCode };
}

function runGate(payload: Record<string, unknown>) {
  const proc = Bun.spawnSync(["bun", GATE], {
    env: { ...process.env, HOME: fakeHome, TMPDIR: tmpOverride },
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = new TextDecoder().decode(proc.stdout).trim();
  return { out, denied: out.includes('"permissionDecision": "deny"'), code: proc.exitCode };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "plans-gate-"));
  project = join(sandbox, "proj");
  fakeHome = join(sandbox, "home");
  mkdirSync(project, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  tmpOverride = process.env.TMPDIR ?? "";
  Bun.spawnSync(["git", "init", "-q", project]);
});
afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

describe("plans directory restart gate", () => {
  test("a session that had to create the setting is denied plan mode until it restarts", () => {
    const { out } = runScript("session-alpha");
    expect(out).toContain("created");
    expect(out).toContain("RESTART REQUIRED");
    expect(JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8"))).toEqual({ plansDirectory: "./.planning" });

    // The condition is the whole point: entry is refused, not just approval.
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "session-alpha" }).denied).toBe(true);
    expect(runGate({ tool_name: "ExitPlanMode", session_id: "session-alpha" }).denied).toBe(true);
  });

  test("the deny names the settings file and demands a restart", () => {
    runScript("session-alpha");
    const { out } = runGate({ tool_name: "EnterPlanMode", session_id: "session-alpha" });
    expect(out).toContain(join(project, ".claude/settings.json"));
    expect(out).toContain("RESTART THIS SESSION");
  });

  test("the restarted session is not denied — the marker is keyed to the session that ran the script", () => {
    runScript("session-alpha");
    // A restarted session has a new id, finds no marker, and needs no cleanup step to have happened.
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "session-beta" }).denied).toBe(false);
    // And re-running the preamble there is a no-op that writes no new marker.
    const second = runScript("session-beta");
    expect(second.out).toContain("already set");
    expect(second.out).not.toContain("RESTART");
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "session-beta" }).denied).toBe(false);
  });

  test("a project that was already correct never marks its session", () => {
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude/settings.json"), JSON.stringify({ plansDirectory: "./.planning" }));
    const { out } = runScript("session-gamma");
    expect(out).toContain("already set");
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "session-gamma" }).denied).toBe(false);
  });

  test("an existing settings.json is merged, not overwritten", () => {
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));
    runScript("session-delta");
    const merged = JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8"));
    expect(merged.permissions).toEqual({ allow: ["Bash(ls:*)"] });
    expect(merged.plansDirectory).toBe("./.planning");
  });

  test("settings.json the script cannot parse is left byte-identical and still marks the session", () => {
    mkdirSync(join(project, ".claude"), { recursive: true });
    const jsonc = '{\n  // a comment\n  "model": "opus"\n}\n';
    writeFileSync(join(project, ".claude/settings.json"), jsonc);
    const { out } = runScript("session-epsilon");
    expect(out).toContain("WARNING");
    expect(readFileSync(join(project, ".claude/settings.json"), "utf8")).toBe(jsonc);
    // The setting is absent either way, so the session is still unsafe to plan in.
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "session-epsilon" }).denied).toBe(true);
  });

  test("the gate is inert for every other tool and for a session with no id", () => {
    runScript("session-alpha");
    expect(runGate({ tool_name: "Write", session_id: "session-alpha" }).denied).toBe(false);
    expect(runGate({ tool_name: "Bash", session_id: "session-alpha" }).denied).toBe(false);
    expect(runGate({ tool_name: "EnterPlanMode" }).denied).toBe(false);
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "" }).denied).toBe(false);
  });

  test("running the script by hand writes no marker — an unkeyed one would deny every session forever", () => {
    const { out } = runScript();
    expect(out).toContain("RESTART REQUIRED");
    expect(runGate({ tool_name: "EnterPlanMode", session_id: "session-anything" }).denied).toBe(false);
  });

  test(".planning/ is gitignored and settings.json is not", () => {
    runScript("session-alpha");
    expect(readFileSync(join(project, ".gitignore"), "utf8")).toContain(".planning/");
    const ignored = (p: string) => Bun.spawnSync(["git", "check-ignore", "-q", p], { cwd: project }).exitCode === 0;
    expect(ignored(".planning/generated-native-plan.md")).toBe(true);
    expect(ignored(".claude/settings.json")).toBe(false);
  });
});

describe("registration", () => {
  test("the gate is registered in hooks.json, not only in skill frontmatter", () => {
    // v5.106.3: skill-frontmatter registration is inert for anything that must fire outside an
    // active skill. hooks.json is the surface confirmed to run whenever the plugin is enabled.
    const config = JSON.parse(readFileSync(join(ROOT, "hooks/hooks.json"), "utf8"));
    const entries = config.hooks.PreToolUse.filter((e: { matcher?: string }) => e.matcher === "EnterPlanMode|ExitPlanMode");
    expect(entries).toHaveLength(1);
    expect(entries[0].hooks[0].command).toContain("plans-directory-restart-gate.ts");
  });

  test("every workflow entry skill that may run a preamble does, and passes the session id", () => {
    // Without the session id the script cannot key a marker, and the gate it feeds goes dark.
    for (const skill of ["dev", "ds", "writing", "work", "workshop"]) {
      const body = readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8");
      expect(body).toContain("scripts/ensure-plans-directory.ts ${CLAUDE_SESSION_ID}");
    }
  });

  test("the two workflow-creator entries are deliberately excluded, and the reason is a real contract", () => {
    // `tests/workflow-creator-entry-contract.test.mjs:38` forbids a literal bang-backtick anywhere in
    // workflow-creator's body: that skill's prose and fences DISCUSS skill content, and load-time
    // interpolation fires inside fenced blocks too. A deliberate preamble is indistinguishable from
    // the accidental one that ban exists to catch, so those two entries get no preamble — they rely
    // on new_project.sh, or on another workflow having already run in the same repo. Asserted rather
    // than commented so that deleting the ban forces this exclusion to be revisited.
    const contract = readFileSync(join(ROOT, "tests/workflow-creator-entry-contract.test.mjs"), "utf8");
    expect(contract).toContain('not.toContain("!`")');
    for (const skill of ["workflow-creator", "workflow-creator-improve"]) {
      expect(readFileSync(join(ROOT, "skills", skill, "SKILL.md"), "utf8")).not.toContain("ensure-plans-directory.ts");
    }
  });

  test("the marker survives a TMPDIR the writer sees and the reader does not", () => {
    // THE DEFECT THIS PINS. The preamble runs in a profile-initialized shell; the hook does not.
    // Measured 2026-08-04: the author's login shell exports TMPDIR=/home/eh/.tmp while a subprocess
    // spawned without the profile sees it unset. A gettempdir()-based marker therefore resolved to
    // two different directories, and the gate permitted every session it exists to stop. The
    // original tests forced TMPDIR on BOTH sides, so they passed while the gate was dead.
    const withTmp = Bun.spawnSync(["bun", SCRIPT, "session-zeta"], {
      cwd: project,
      env: { ...process.env, HOME: fakeHome, TMPDIR: join(sandbox, "writer-only-tmp") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(withTmp.stdout)).toContain("RESTART REQUIRED");
    // Reader with NO TMPDIR at all must still find what that writer wrote.
    const proc = Bun.spawnSync(["bun", GATE], {
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "TMPDIR")), HOME: fakeHome },
      stdin: Buffer.from(JSON.stringify({ tool_name: "EnterPlanMode", session_id: "session-zeta" })),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(proc.stdout)).toContain('"permissionDecision": "deny"');
  });

  test("the marker path helper is shared by writer and reader", () => {
    // A writer and reader that computed the path separately could drift, and a gate that reads the
    // wrong directory is indistinguishable from a gate that passed.
    expect(readFileSync(SCRIPT, "utf8")).toContain("lib/plans-restart-marker.ts");
    expect(readFileSync(GATE, "utf8")).toContain("lib/plans-restart-marker.ts");
    expect(existsSync(join(ROOT, "hooks/lib/plans-restart-marker.ts"))).toBe(true);
  });
});
