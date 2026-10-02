#!/usr/bin/env bun
/**
 * PreToolUse on CronDelete: refuse to cancel the loop that drives a work run still in flight.
 * `--record` runs as PostToolUse on CronCreate and files the new job id under the run(s) its prompt
 * names. Both halves are in guards/cron-delete.ts, shared with the plugin's mod; this file is the
 * settings-hook entry point.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { guardIO, readStdin, runPreToolUse } from "./guards/cli.ts";
import { cronDeleteGuard, cronRecord } from "./guards/cron-delete.ts";

// RECORD MODE (PostToolUse) never blocks and never prints a decision: a PostToolUse hook that emits
// a PreToolUse shape gets the payload rejected, and a crash here must not be visible at all.
if (process.argv.includes("--record")) {
  try {
    const payload = JSON.parse(await readStdin());
    await cronRecord(payload, guardIO());
  } catch {
    // best-effort
  }
  process.exit(0);
}

// FIRST STATEMENT WITH AN EFFECT in guard mode: a throw below becomes a schema-valid deny instead
// of an exit-1, which Claude Code treats as NON-BLOCKING -- i.e. a silent allow in a PreToolUse gate.
denyOnCrash("CRON DELETE GUARD");

await runPreToolUse(cronDeleteGuard);
