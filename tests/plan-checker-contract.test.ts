import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverPlanReviewConstraints, validatePlanReviewDispatch } from "../scripts/plan-review-constraints.ts";

const ROOT = resolve(import.meta.dir, "..");
const references = join(ROOT, "references");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

test("plan-checker is the only shipped plan-checker agent", () => {
  expect(existsSync(join(ROOT, "agents", "plan-checker.md"))).toBe(true);
  expect(existsSync(join(ROOT, "agents", "dev-plan-checker.md"))).toBe(false);
  expect(read("agents/plan-checker.md")).toContain("name: plan-checker");
  expect(read("agents/plan-checker.md")).not.toContain("dev-plan-checker");
});

test("dispatch contract requires safe domain, concrete root, plan, and inputs", () => {
  expect(validatePlanReviewDispatch({ domain: "dev", referenceRoot: references, planPath: ".planning/PLAN.md", inputPaths: [".planning/SPEC.md"] })).toEqual([]);
  expect(validatePlanReviewDispatch({ domain: "Dev!", referenceRoot: references, planPath: ".planning/PLAN.md", inputPaths: [".planning/SPEC.md"] })).toContain("Workflow/domain must match [a-z0-9][a-z0-9-]*.");
  expect(validatePlanReviewDispatch({ domain: "ds", referenceRoot: "references", planPath: ".planning/generated-plan.md", inputPaths: [".planning/SPEC.md"] })).toContain("Reference root must be an absolute path.");
  expect(validatePlanReviewDispatch({ domain: "ds", referenceRoot: "   ", planPath: ".planning/generated-plan.md", inputPaths: [".planning/SPEC.md"] })).toContain("Reference root is required.");
  expect(validatePlanReviewDispatch({ domain: "ds", referenceRoot: "", planPath: "", inputPaths: [] })).toEqual(expect.arrayContaining([
    "Reference root is required.",
    "Plan path is required.",
    "At least one input path is required.",
  ]));
});

test("constraint discovery sorts both required constraint directories and fails closed", () => {
  const constraints = discoverPlanReviewConstraints(references, "dev");
  expect(constraints.common).toEqual([...constraints.common].sort());
  expect(constraints.domain).toEqual([...constraints.domain].sort());
  expect(constraints.common).toHaveLength(8);
  expect(constraints.domain).toHaveLength(4);
  expect(() => discoverPlanReviewConstraints(references, "missing")).toThrow(/No plan-review constraints/);
});

test("writing constraint discovery loads every canonical writing review prompt", () => {
  const constraints = discoverPlanReviewConstraints(references, "writing");
  expect(constraints.domain.map((path) => path.split("/").at(-1))).toEqual([
    "precis-outline-traceability.md",
    "section-execution.md",
    "sources-and-claims.md",
    "verification-and-review.md",
  ]);
});

test("modern adapters dispatch the generic checker with the exact generated plan path", () => {
  for (const [skill, domain] of [["ds-plan-reviewer", "ds"], ["writing-plan-reviewer", "writing"], ["workshop-plan-reviewer", "workshop"], ["workflow-creator-plan-reviewer", "workflow-creator"]] as const) {
    const text = read(`skills/${skill}/SKILL.md`);
    expect(text).toContain("subagent_type=\"workflows:plan-checker\"");
    expect(text).toContain(`Workflow/domain: ${domain}`);
    expect(text).toContain("Reference root:");
    expect(text).toContain("Plan: <exact generated plan path returned by the completed native Plan interaction>");
    expect(text).toContain("Replace both angle-bracket placeholders with concrete paths before dispatch.");
    expect(text).toMatch(/never\s+(?:list[\s\S]*choose|discover)[\s\S]*plan/i);
    expect(text).not.toContain("Plan: .planning/PLAN.md");
    expect(text).not.toContain("PLAN.meta.json");
  }
});

test("legacy dev adapter retains its fixed plan contract", () => {
  const text = read("skills/dev-plan-reviewer/SKILL.md");
  expect(text).toContain("subagent_type=\"workflows:plan-checker\"");
  expect(text).toContain("Workflow/domain: dev");
  expect(text).toContain("Plan: .planning/PLAN.md");
  expect(text).toContain("Inputs: .planning/SPEC.md");
});

test("atomic constraints keep common doctrine and domain policy separate", () => {
  const common = read("references/plan-review/common/verdict-contract.md");
  const dev = join(ROOT, "references", "plan-review", "dev");
  const ds = join(ROOT, "references", "plan-review", "ds");
  expect(common).toContain("plan_file");
  expect(common).toContain("plan_hash");
  expect(common).toMatch(/Never glob[\s\S]*newest[\s\S]*substitute/i);
  expect(common).toContain("Legacy dev");
  expect(readFileSync(join(dev, "executable-plan-table.md"), "utf8")).toContain("Task | Deps | Files | Failing Test | Verify Command | Implements");
  expect(readFileSync(join(dev, "tdd-and-verify-commands.md"), "utf8")).toContain("RED");
  const dsIntegrity = readFileSync(join(ds, "native-plan-integrity.md"), "utf8");
  expect(dsIntegrity).toContain(".planning/.state/review.json");
  expect(dsIntegrity).toContain("`PENDING` state");
  expect(dsIntegrity).toContain("exact generated Markdown plan");
  expect(dsIntegrity).toContain("plan_file");
  expect(dsIntegrity).toContain("plan_hash");
  expect(dsIntegrity).toContain("canonical normalization");
  expect(dsIntegrity).toContain("matching the basename alone is insufficient");
  expect(dsIntegrity).toMatch(/before review and immediately before finalization/i);
  expect(dsIntegrity).toMatch(/Never list or glob[\s\S]*newest[\s\S]*modification time[\s\S]*copy or rename[\s\S]*substitute/i);
  expect(dsIntegrity).toContain("independent");
  expect(dsIntegrity).toContain("strictly later than `approved_at`");
  expect(dsIntegrity).toContain("Legacy `dev` alone");
  expect(dsIntegrity).not.toContain("PLAN.meta.json");
  expect(dsIntegrity).not.toContain("`PLAN.md` is the immutable");
  expect(readFileSync(join(ds, "profiling-and-dq.md"), "utf8")).toContain("duplicates");
  expect(readFileSync(join(ds, "parameters-and-masters.md"), "utf8")).toContain("canonical");
  expect(readFileSync(join(dev, "spec-traceability.md"), "utf8")).not.toContain("PLAN.meta.json");
  expect(readFileSync(join(ds, "native-plan-integrity.md"), "utf8")).not.toContain("Failing Test");
});

test("generic checker owns only hidden combined receipt finalization", () => {
  const checker = read("agents/plan-checker.md");
  expect(checker).toContain(".planning/.state/review.json");
  expect(checker).toContain("PENDING receipt");
  expect(checker).toContain("plan_file");
  expect(checker).toContain("approved_session_id");
  expect(checker).toContain("Hash the supplied plan before review");
  expect(checker.toLowerCase()).toContain("immediately before finalization");
  expect(checker).toMatch(/Do not use `Edit`, glob for plans, list `.planning\/`, choose a newest file/);
  expect(checker).toContain("For legacy `dev` only");
  expect(checker).not.toContain("write only `.planning/PLAN_REVIEWED.md`");
});
