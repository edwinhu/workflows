#!/usr/bin/env bun
/**
 * PreToolUse hook: Block Read tool on image files, redirect to look-at skill.
 *
 * Reading images directly wastes context tokens. The look-at skill delegates to a subscription CLI
 * that returns only the relevant information, saving 80-95% of tokens. The rule is in
 * guards/image-read.ts, shared with the plugin's mod; this file is the settings-hook entry point.
 */
import { denyOnCrash } from "./_gate_common.ts";
import { runPreToolUse } from "./guards/cli.ts";
import { imageReadGuard } from "./guards/image-read.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("IMAGE READ GUARD");

// A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ: parsePayload denies on a non-object and
// lets a parse error propagate to the crash handler, which denies too.
await runPreToolUse(imageReadGuard);
