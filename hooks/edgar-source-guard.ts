#!/usr/bin/env bun
/** PostToolUse hook: point scripts that fetch filings from sec.gov at the WRDS route. The rule is in
 * guards/edgar-source.ts, shared with the plugin's mod; this file is the settings-hook entry point.
 * Non-blocking: reports as additional context.
 */
import { allow, parsePayload } from "./_gate_common.ts";
import { emit, guardIO, readStdin } from "./guards/cli.ts";
import { edgarSourceGuard } from "./guards/edgar-source.ts";

let hookInput: Record<string, unknown>;
try {
  hookInput = parsePayload(await readStdin());
} catch {
  allow();
}

emit(await edgarSourceGuard(hookInput!, guardIO()), "PostToolUse");
