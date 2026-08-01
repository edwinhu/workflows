#!/usr/bin/env bun
/**
 * PreToolUse gate for receipt-selected workshop generated plans. It protects both the generator
 * dispatch and direct deck mutation; canonical plan validation lives in the shared deterministic
 * parser rather than in mutable phase markers.
 */
import { statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";
import { buildIndex } from "./_workshop_slide_table.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("WORKSHOP PHASE GATE GUARD");

function isWorkshopGenerateDispatch(input: Record<string, unknown>): boolean {
  return `${input.scriptPath ?? ""} ${input.name ?? ""}`.includes("workshop-generate");
}

function projectRoot(filePath: string, cwd: string): string {
  if (!filePath) return resolve(cwd);
  const target = normalize(isAbsolute(filePath) ? filePath : resolve(cwd, filePath));
  let candidate = dirname(target);
  while (true) {
    try {
      if (statSync(join(candidate, ".planning")).isDirectory()) return candidate;
    } catch {
      // Keep walking: the target may not exist yet, but its project root must.
    }
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
}

function failure(idx: ReturnType<typeof buildIndex>): string {
  if (idx.conversionRequired) {
    return "GATE BLOCKED: legacy workshop planning files are conversion input only. Preserve them and create a fresh receipt-selected generated plan.";
  }
  return "GATE BLOCKED: workshop generation requires an executable receipt-selected PLAN.\n- " + idx.violations.join("\n- ");
}

let payload: Record<string, unknown>;
try {
  payload = parsePayload(await Bun.stdin.text());
} catch {
  process.exit(0);
}
const toolName = String(payload.tool_name ?? "");
const input = (payload.tool_input ?? {}) as Record<string, unknown>;
const filePath = String(input.file_path ?? "");
const cwd = String(payload.cwd ?? process.cwd());
const triggers =
  (toolName === "Workflow" && isWorkshopGenerateDispatch(input)) ||
  (["Write", "Edit", "MultiEdit"].includes(toolName) && /(^|[\\/])(?:presentation[\\/])?(?:slides|notes)\.typ$/.test(filePath));
if (!triggers) allow();

const idx = buildIndex(projectRoot(filePath, cwd));
if (idx.violations.length) deny(failure(idx));
if (idx.reviewStatus !== "APPROVED") {
  deny(`GATE BLOCKED: the receipt-selected workshop plan is ${idx.reviewStatus || "unreviewed"}; independent whole-plan review must be APPROVED before generation.`);
}
allow();
