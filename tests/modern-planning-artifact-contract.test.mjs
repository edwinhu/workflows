import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// These are modern-plan producers/consumers. Legacy dev and descriptor-v1 external-policy support
// are deliberately outside this scan: they are isolated compatibility inputs, not modern authority.
const MODERN_PRODUCERS = [
  "skills/ds/SKILL.md",
  "skills/ds-fix/SKILL.md",
  "skills/ds-plan-reviewer/SKILL.md",
  "skills/ds-implement/SKILL.md",
  "skills/ds-delegate/SKILL.md",
  "skills/ds-review/SKILL.md",
  "skills/ds-handoff/SKILL.md",
  "skills/beat-implement/SKILL.md",
  "skills/workflow-creator/SKILL.md",
  "skills/workflow-creator-improve/SKILL.md",
  "skills/workflow-creator-plan-reviewer/SKILL.md",
  "hooks/session-start.ts",
  "hooks/pre-compact.ts",
  "hooks/subagent-start.ts",
];

const RETIRED_VISIBLE_AUTHORITIES = [
  ".planning/PLAN.md",
  ".planning/PLAN.meta.json",
  ".planning/PLAN_REVIEWED.md",
  ".planning/REVIEW.md",
];

// These references can be dispatched to fresh reviewers or rediscovered by a
// canonical writing-review episode. They may name retired artifacts only to
// prohibit their use, so test their positive authority contract semantically
// rather than applying a bare retired-token ban.
const ACTIVE_WRITING_REVIEW_REFERENCES = [
  "skills/writing-review/references/reviewer-agent-prompt.md",
  "skills/writing-review/references/agent-team-workflow.md",
  "skills/writing-review/references/review-template.md",
  "skills/writing-review/references/sequential-checklist.md",
  "references/plan-review/writing/precis-outline-traceability.md",
  "references/plan-review/writing/section-execution.md",
  "references/plan-review/writing/sources-and-claims.md",
  "references/plan-review/writing/verification-and-review.md",
];

