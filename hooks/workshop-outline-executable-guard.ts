#!/usr/bin/env bun
/**
 * PreToolUse hook: block OUTLINE_APPROVED.md unless OUTLINE.md carries a machine-EXECUTABLE
 * per-slide Slide Spec table. TypeScript port of workshop-outline-executable-guard.py.
 *
 * `workshop-generate` (the transform workflow) reads the Slide Spec table directly: it fans out one
 * fragment-agent per row (each builds its `#slide[...]` block + notes from the pinned
 * Takeaway/Bullets/Inventory/Visual), then an assembly agent stitches the fragments under their
 * Section headers into slides.typ + notes.typ. A title-only outline
 * (`- Slide: title — source → IDs`) forces every agent to invent content and visuals — the failure
 * mode the spec exists to prevent.
 *
 * This guard fires when something writes `.planning/OUTLINE_APPROVED.md` (the Phase-2 approval
 * artifact Phase 3 checks). It validates the sibling OUTLINE.md's Slide Spec table and DENIES the
 * approval if the table is missing or any row is incomplete.
 *
 * S6 reconciliation (DESIGN §3b): the guard and BOTH engines share ONE parser, so
 * "parses ⇔ passes the guard" is a property, not a hope. The parser lives in
 * ./_workshop_slide_table.ts (a behavior-exact port of scripts/workshop/workshop_slide_table.py,
 * which hooks/ cannot import at runtime — see that file's header). It is TOLERANT of the legacy
 * PROSE form and CANONICAL going forward.
 *
 * Standalone:  bun workshop-outline-executable-guard.ts path/to/OUTLINE.md
 */

import { deny, parsePayload, pyJson } from "./_gate_common.ts";
import { buildIndex, pyJoin, pyParent } from "./_workshop_slide_table.ts";

const argv = process.argv.slice(2);

if (argv.length > 0 && argv[0] !== "-") {
  const idx = buildIndex(argv[0]);
  if (idx.violations.length) {
    console.log("OUTLINE NOT EXECUTABLE:\n- " + idx.violations.join("\n- "));
    process.exit(1);
  }
  if (idx.staleApproval.length) {
    console.log("OUTLINE executable (WARN — stale approval):\n- " + idx.staleApproval.join("\n- "));
    process.exit(0);
  }
  console.log(`OUTLINE executable (${idx.form} form, ${idx.slides.length} slides).`);
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
const fp = (toolInput["file_path"] ?? "") as string;
if (!fp || !String(fp).endsWith("OUTLINE_APPROVED.md")) process.exit(0);

const outline = pyJoin(pyParent(String(fp)), "OUTLINE.md");
const idx = buildIndex(outline);
if (idx.violations.length) {
  deny(
    "GATE BLOCKED: OUTLINE.md is not machine-executable, so it cannot be approved " +
      "for slide generation.\n\n" +
      `\`${outline}\` problems:\n- ` +
      idx.violations.join("\n- ") +
      "\n\n" +
      "workshop-generate fans out one fragment-agent per slide. Every slide needs a takeaway and " +
      '≥1 F/T/R/A inventory id (a table row OR a `- Slide: "..." → [IDs]` prose line). Fix, then re-approve.',
  );
}
// Stale approval (the live OUTLINE drifted from a prior APPROVED count) is allow+WARN, not a block:
// the structure may legitimately have changed — surface it so the user re-confirms, don't hard-deny.
if (idx.staleApproval.length) {
  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "STALE APPROVAL (allowing — re-confirm the structure change):\n- " + idx.staleApproval.join("\n- "),
      },
    }),
  );
}
process.exit(0);
