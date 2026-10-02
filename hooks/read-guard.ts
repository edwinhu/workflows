#!/usr/bin/env bun
/**
 * PreToolUse hook: Block reading large files without limits. The rule is in guards/read-guard.ts,
 * shared with the plugin's mod; this file is the settings-hook entry point.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { runPreToolUse } from "./guards/cli.ts";
import { readGuard } from "./guards/read-guard.ts";

denyOnCrash("READ GUARD");

await runPreToolUse(readGuard);
