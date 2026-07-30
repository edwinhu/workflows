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
  expect(validatePlanReviewDispatch({ domain: "ds", referenceRoot: "references", planPath: ".planning/PLAN.md", inputPaths: [".planning/PLAN.meta.json"] })).toContain("Reference root must be an absolute path.");
  expect(validatePlanReviewDispatch({ domain: "ds", referenceRoot: "   ", planPath: ".planning/PLAN.md", inputPaths: [".planning/PLAN.meta.json"] })).toContain("Reference root is required.");
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

test("skills dispatch generic checker with explicit domain and reference root", () => {
  for (const [skill, domain, input] of [["dev-plan-reviewer", "dev", "SPEC.md"], ["ds-plan-reviewer", "ds", "PLAN.meta.json"]] as const) {
    const text = read(`skills/${skill}/SKILL.md`);
    expect(text).toContain("subagent_type=\"workflows:plan-checker\"");
    expect(text).toContain(`Workflow/domain: ${domain}`);
    expect(text).toContain("Reference root:");
    expect(text).toContain(input);
  }
});

test("atomic constraints keep common doctrine and domain policy separate", () => {
  const common = read("references/plan-review/common/verdict-contract.md");
  const dev = join(ROOT, "references", "plan-review", "dev");
  const ds = join(ROOT, "references", "plan-review", "ds");
  expect(common).toContain("plan_hash");
  expect(readFileSync(join(dev, "executable-plan-table.md"), "utf8")).toContain("Task | Deps | Files | Failing Test | Verify Command | Implements");
  expect(readFileSync(join(dev, "tdd-and-verify-commands.md"), "utf8")).toContain("RED");
  expect(readFileSync(join(ds, "native-plan-integrity.md"), "utf8")).toContain("PLAN.meta.json");
  expect(readFileSync(join(ds, "profiling-and-dq.md"), "utf8")).toContain("duplicates");
  expect(readFileSync(join(ds, "parameters-and-masters.md"), "utf8")).toContain("canonical");
  expect(readFileSync(join(dev, "spec-traceability.md"), "utf8")).not.toContain("PLAN.meta.json");
  expect(readFileSync(join(ds, "native-plan-integrity.md"), "utf8")).not.toContain("Failing Test");
});

test("reviewer adapters retain verdict-only ownership without duplicated checklists", () => {
  for (const skill of ["dev-plan-reviewer", "ds-plan-reviewer"]) {
    expect(read(`skills/${skill}/SKILL.md`)).toContain(".planning/PLAN_REVIEWED.md");
  }
  expect(read("skills/ds-plan-reviewer/SKILL.md")).not.toContain("nulls, duplicates, type drift");
  expect(read("skills/dev-plan-reviewer/SKILL.md")).not.toContain("## What to Check");
});
