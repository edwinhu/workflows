import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIndex, sectionSlug } from "../hooks/_workshop_slide_table.ts";

const hash = text => createHash("sha256").update(text).digest("hex");
const TABLE = `| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|---|---|---|---|---|---|---|
| 1. Title | Part 1: Motivation \`==\` The Rise | Proxy advisors fill a monitoring gap. | ERISA; ISS | A1, R1 | none | Open ~2 min |
| 2. Mechanism | Part 1: Motivation \`==\` The Rise | One recommendation moves many votes. | concentration | F1, R2 | F1 chart | Walk figure |
`;
function plan(table = TABLE, inventory = "- F1 — figure\n- A1 — argument\n- R1 — result\n- R2 — result") {
  return `# Workshop plan\n\n## Presentation Intent\n- Explain the paper's contribution.\n\n## Audience, Venue, Duration, and Proportions\n- Faculty workshop; 45 minutes.\n\n## Source Paper\n- Path: /papers/paper.pdf\n\n## Source Inventory\n${inventory}\n\n## Slide Spec\n${table}\n\n## Outputs and Verification\n- Generate and independently verify both Typst deliverables.\n\n## Review Surfaces\n- Rendered slides.pdf and notes.pdf.\n`;
}
function project(text, status = "APPROVED") {
  const root = mkdtempSync(join(tmpdir(), "workshop-table-"));
  const state = join(root, ".planning", ".state"); mkdirSync(state, { recursive: true });
  writeFileSync(join(root, ".planning", "workshop-generated.md"), text);
  writeFileSync(join(state, "review.json"), JSON.stringify({ workflow: "workshop", plan_file: "workshop-generated.md", plan_hash: hash(text), approved_session_id: "approval-session", approved_at: "2026-07-30T10:00:00.000Z", status, reviewer_session_id: status === "APPROVED" ? "review-session" : "", reviewed_at: status === "APPROVED" ? "2026-07-30T11:00:00.000Z" : "" }));
  return root;
}
describe("workshop generated-plan slide parser", () => {
  test("authenticates and parses exact native PLAN sections", () => {
    const idx = buildIndex(project(plan()));
    expect(idx.form).toBe("table"); expect(idx.slides).toHaveLength(2); expect(idx.violations).toEqual([]);
    expect(idx.planFile).toBe("workshop-generated.md"); expect(idx.reviewStatus).toBe("APPROVED");
    expect(idx.slides[0].inventory).toEqual(["A1", "R1"]);
  });
  test("rejects missing required native PLAN sections", () => {
    const idx = buildIndex(project("# incomplete\n\n## Source Paper\n- Path: /paper.pdf\n"));
    expect(idx.violations.some(v => v.includes("Source Inventory"))).toBe(true);
    expect(idx.violations.some(v => v.includes("Slide Spec"))).toBe(true);
  });
  test("requires every exact H2 heading once", () => {
    const idx = buildIndex(project(plan().replace("## Review Surfaces", "## Presentation Intent\n- duplicate\n\n## Review Surfaces")));
    expect(idx.violations.some(v => v.includes("## Presentation Intent") && v.includes("found 2"))).toBe(true);
  });
  test("rejects extra or reordered H2 headings", () => {
    const extra = buildIndex(project(plan().replace("## Review Surfaces", "## Extra\n- no\n\n## Review Surfaces")));
    expect(extra.violations.some(v => v.includes("heading sequence"))).toBe(true);
    const reordered = buildIndex(project(plan().replace("## Presentation Intent\n- Explain the paper's contribution.\n\n## Audience, Venue, Duration, and Proportions\n- Faculty workshop; 45 minutes.", "## Audience, Venue, Duration, and Proportions\n- Faculty workshop; 45 minutes.\n\n## Presentation Intent\n- Explain the paper's contribution.")));
    expect(reordered.violations.some(v => v.includes("heading sequence"))).toBe(true);
  });
  test("rejects extra, qualified, missing, or reordered Slide Spec headers", () => {
    for (const table of [
      TABLE.replace("| Notes |", "| Notes | Extra |"),
      TABLE.replace("| Inventory |", "| Inventory (required) |"),
      TABLE.replace("| Visual |", "|"),
      TABLE.replace("| Slide | Section |", "| Section | Slide |"),
    ]) {
      const idx = buildIndex(project(plan(table)));
      expect(idx.violations.some(v => v.includes("header must contain exactly"))).toBe(true);
    }
  });
  test("rejects Slide Spec data rows with fewer or more than seven cells", () => {
    for (const table of [
      TABLE.replace("| 1. Title | Part 1: Motivation `==` The Rise | Proxy advisors fill a monitoring gap. | ERISA; ISS | A1, R1 | none | Open ~2 min |", "| 1. Title | Part 1: Motivation `==` The Rise | Proxy advisors fill a monitoring gap. | ERISA; ISS | A1, R1 | none |"),
      TABLE.replace("| 1. Title | Part 1: Motivation `==` The Rise | Proxy advisors fill a monitoring gap. | ERISA; ISS | A1, R1 | none | Open ~2 min |", "| 1. Title | Part 1: Motivation `==` The Rise | Proxy advisors fill a monitoring gap. | ERISA; ISS | A1, R1 | none | Open ~2 min | unexpected |"),
    ]) {
      const idx = buildIndex(project(plan(table)));
      expect(idx.violations).toContain("Every PLAN Slide Spec data row must contain exactly seven cells.");
    }
  });
  test("rejects receipt-selected plan bytes changed after review", () => {
    const root = project(plan()); writeFileSync(join(root, ".planning", "workshop-generated.md"), "# replaced bytes\n");
    const idx = buildIndex(root); expect(idx.ok).toBe(false); expect(idx.violations.some(v => v.includes("receipt"))).toBe(true);
  });
  test("detects dangling Source Inventory IDs", () => {
    const idx = buildIndex(project(plan(TABLE.replace("F1, R2", "F1, R9"))));
    expect(idx.violations.some(v => v.includes("R9") && v.includes("Source Inventory"))).toBe(true);
  });
  test("reports legacy layout as conversion-only", () => {
    const root = mkdtempSync(join(tmpdir(), "workshop-legacy-")); mkdirSync(join(root, ".planning")); writeFileSync(join(root, ".planning", "PLAN.md"), "# legacy\n");
    const idx = buildIndex(root); expect(idx.conversionRequired).toBe(true);
  });
  test("uses Unicode-safe slugs", () => expect(sectionSlug("Part II — The Two Offer-Period Channels")).toBe("Part-II-The-Two-Offer-Period-Channels"));

  // Both cases below used to parse CLEANLY and lose slides downstream with no finding naming them.
  // The parser is the only place that can see either one: by the time workshop-generate.js enumerates
  // groupOrder, the evidence that a slide was dropped or a section was spliced is already gone.
  test("rejects an empty Section cell instead of dropping the slide", () => {
    const idx = buildIndex(project(plan(TABLE.replace("| 1. Title | Part 1: Motivation \`==\` The Rise |", "| 1. Title |  |"))));
    expect(idx.ok).toBe(false);
    expect(idx.violations.some(v => v.includes("Slide 1") && v.includes("Section"))).toBe(true);
  });
  test("rejects a section that resumes after another section intervened", () => {
    const split = `| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|---|---|---|---|---|---|---|
| 1. A | Part 1: Motivation | Point one. | ERISA | A1 | none | Open |
| 2. B | Part 2: Evidence | Point two. | data | R1 | none | Walk |
| 3. C | Part 1: Motivation | Point three. | ISS | R2 | none | Close |
`;
    const idx = buildIndex(project(plan(split)));
    expect(idx.ok).toBe(false);
    expect(idx.violations.some(v => v.includes("Slide 3") && v.includes("contiguous"))).toBe(true);
    // A contiguous run of the same section is the normal case and must stay legal.
    const fine = buildIndex(project(plan(split.replace("| 3. C | Part 1: Motivation |", "| 3. C | Part 2: Evidence |"))));
    expect(fine.violations).toEqual([]);
  });
});
