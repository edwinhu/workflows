#!/usr/bin/env bun
/** PreToolUse guard: block data exploration during brainstorm phase.
 *
 * The Iron Law: NO DATA EXPLORATION BEFORE ASKING QUESTIONS.
 * Block Bash commands that look like data analysis during brainstorm.
 *
 * PreToolUse has NO top-level `decision` field — gates go through
 * hookSpecificOutput.permissionDecision. Emitting {"decision": ...} gets the whole payload rejected
 * by the harness ("Hook JSON output validation failed"), silently disabling this guard. Use the
 * shared helpers.
 */
import { allow, deny, readPayload } from "./_gate_common.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const toolInput = await readPayload();
const toolName = String(toolInput.tool_name ?? "");
const toolParams = (toolInput.tool_input as Record<string, unknown>) ?? {};

if (toolName !== "Bash") {
  allow();
}

const command = String(toolParams.command ?? "");

// Block data exploration commands. NOTE: plain substring matching, and the `.read_*` entries carry
// a LEADING DOT — `read_csv(` without a dot does NOT match.
const explorationPatterns = [
  "python3 -c",
  "python -c",
  "import pandas",
  "import numpy",
  "import polars",
  "pd.read_",
  "pd.DataFrame",
  "df.head",
  "df.describe",
  "df.info",
  "df.shape",
  "df.columns",
  "df.dtypes",
  ".read_csv",
  ".read_parquet",
  ".read_sql",
  ".read_excel",
  "pixi run python",
];

if (explorationPatterns.some((pattern) => command.includes(pattern))) {
  // Check if SPEC.md exists — if it does, brainstorm is done
  const specPath = join(process.cwd(), ".planning", "SPEC.md");
  if (existsSync(specPath)) {
    // Brainstorm complete, allow exploration
    allow();
  }

  deny(
    "\u{1f6d1} Iron Law: No data exploration before asking questions. Complete the brainstorm interview and write SPEC.md first. Data exploration happens in ds-plan (Phase 2).",
  );
}

// Allow non-analysis bash commands
allow();
