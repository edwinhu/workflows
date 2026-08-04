#!/usr/bin/env bun
/**
 * Ensures the project directs native Plan mode into `<root>/.planning`, and — when it had to change
 * anything — marks the session as needing a restart before it may approve a plan.
 *
 * Usage: ensure-plans-directory.ts [sessionId]
 *
 * WHY THIS EXISTS AT ALL. `bindApprovedGeneratedPlan` (workflows/lib/approved-artifact.ts:764-765)
 * takes the absolute path Claude Code reports in `ExitPlanMode.toolUseResult.filePath` and requires
 * it to be a direct child of `<root>/.planning`. Without `plansDirectory` the plan is written to
 * `~/.claude/plans/<slug>.md` instead, that check throws, `approved-artifact-persist` defers, and no
 * receipt is ever written — so the episode runs unauthenticated. The setting is not a preference, it
 * is the precondition for the whole receipt chain.
 *
 * THIS SCRIPT CANNOT FIX THE SESSION IT RUNS IN, AND MUST NOT PRETEND OTHERWISE.
 *   Claude Code memoizes the resolved plans directory for the life of the process (lodash `memoize`
 *   around the `plansDirectory` lookup) and clears that cache only on a working-directory change —
 *   not when settings.json is edited, even though settings themselves hot reload. So a setting this
 *   script CREATES reaches the next session, never the current one. `~/projects/new_project.sh` is
 *   the only place that can genuinely fix it, because project creation precedes every session; this
 *   script exists for the projects that already exist, where detection is all that is available.
 *
 * WHICH IS WHY IT WRITES A MARKER INSTEAD OF PRINTING ADVICE.
 *   The first version of this script printed a RESTART line and trusted the reader. Measured
 *   2026-08-04: the reader wrote *"Noted; I'll handle that at the end"* and planned anyway, into
 *   `~/.claude/plans/goofy-brewing-gadget.md`. An advisory line is a suggestion, and a suggestion
 *   competes with the task in front of it. The marker turns it into a refusal —
 *   `hooks/plans-directory-restart-gate.ts` denies `EnterPlanMode`/`ExitPlanMode` for exactly the
 *   session id recorded here. A restarted session has a new id and no marker, so the gate clears
 *   itself with no cleanup step to forget.
 *
 * WHY THIS IS A SKILL PREAMBLE AND NOT A HOOK. `skills/beat-clarify/SKILL.md` is loaded with `Read`
 * by its callers, not invoked with `Skill`, so a `!` line inside the beat is inert text — the same
 * never-reached-registration class as the v5.106.3 defect. The workflow ENTRY skills are the
 * earliest point in a workflow that actually runs a command. A SessionStart hook would fire earlier
 * but would also write into every unrelated project the user opens, which is not ours to do.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLANS_RESTART_DIR, restartMarkerPath } from "../hooks/lib/plans-restart-marker.ts";

const DESIRED = "./.planning";

function projectRoot(): string {
  const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" });
  const top = git.exitCode === 0 ? new TextDecoder().decode(git.stdout).trim() : "";
  return top || process.cwd();
}

const sessionId = (Bun.argv[2] ?? "").trim();
const root = projectRoot();
const settingsPath = join(root, ".claude", "settings.json");
const say = (line: string) => console.log(`[plans-directory] ${line}`);

let changed = false;

if (!existsSync(settingsPath)) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify({ plansDirectory: DESIRED }, null, 2)}\n`);
  say(`created ${settingsPath} with plansDirectory ${DESIRED}`);
  changed = true;
} else {
  let settings: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>;
  } catch {
    settings = null;
  }
  if (settings === null) {
    // Never rewrite a file we could not read. Comments, trailing commas, or a hand-broken settings
    // file are all reasons to stop: clobbering a user's permissions block to fix a plans path is a
    // far worse outcome than the plan landing in the wrong directory. The marker is still written —
    // the setting is absent either way, and that is what the gate is about.
    say(`WARNING: ${settingsPath} is not a JSON object this script can safely merge into. Add "plansDirectory": "${DESIRED}" by hand.`);
    changed = true;
  } else if (typeof settings.plansDirectory === "string" && settings.plansDirectory.trim()) {
    const current = settings.plansDirectory.trim();
    if (current === DESIRED || current === ".planning") say(`already set (${current})`);
    else {
      say(`WARNING: plansDirectory is "${current}", but generated-plan receipts are only bound for plans under <root>/.planning.`);
      changed = true;
    }
  } else {
    settings.plansDirectory = DESIRED;
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    say(`added plansDirectory ${DESIRED} to ${settingsPath}`);
    changed = true;
  }
}

// `.planning/` holds the generated plan, the receipt, and episode state. The first is a working
// artifact and the last two are machine-owned; none of them belong in a commit.
// `.claude/settings.json` deliberately stays tracked — tests/native-plan-settings-contract.test.ts
// pins exactly that split. This is NOT a restart condition: gitignore takes effect immediately.
const gitignorePath = join(root, ".gitignore");
if (existsSync(join(root, ".git"))) {
  const body = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const ignored = body.split(/\r?\n/).some(line => [".planning/", "/.planning/", ".planning", "/.planning"].includes(line.trim()));
  if (!ignored) {
    writeFileSync(gitignorePath, `${body}${body && !body.endsWith("\n") ? "\n" : ""}.planning/\n`);
    say(`added .planning/ to ${gitignorePath}`);
  }
}

if (!changed) process.exit(0);

if (!sessionId) {
  // Run by hand, or by a caller that did not pass ${CLAUDE_SESSION_ID}. There is no session to
  // block, so say the thing the gate would have said. Never write an unkeyed marker: it would deny
  // every session forever, including the restarted one that fixed the problem.
  say("RESTART REQUIRED before approving a plan — Claude Code resolves the plans directory once per process and does not re-read it when settings.json changes.");
  process.exit(0);
}

mkdirSync(PLANS_RESTART_DIR, { recursive: true });
// Prune markers older than a week. Sessions are ephemeral and their ids never repeat, so an old
// marker can never deny anything — this only keeps the directory from growing without bound.
try {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const entry of readdirSync(PLANS_RESTART_DIR)) {
    const path = join(PLANS_RESTART_DIR, entry);
    try { if (statSync(path).mtimeMs < weekAgo) rmSync(path, { force: true }); } catch { /* another session may have pruned it */ }
  }
} catch { /* pruning is housekeeping; never let it stop the marker being written */ }

writeFileSync(restartMarkerPath(sessionId), `${JSON.stringify({ sessionId, root, settingsPath, at: new Date().toISOString() }, null, 2)}\n`);
say("RESTART REQUIRED before approving a plan — Claude Code resolves the plans directory once per process and does not re-read it when settings.json changes. Plan mode is blocked for this session until it restarts.");
