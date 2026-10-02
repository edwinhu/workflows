#!/usr/bin/env bun
/** PostToolUse hook: Guard against monolithic constraint files. The rule is in
 * guards/atomic-constraint.ts, shared with the plugin's mod; this file is the settings-hook entry
 * point. Non-blocking: reports as additional context so the agent can self-correct.
 */
import { allow, parsePayload } from "./_gate_common.ts";
import { emit, guardIO, readStdin } from "./guards/cli.ts";
import { atomicConstraintGuard } from "./guards/atomic-constraint.ts";

let hookInput: Record<string, unknown>;
try {
  hookInput = parsePayload(await readStdin());
} catch {
  allow();
}

emit(await atomicConstraintGuard(hookInput!, guardIO()), "PostToolUse");
