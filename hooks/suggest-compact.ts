#!/usr/bin/env bun
/**
 * PreToolUse hook: Suggest manual compaction at strategic intervals.
 *
 * Tracks Edit/Write tool calls and suggests /compact at logical checkpoints. Manual compaction at
 * strategic points (after exploration, before execution) preserves more context than auto-compact,
 * which happens at arbitrary points. The counter and thresholds are in guards/suggest-compact.ts,
 * shared with the plugin's mod; this file is the settings-hook entry point, also wired as
 * PostToolUse by skills/workshop, so the context names the payload's own event.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { runPreToolUse } from "./guards/cli.ts";
import { suggestCompact } from "./guards/suggest-compact.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("SUGGEST COMPACT");

await runPreToolUse(suggestCompact);
