// The delegation boundary must follow the EPISODE, not the skill in context.
//
// WHY THIS EXISTS
//   `showClearContextOnPlanAccept` defaults to true. Accepting a plan therefore clears context and
//   starts a NEW session whose whole first message is "Implement the following plan: …". No skill is
//   loaded there, so no skill-frontmatter hook is registered, so `orchestrator-mutation-guard` did
//   not exist — at precisely the moment IMPLEMENT begins, which is the only beat it is for.
//
//   Measured 2026-08-06 in two adjacent transcripts of one project:
//     e64e6d1d  /writing then /work loaded. `git add` DENIED 16:13:25. Edit to the manuscript
//               DENIED 16:21:48. The guard works when it is registered.
//     8a748899  began 16:37:23 — the same second the first ended, on plan accept — invoked NO
//               skill, and made 32 unguarded Edits to that same manuscript, 0 Agent dispatches.
//
//   Nothing failed. The guard was absent, and absence is silent. Two prior test suites
//   (beat-adoption reachability and router shape) were BOTH green throughout, because neither asks
//   whether enforcement is reachable from a session with no skill loaded. That is what this asks.
//
// Run: bun tests/cleared-context-guard.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const GUARD = join(ROOT, "hooks", "orchestrator-mutation-guard.ts");
let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { PASS++; console.log(`  ok   ${name}`); }
  else { FAIL++; console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); }
};

const HASH = "a".repeat(64);
function project({ marker = true, episode = true, exited = false, workflow = "writing" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cleared-"));
  mkdirSync(join(dir, ".planning", ".state"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  if (marker) writeFileSync(join(dir, ".claude-workflows.json"), JSON.stringify({ governed: true }));
  if (episode) {
    writeFileSync(join(dir, ".planning", ".state", "episode.json"), JSON.stringify({
      schemaVersion: 1, workflow, planFile: "p.md", planHash: HASH, sessionId: "s",
      phases: { clarified: "2026-08-06T04:45:25.074Z" }, reviewOwed: false, reviewBlocks: 0,
      exit: exited ? { at: "2026-08-06T05:00:00.000Z", reason: "completed" } : null,
      editsSinceVerify: 0, planBindingBlocks: 0,
    }));
  }
  return dir;
}

/** Run the guard with NO `--workflow` — i.e. the plugin-wide registration, no skill loaded. */
function ambient(dir, tool, input) {
  const stdin = JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: tool, tool_input: input,
    cwd: dir, session_id: "s", tool_use_id: "t", permission_mode: "default",
  });
  const r = spawnSync("bun", [GUARD], { input: stdin, encoding: "utf8" });
  if (r.status !== 0) return { denied: false, error: `exit ${r.status} ${r.stderr}` };
  return { denied: /"permissionDecision":\s*"deny"/.test(r.stdout), stdout: r.stdout };
}

const EDIT = f => ["Edit", { file_path: f, old_string: "a", new_string: "b" }];

console.log("a cleared-context session is still bounded by the episode on disk");
{
  const dir = project();
  const [t, i] = EDIT(join(dir, "src", "app.py"));
  ok("main-chat Edit to a source file is DENIED with no skill loaded", ambient(dir, t, i).denied);
  ok("Write into .planning is still ALLOWED (the orchestrator's own directory)",
    !ambient(dir, "Write", { file_path: join(dir, ".planning", "notes.md"), content: "x" }).denied);
  rmSync(dir, { recursive: true, force: true });
}

// THE INVARIANT THAT MUST NEVER REGRESS. This hook now runs in EVERY project of every user, so a
// project that never opted into governance must be byte-for-byte untouched.
console.log("\nungoverned and episode-less projects are untouched");
for (const [name, opts] of [
  ["no governance marker", { marker: false }],
  ["marker but no episode", { episode: false }],
  ["marker and an EXITED episode", { exited: true }],
]) {
  const dir = project(opts);
  const [t, i] = EDIT(join(dir, "src", "app.py"));
  ok(`${name} -> ALLOW`, !ambient(dir, t, i).denied);
  rmSync(dir, { recursive: true, force: true });
}

// GUARDS THE GUARD. If the ambient path silently stopped resolving a policy, every case above would
// ALLOW and the suite would report four cheerful passes while proving nothing. The `work` episode
// must deny too, and by a DIFFERENT policy than `writing`, so a hardcoded answer cannot satisfy both.
console.log("\nthe scan is not inert");
{
  const dir = project({ workflow: "work" });
  const [t, i] = EDIT(join(dir, "src", "app.py"));
  ok("a `work` episode denies as well (policy really is derived)", ambient(dir, t, i).denied);
  rmSync(dir, { recursive: true, force: true });
}
{
  // `ds` forbids analysis code by extension with a DIFFERENT message; if the derivation were
  // hardcoded to one policy this would carry the wrong reason.
  const dir = project({ workflow: "ds" });
  const r = ambient(dir, ...EDIT(join(dir, "src", "model.py")));
  ok("a `ds` episode denies with the ds-specific Iron Law", r.denied && /no analysis code in main chat/.test(r.stdout ?? ""),
    (r.stdout ?? r.error ?? "").slice(0, 90));
  rmSync(dir, { recursive: true, force: true });
}

// The skill-scoped path is unchanged: explicit `--workflow` must still work in an UNGOVERNED
// project, because invoking the skill is itself the consent signal.
console.log("\nthe skill-scoped registration is unchanged");
{
  const dir = project({ marker: false, episode: false });
  const stdin = JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Edit",
    tool_input: { file_path: join(dir, "src", "app.py"), old_string: "a", new_string: "b" },
    cwd: dir, session_id: "s", tool_use_id: "t", permission_mode: "default",
  });
  const r = spawnSync("bun", [GUARD, "--workflow", "writing"], { input: stdin, encoding: "utf8" });
  ok("explicit --workflow still denies with no marker and no episode",
    /"permissionDecision":\s*"deny"/.test(r.stdout));
  const bad = spawnSync("bun", [GUARD, "--workflow", "nonsense"], { input: stdin, encoding: "utf8" });
  ok("an unknown --workflow still denies rather than falling through to ambient",
    /"permissionDecision":\s*"deny"/.test(bad.stdout));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${PASS}/${PASS + FAIL} passed`);
if (FAIL) process.exit(1);
