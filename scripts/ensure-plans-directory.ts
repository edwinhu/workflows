#!/usr/bin/env bun
/**
 * Ensures the project directs native Plan mode into `<root>/.planning`, which every gate in this
 * plugin assumes.
 *
 * WHY THIS EXISTS AT ALL. `bindApprovedGeneratedPlan` (workflows/lib/approved-artifact.ts:764-765)
 * takes the absolute path Claude Code reports in `ExitPlanMode.toolUseResult.filePath` and requires
 * it to be a direct child of `<root>/.planning`. Without `plansDirectory` the plan is written to
 * `~/.claude/plans/<slug>.md` instead, that check throws, `approved-artifact-persist` defers, and no
 * receipt is ever written — so the episode runs unauthenticated. The setting is not a preference,
 * it is the precondition for the whole receipt chain.
 *
 * WHY IT IS A SKILL PREAMBLE AND NOT A HOOK. `skills/beat-clarify/SKILL.md` is loaded with `Read` by
 * its callers, not invoked with `Skill`, so a `!` line inside the beat is inert text — it never
 * executes. The workflow ENTRY skills are the earliest point in a workflow that actually runs a
 * command, so the check lives in each of them. A SessionStart hook would fire earlier but would also
 * write into every unrelated project the user opens, which is not ours to do.
 *
 * TIMING CAVEAT, AND IT IS REAL. Claude Code memoizes the resolved plans directory for the life of
 * the process (lodash `memoize` around the `plansDirectory` lookup) and clears that cache only on a
 * working-directory change — not when settings.json is edited, even though settings themselves hot
 * reload. So a setting this script CREATES may not reach the session that created it. That is why a
 * change prints a restart notice rather than staying quiet: the failure it prevents is an
 * unauthenticated episode, and it is worth one interruption.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DESIRED = "./.planning";

function projectRoot(): string {
  const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" });
  const top = git.exitCode === 0 ? new TextDecoder().decode(git.stdout).trim() : "";
  return top || process.cwd();
}

const root = projectRoot();
const settingsPath = join(root, ".claude", "settings.json");
const say = (line: string) => console.log(`[plans-directory] ${line}`);
const RESTART = "RESTART THIS SESSION (or reopen the project) BEFORE APPROVING A PLAN — Claude Code resolves the plans directory once per process and does not re-read it when settings.json changes.";

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
    // far worse outcome than the plan landing in the wrong directory.
    say(`WARNING: ${settingsPath} is not a JSON object this script can safely merge into. Add "plansDirectory": "${DESIRED}" by hand before approving a plan.`);
  } else if (typeof settings.plansDirectory === "string" && settings.plansDirectory.trim()) {
    const current = settings.plansDirectory.trim();
    if (current === DESIRED || current === ".planning") say(`already set (${current})`);
    else say(`WARNING: plansDirectory is "${current}", but generated-plan receipts are only bound for plans under <root>/.planning. Change it to "${DESIRED}" or expect approval binding to fail.`);
  } else {
    settings.plansDirectory = DESIRED;
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    say(`added plansDirectory ${DESIRED} to ${settingsPath}`);
    changed = true;
  }
}

// `.planning/` holds the generated plan, the receipt, and episode state. The first is a working
// artifact and the last two are machine-owned; none of them belong in a commit. `.claude/settings.json`
// deliberately stays tracked — tests/native-plan-settings-contract.test.ts pins exactly that split.
const gitignorePath = join(root, ".gitignore");
if (existsSync(join(root, ".git"))) {
  const body = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const ignored = body.split(/\r?\n/).some(line => line.trim() === ".planning/" || line.trim() === "/.planning/" || line.trim() === ".planning");
  if (!ignored) {
    writeFileSync(gitignorePath, `${body}${body && !body.endsWith("\n") ? "\n" : ""}.planning/\n`);
    say(`added .planning/ to ${gitignorePath}`);
  }
}

if (changed) say(RESTART);
