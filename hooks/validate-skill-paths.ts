#!/usr/bin/env bun
/**
 * PostToolUse hook: Validate path references in skill files after edits. The checker is in
 * guards/skill-paths.ts, shared with the plugin's mod and with the tree-wide scan in
 * tests/agent-contract.test.mjs; this file is the settings-hook entry point.
 */
import { emit, guardIO, readStdin } from "./guards/cli.ts";
import { validateSkillPaths } from "./guards/skill-paths.ts";

async function main(): Promise<void> {
  let hookInput: Record<string, unknown>;
  try {
    hookInput = JSON.parse(await readStdin());
  } catch {
    process.exit(0);
  }
  // A non-object payload throws on the first field read (exit 1), as the Python original did.
  void (hookInput as Record<string, unknown>).tool_name;
  emit(await validateSkillPaths(hookInput, guardIO()), "PostToolUse");
}

if (import.meta.main) await main();
