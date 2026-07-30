import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIndex, sectionSlug } from "../hooks/_workshop_slide_table.ts";

function project(outline, sources = "", approval = "") {
  const root = mkdtempSync(join(tmpdir(), "workshop-table-"));
  const planning = join(root, ".planning");
  mkdirSync(planning);
  writeFileSync(join(planning, "OUTLINE.md"), outline);
  if (sources) writeFileSync(join(planning, "SOURCES.md"), sources);
  if (approval) writeFileSync(join(planning, "OUTLINE_APPROVED.md"), approval);
  return root;
}

const TABLE = `| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|---|---|---|---|---|---|---|
| 1. Title | Part 1: Motivation \`==\` The Rise | Proxy advisors fill a monitoring gap. | ERISA; ISS | A1, R1 | none | Open ~2 min |
| 2. Mechanism | Part 1: Motivation \`==\` The Rise | One recommendation moves many votes. | concentration | F1, R2 | F1 chart | Walk figure |
`;
const PROSE = `### Part 1
= Motivation
== Speaker
- Slide: "This is a paper I didn't plan to write." — SEC experience → [A1, A2]
== Debate
- Slide: "The question is not 'follow?' but 'judge?'" — roadmap → [A3]
= Appendix
- Slide: "Key findings." — R1-R8 → [R1-R8]
`;

describe("workshop TypeScript slide parser", () => {
  test("parses canonical table", () => {
    const idx = buildIndex(project(TABLE));
    expect(idx.form).toBe("table");
    expect(idx.slides).toHaveLength(2);
    expect(idx.violations).toEqual([]);
    expect(idx.slides[0].section).toBe("Part 1: Motivation");
    expect(idx.slides[0].subsection).toBe("The Rise");
    expect(idx.slides[0].inventory).toEqual(["A1", "R1"]);
  });

  test("rejects the retired prose form", () => {
    const idx = buildIndex(project(PROSE));
    expect(idx.form).toBe("none");
    expect(idx.slides).toHaveLength(0);
    expect(idx.violations.some(v => v.includes("canonical Slide Spec table"))).toBe(true);
  });

  test("detects dangling inventory and stale approval", () => {
    const idx = buildIndex(project(TABLE.replace("F1, R2", "F1, R9"), "- A1\n- R1\n- F1\n", "---\nstatus: APPROVED\nslide_count: 9\nsection_count: 4\n---\n"));
    expect(idx.violations.some(v => v.includes("R9") && v.includes("not found"))).toBe(true);
    expect(idx.staleApproval.some(v => v.includes("slide_count=9") && v.includes("has 2"))).toBe(true);
  });

  test("uses Unicode-safe slugs", () => {
    expect(sectionSlug("Part II — The Two Offer-Period Channels")).toBe("Part-II-The-Two-Offer-Period-Channels");
  });
});
