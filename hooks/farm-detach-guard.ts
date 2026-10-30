#!/usr/bin/env bun
/**
 * PreToolUse (Bash) BLOCKING GATE: a backgrounded `farm.sh --tasks` without `--detach`. The rule is in
 * guards/farm-detach.ts, shared with the plugin's mod; this file is the settings-hook entry point,
 * kept so tests/mod-guards-parity.test.ts can hold the two equal.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { runPreToolUse } from "./guards/cli.ts";
import { farmDetachGuard } from "./guards/farm-detach.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny rather than an exit-1,
// which Claude Code treats as non-blocking — a silent allow in a PreToolUse gate.
denyOnCrash("FARM DETACH GUARD");

await runPreToolUse(farmDetachGuard);
