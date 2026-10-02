#!/usr/bin/env bun
/**
 * PostToolUse hook: Check Typst conventions after Edit/Write on .typ files. The checks are in
 * guards/typst-convention.ts, shared with the plugin's mod; this file is the settings-hook entry
 * point. Non-blocking: reports violations so the agent can fix them immediately.
 *
 * Only `json.load(sys.stdin)` was guarded in the Python original: a payload that parses but is not
 * a dict dies with an AttributeError (exit 1, empty stdout). Preserved.
 */
import { emit, guardIO, readStdin } from "./guards/cli.ts";
import { typstConventionGuard } from "./guards/typst-convention.ts";

let payload: unknown;
try {
  payload = JSON.parse(await readStdin());
} catch {
  process.exit(0);
}
if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
  throw new TypeError("hook_input has no attribute 'get'");
}
const hookInput = payload as Record<string, unknown>;
emit(await typstConventionGuard(hookInput, guardIO()), "PostToolUse");