describe("modern planning artifact doctrine", () => {
  test("modern producers use receipt-selected generated plans, not visible legacy authorities", () => {
    for (const path of MODERN_PRODUCERS) {
      const content = readFileSync(join(ROOT, path), "utf8");
      for (const retired of RETIRED_VISIBLE_AUTHORITIES) {
        expect(content, `${path} still produces or consumes ${retired}`).not.toContain(retired);
      }
    }
  });

  test("active writing review references bind positive authority to the receipt-selected plan and index", () => {
    for (const path of ACTIVE_WRITING_REVIEW_REFERENCES) {
      const content = readFileSync(join(ROOT, path), "utf8");
      expect(content, `${path} must bind the canonical generated-plan identity`)
        .toContain("{planFile, planHash}");
      expect(content, `${path} must require a deterministic section index`)
        .toMatch(/deterministic\s+section\s+index/i);
      expect(content, `${path} must name normal PLAN-bound outlines`)
        .toMatch(/outline/i);
      expect(content, `${path} must name normal PLAN-bound drafts`)
        .toMatch(/draft/i);
      expect(content, `${path} must name their normal deliverable role`)
        .toMatch(/deliverable/i);
      expect(content, `${path} must retire visible writing artifacts as authority, not merely omit their names`)
        .toMatch(/(?:retired|not)[\s\S]{0,120}authorit|(?:précis|precis|master outline|workflow state|review ledger|planning or review artifact)[\s\S]{0,120}(?:retired|not|cannot)/i);
    }
  });

  test("canonical review prompt mentions of retired writing files are prohibitions, never authority", () => {
    const prompts = [
      "skills/writing-review/references/reviewer-agent-prompt.md",
      "skills/writing-review/references/agent-team-workflow.md",
      "skills/writing-review/references/review-template.md",
      "skills/writing-review/references/sequential-checklist.md",
    ];
    const retiredNames = ["PRECIS.md", "OUTLINE.md", "ACTIVE_WORKFLOW.md", "REVIEW.md", "AUTOMATED_REVIEW.md"];
    for (const path of prompts) {
      const content = readFileSync(join(ROOT, path), "utf8");
      for (const retired of retiredNames) {
        let index = content.indexOf(retired);
        while (index !== -1) {
          const context = content.slice(Math.max(0, index - 160), index + retired.length + 160);
          expect(context, `${path} may mention ${retired} only to prohibit its authority`)
            .toMatch(/retired|not|do not|never|cannot|stop|prohibit/i);
          index = content.indexOf(retired, index + retired.length);
        }
      }
    }
  });

  test("DS review and delegation have no fixed plan or visible review-ledger authority", () => {
    for (const path of ["skills/ds-review/SKILL.md", "skills/ds-delegate/SKILL.md"]) {
      const content = readFileSync(join(ROOT, path), "utf8");
      expect(content, `${path} must name the authenticated native identity`)
        .toContain("receipt-selected");
      expect(content, `${path} must bind the generated-plan identity`)
        .toContain("planFile, planHash");
      expect(content, `${path} still assigns authority to a fixed legacy ledger`)
        .not.toMatch(/\b(?:PLAN(?:\.md)?|REVIEW(?:\.md)?|HUMAN_REVIEW)\b/);
    }
  });

  test("routing and public doctrine never advertise fixed modern planning ledgers", () => {
    for (const path of ["README.md", "skills/using-skills/SKILL.md"]) {
      const content = readFileSync(join(ROOT, path), "utf8");
      expect(content, `${path} must route through the generated-plan identity`)
        .toContain("{planFile, planHash}");
      expect(content, `${path} still advertises fixed modern plan or review ledgers`)
        .not.toMatch(/\.planning\/(?:PLAN|WORK|AUTOMATED_REVIEW|HUMAN_REVIEW)\.md/);
    }
  });

  test("pause and review helpers return continuity instead of writing ledgers", () => {
    const handoff = readFileSync(join(ROOT, "skills/ds-handoff/SKILL.md"), "utf8");
    expect(handoff).toContain("Return this summary directly to the caller; do not persist it");
    expect(handoff).toContain("receipt-selected generated plan");
    expect(handoff).not.toMatch(/###\s+(?:Write|Create).*HANDOFF|Handoff saved:|HANDOFF\.md exists/);

    const clarify = readFileSync(join(ROOT, "skills/beat-clarify/SKILL.md"), "utf8");
    expect(clarify).toContain("receipt-selected immutable `{planFile, planHash}`");
    expect(clarify).toContain("do not create `WORK.md`, `PRECIS.md`, `OUTLINE.md`");

    const review = readFileSync(join(ROOT, "skills/beat-review/SKILL.md"), "utf8");
    expect(review).toContain("TaskList is the live queue");
    expect(review).toContain("returned result");
    expect(review).not.toMatch(/ledger path|write .*REVIEW\.md|persist .*HUMAN_REVIEW\.md/i);
  });

  test("writing ancillary helpers use canonical state or explicit legacy conversion only", () => {
    for (const path of [
      "skills/writing-handoff/SKILL.md",
      "skills/writing-validate/SKILL.md",
      "skills/writing-legal/SKILL.md",
      "skills/writing-econ/SKILL.md",
    ]) {
      const content = readFileSync(join(ROOT, path), "utf8");
      expect(content, path).toMatch(/receipt-selected|\{planFile, planHash\}/);
      expect(content, `${path} still consumes retired fixed writing state`)
        .not.toMatch(/Read `?\.planning\/(?:PRECIS|OUTLINE|ACTIVE_WORKFLOW|HANDOFF)\.md|Write `?\.planning\/(?:PRECIS|OUTLINE|ACTIVE_WORKFLOW|HANDOFF)\.md/);
    }
    for (const path of [
      "skills/writing-precis-reviewer/SKILL.md",
      "skills/writing-outline-reviewer/SKILL.md",
    ]) {
      const content = readFileSync(join(ROOT, path), "utf8");
      expect(content, path).toContain("Legacy-only conversion helper");
      expect(content, path).toContain("legacy-only");
    }

    const citeHook = readFileSync(join(ROOT, "hooks/cite-fidelity-lint.ts"), "utf8");
    expect(citeHook).toContain("authenticatedWritingPlan");
    expect(citeHook).toContain("receipt-selected canonical plan");
    expect(citeHook).not.toContain('.planning", "PLAN.md"');
    expect(citeHook).not.toContain('.state", "plan.json"');
  });

  test("plan-checker documentation names only the hidden combined receipt", () => {
    const content = readFileSync(join(ROOT, "docs/model-profiles.md"), "utf8");
    expect(content).toContain(".planning/.state/review.json");
    expect(content).not.toContain(".planning/PLAN_REVIEWED.md");
  });

  test("the policy guard owns hidden receipt state and retires visible authority paths", () => {
    const guard = readFileSync(join(ROOT, "hooks/orchestrator-mutation-guard.ts"), "utf8");
    expect(guard).toContain("RETIRED_MODERN_ARTIFACTS");
    expect(guard).toContain('relative.startsWith(".planning/.state/")');
    expect(guard).toContain("const builtInModern = policy.approvalPolicy === undefined");
    expect(guard).not.toContain('policy.workflow !== "dev"');
  });

  test("canonical documentation names the receipt, TaskList, and auto-memory continuity", () => {
    for (const path of ["README.md", "PHILOSOPHY.md", "docs/extension-contracts.md", "docs/workflow-lifecycle-architecture.md"]) {
      const content = readFileSync(join(ROOT, path), "utf8");
      expect(content, path).toMatch(/receipt-selected|\{planFile, planHash\}|generated plan/i);
    }
    const architecture = readFileSync(join(ROOT, "docs/workflow-lifecycle-architecture.md"), "utf8");
    expect(architecture).toContain("TaskList");
    expect(architecture).toContain("auto-memory");
  });
});
