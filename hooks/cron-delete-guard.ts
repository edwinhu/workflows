#!/usr/bin/env bun
/**
 * PreToolUse hook: refuse to cancel a loop while a craft run is still in flight.
 *
 * A /loop cron is usually what DRIVES a craft run to completion -- it is what re-enters the
 * session to read the verdict, fix what failed and redispatch. Deleting it early strands the run:
 * the dispatch keeps going detached and nothing comes back for it. Measured 2026-09-14: deleted at
 * round 2 of 6 with the goal unmet, on the reasoning that the run had been halted.
 *
 * In flight is decided as craft-goal-resend.sh decides it -- a run directory holds args.json with
 * no non-empty result.json beside it. That is a property of the filesystem, not of anyone's belief
 * that the run is over, which is exactly where the judgement failed.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an exit-1,
// which Claude Code treats as NON-BLOCKING -- i.e. a silent allow in a PreToolUse gate.
denyOnCrash("CRON DELETE GUARD");

const hookInput: Record<string, unknown> = parsePayload(await Bun.stdin.text());

if (String(hookInput?.tool_name ?? "") !== "CronDelete") allow();

// The deliberate override, for genuinely abandoning a run.
if (process.env.CRAFT_ALLOW_CRON_DELETE === "1") allow();

const cwd = String(hookInput?.cwd ?? "") || process.cwd();
const craftDir = join(cwd, ".craft");

// No .craft at all is a determinate "no run here", not a failure to decide, so it allows. An
// unreadable directory that EXISTS is a different case and reaches denyOnCrash via the throw.
let entries: string[];
try {
  entries = readdirSync(craftDir);
} catch {
  allow();
}

// The newest in-flight run, by args.json mtime -- the file the dispatch writes.
let newest = "";
let newestMtime = 0;
for (const name of entries) {
  const dir = join(craftDir, name);
  let argsMtime: number;
  try {
    argsMtime = statSync(join(dir, "args.json")).mtimeMs;
  } catch {
    continue; // not a run directory
  }
  try {
    if (statSync(join(dir, "result.json")).size > 0) continue; // has a verdict: not in flight
  } catch {
    // An absent result.json IS the in-flight shape; fall through.
  }
  if (argsMtime > newestMtime) {
    newestMtime = argsMtime;
    newest = name;
  }
}

if (!newest) allow();

// A run-directory name that is not a plain slug is withheld rather than repeated: .craft can be
// repo-shipped, so the name is untrusted text inside a message the reader acts on.
const run = /^[A-Za-z0-9._-]+$/.test(newest) ? newest : "(a run under .craft/)";

deny(
  `A craft run is still in flight: .craft/${run}/args.json has no verdict beside it. ` +
    "The loop you are deleting is usually what drives that run to completion -- it is what " +
    "re-enters the session to read the verdict, fix what failed and redispatch. Deleting it now " +
    "strands the run: the dispatch keeps going detached and nothing comes back for it. Let the " +
    "run finish (craft-result.sh exits 0, or the round cap or time ceiling is reached), then " +
    "delete the loop. If you genuinely mean to abandon the run, set CRAFT_ALLOW_CRON_DELETE=1 " +
    "for the call and say so out loud.",
);
