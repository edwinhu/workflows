#!/usr/bin/env bun
/**
 * PreToolUse/CLI guard for the receipt-selected generated workshop PLAN. The shared parser
 * authenticates exact plan bytes and compiles Source Paper, Source Inventory, and the executable
 * seven-column Slide Spec without a filename, directory-listing, or LLM fallback.
 *
 * Standalone: bun workshop-outline-executable-guard.ts <project-root>
 */

import { deny, denyOnCrash, parsePayload } from "./_gate_common.ts";
import { buildIndex, pyParent } from "./_workshop_slide_table.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("WORKSHOP OUTLINE EXECUTABLE GUARD");

const argv = process.argv.slice(2);

function failureMessage(idx: ReturnType<typeof buildIndex>): string {
  if (idx.conversionRequired) {
    return "GATE BLOCKED: legacy workshop planning files are conversion input only. Preserve them, create a fresh receipt-selected generated plan, and obtain independent whole-plan review.";
  }
  return "GATE BLOCKED: the receipt-selected workshop PLAN is not executable.\n\nProblems from the canonical workshop parser:\n- " + idx.violations.join("\n- ") + "\n\nReplace and re-review the native plan; do not create retired planning fragments or use a fallback parser.";
}

if (argv.length > 0 && argv[0] !== "-") {
  const idx = buildIndex(argv[0]);
  if (idx.violations.length) {
    console.log(failureMessage(idx));
    process.exit(1);
  }
  console.log(`Workshop PLAN executable: ${idx.slides.length} slides, hash ${idx.planHash}.`);
  process.exit(0);
}

let hookInput: Record<string, unknown>;
try {
  hookInput = parsePayload(await Bun.stdin.text());
} catch {
  process.exit(0);
}

const toolName = (hookInput?.["tool_name"] ?? "") as unknown;
if (toolName !== "Write" && toolName !== "Edit") process.exit(0);

const toolInput = (hookInput["tool_input"] ?? {}) as Record<string, unknown>;
const filePath = String(toolInput["file_path"] ?? "");
if (!filePath) process.exit(0);

if (/(^|[\\/])\.planning[\\/](?:SOURCES|OUTLINE|OUTLINE_APPROVED|SOURCES_VERIFIED|SLIDES_REVIEWED|VALIDATION)\.md$/.test(filePath)) {
  deny("GATE BLOCKED: workshop planning fragments are retired. The receipt-selected generated PLAN is the only authority for Source Paper, Source Inventory, Slide Spec, generation, verification, and review surfaces.");
}
if (!/(^|[\\/])(?:presentation[\\/])?(?:slides|notes)\.typ$/.test(filePath)) process.exit(0);
const root = pyParent(pyParent(filePath));
const idx = buildIndex(root);
if (idx.violations.length) deny(failureMessage(idx));
if (idx.reviewStatus !== "APPROVED") {
  deny(`GATE BLOCKED: the receipt-selected workshop plan is ${idx.reviewStatus || "unreviewed"}; slide or notes mutation requires APPROVED independent whole-plan review.`);
}
process.exit(0);
