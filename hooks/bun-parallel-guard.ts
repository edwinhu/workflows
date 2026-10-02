#!/usr/bin/env bun
/**
 * PreToolUse (Bash) BLOCKING GATE: a multi-file `bun test` without `--parallel`. The rule and its
 * measurements are in guards/bun-test.ts, shared with the plugin's mod; this file is the
 * settings-hook entry point, kept so tests/mod-guards-parity.test.ts can hold the two equal.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { runPreToolUse } from "./guards/cli.ts";
import { bunParallelGuard } from "./guards/bun-test.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny rather than an exit-1,
// which Claude Code treats as non-blocking — a silent allow in a PreToolUse gate.
denyOnCrash("BUN PARALLEL GUARD");

await runPreToolUse(bunParallelGuard);
