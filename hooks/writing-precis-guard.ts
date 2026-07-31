#!/usr/bin/env bun
/**
 * PreToolUse guard for retired writing précis authority.
 *
 * Canonical writing intent and claims live only in the receipt-selected generated plan. This
 * guard blocks attempts to create or mutate PRECIS.md and gives legacy-only
 * episodes an explicit conversion remedy instead of extending the old layout.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { deny, parsePayload } from "./_gate_common.ts";

function projectRoot(filePath: string, cwd: string): string {
  const absolute = isAbsolute(filePath) ? normalize(filePath) : resolve(cwd, filePath);
  const marker = `${join(".planning", "PRECIS.md")}`;
  if (absolute.endsWith(marker)) {
    return absolute.slice(0, -marker.length).replace(/[\\/]$/, "");
  }
  return cwd;
}

let payload: Record<string, unknown>;
try {
  payload = parsePayload(await Bun.stdin.text());
} catch {
  deny("GATE BLOCKED: malformed hook payload cannot authorize writing précis mutation.");
}

const toolName = String(payload.tool_name ?? "");
if (!["Write", "Edit", "MultiEdit"].includes(toolName)) process.exit(0);
const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
const filePath = String(toolInput.file_path ?? "");
if (!filePath || !/(^|[\\/])\.planning[\\/]PRECIS\.md$/.test(normalize(filePath))) {
  process.exit(0);
}

const cwd = String(payload.cwd ?? process.cwd());
const root = projectRoot(filePath, cwd);
const receiptPath = join(root, ".planning", ".state", "review.json");

if (existsSync(receiptPath)) {
  deny(
    "GATE BLOCKED: `.planning/PRECIS.md` is retired for canonical writing episodes. " +
      "Writing intent, stable CLAIM-NN identifiers, counterarguments, and scope belong only in " +
      "the immutable generated plan selected by `.planning/.state/review.json`. Structural changes require a replacement " +
      "native plan and fresh independent whole-plan review; do not create competing authority.",
  );
}

deny(
  "GATE BLOCKED: this is a legacy-only writing layout. Preserve any existing PRECIS.md unchanged " +
    "as conversion input, enter native Plan mode, create the required writing PLAN grammar, and " +
    "obtain fresh approval plus independent whole-plan review. New legacy précis writes are not allowed.",
);
