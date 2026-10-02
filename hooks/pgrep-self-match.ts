#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Monitor) BLOCKING GATE: `pgrep -f`/`pkill -f` that match their own command line,
 * and `rg`/`rga` with no path in a segment nothing pipes into. The rules and their incident history
 * are in guards/pgrep.ts, shared with the plugin's mod; this file is the settings-hook entry point.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { runPreToolUse } from "./guards/cli.ts";
import { pgrepSelfMatch } from "./guards/pgrep.ts";

export { analyze, type Analysis } from "./guards/pgrep.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny rather than an exit-1,
// which Claude Code treats as non-blocking — a silent allow in a PreToolUse gate.
denyOnCrash("PGREP GUARD");

// The rules live in guards/pgrep.ts, shared with the plugin's mod. A PreToolUse GATE DENIES ON A
// PAYLOAD IT CANNOT READ: parsePayload denies on a non-object and lets a parse error reach the
// crash handler.
await runPreToolUse(pgrepSelfMatch);
