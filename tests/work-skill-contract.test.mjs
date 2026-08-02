import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const work = read("skills/work/SKILL.md");
const plan = read("skills/work/beats/plan.md");
const goalWork = read("skills/work/beats/goal-work.md");
const verify = read("skills/work/beats/verify.md");
const review = read("skills/work/beats/review-surface.md");
const routing = read("skills/using-skills/SKILL.md");
const beatImplement = read("skills/beat-implement/SKILL.md");
const devImplement = read("skills/dev-implement/SKILL.md");
const visualVerify = read("skills/visual-verify/SKILL.md");
const goalSelfSend = 'bun ${CLAUDE_SKILL_DIR}/../../scripts/goal-self-send.ts';

function frontmatterName(text) {
  return text.match(/^---\n[\s\S]*?^name:\s*([^\n]+)$/m)?.[1]?.trim();
}

function hasRetiredProducer(text) {
  const normalized = text.replace(/\s+/g, " ");
  const pattern = /(?:create|write|produce|persist|emit|generate|save|maintain|update|append(?: content)? to|copy.{0,40}?into).{0,100}?(?:\.planning\/)?(?:WORK|REVIEW|ACTIVE_WORKFLOW)\.md/gi;
  for (const match of normalized.matchAll(pattern)) {
    const prefix = normalized.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
    if (!/(?:do not|never|must not|forbid)\s*$/i.test(prefix)) return true;
  }
  return false;
}

const doctrine = [work, plan, goalWork, verify, review];

describe("work workflow contract", () => {
  test("canonical skill is discoverable without a mini alias", () => {
    expect(existsSync(join(ROOT, "skills/work/SKILL.md"))).toBe(true);
    expect(frontmatterName(work)).toBe("work");
    expect(existsSync(join(ROOT, "skills/mini/SKILL.md"))).toBe(false);
    expect(read(".claude-plugin/plugin.json")).toContain('"skills": "./skills/"');
  });

  test("composes all shared lifecycle beats", () => {
    expect(work).toContain("../beat-clarify/SKILL.md");
    expect(work).toContain("../beat-implement/SKILL.md");
    expect(work).toContain("../beat-review/SKILL.md");
  });

  test("uses receipt-selected generated plan identity as sole work authority", () => {
    expect(work).toContain(".planning/.state/review.json");
    expect(work).toContain("plan_file");
    expect(work).toContain("plan_hash");
    for (const text of doctrine) expect(text).toMatch(/receipt-selected generated plan|generated plan/i);
    expect(goalWork).toContain("planFile");
    expect(goalWork).toContain("planHash");
    // The dispatch boundary moved from a checked-in runner taking `planReset` to a generator taking
    // the plan identity directly. The PROPERTY is unchanged and still asserted: the wave is bound to
    // the receipt-selected plan, so a different plan cannot be implemented under this approval.
    expect(goalWork).toContain("planFile");
    expect(goalWork).toContain("emit-implementation-workflow.ts");
    expect(goalWork).toContain("planFile: \"<receipt plan_file>\"");
    expect(goalWork).toContain("planHash: \"<receipt plan_hash>\"");
    expect(goalWork).not.toContain("approvedBodyHash");
  });

  test("keeps legacy state as explicit conversion-only provenance", () => {
    expect(work).toContain("Legacy-only:");
    expect(work).toMatch(/preserve[\s\S]*fresh approval[\s\S]*independent review/i);
    expect(work).toMatch(/Legacy files never\s+authorize implementation/);
    expect(work).toContain("Canonical with legacy provenance");
    expect(work).toContain("Conflicting authority");
    expect(work).toContain("never merge automatically");
  });

  test("requires the exact work PLAN schema", () => {
    for (const heading of ["## Intent", "## Exclusions", "## Success Criteria", "## Implementation Plan", "## Evidence Plan", "## Review Surfaces"]) {
      expect(plan).toContain(heading);
    }
    expect(plan).toContain("exactly once");
    expect(plan).toContain("stable task ID");
    expect(plan).toContain("whole-plan");
  });

  test("keeps live execution, verification, and review state in TaskList", () => {
    for (const text of [work, goalWork, verify, review]) expect(text).toContain("TaskList");
    expect(goalWork).toContain("plan_task_id");
    expect(goalWork).toContain("planHash");
    expect(goalWork).toContain("Completed same-hash tasks");
    expect(goalWork).toContain("never recreated");
    expect(goalWork).toContain('status="deleted"');
    expect(goalWork).toContain('status="completed"');
    expect(goalWork).toContain('disposition: "superseded"');
    expect(goalWork).toContain("superseded_by_plan_hash");
    expect(goalWork).toContain("create exactly one current-hash replacement");
    expect(goalWork).toContain("Never carry a stale TaskList ID");
    expect(verify).toContain("verification round");
    expect(review).toContain("review finding");
  });

  test("forbids new retired visible work ledgers", () => {
    for (const text of doctrine) expect(hasRetiredProducer(text)).toBe(false);
    expect(work).toMatch(/Do not create or treat any visible review, work, active-workflow/i);
    for (const producer of [
      "Create `.planning/WORK.md` for the task.",
      "Produce `.planning/REVIEW.md` after verification.",
      "Persist `.planning/ACTIVE_WORKFLOW.md` while work is active.",
      "Create the review ledger at\n`.planning/REVIEW.md`.",
      "Copy the approved plan into `.planning/WORK.md`.",
      "Append content to `.planning/REVIEW.md`.",
    ]) expect(hasRetiredProducer(producer)).toBe(true);
  });

  test("keeps implementation and verification independent", () => {
    expect(work).toContain("The verifier is never the doer");
    expect(goalWork).toMatch(/An implementation agent never\s+verifies its own work/);
    expect(verify).toContain("one fresh verifier with no implementation context");
    expect(verify).toContain("resume the same verifier");
  });

  test("requires a confirmed budgeted goal and rejection re-entry", () => {
    expect(work).toContain("exactly one `/goal` is confirmed active");
    expect(goalWork).toContain("turn budget");
    expect(goalWork).toContain("Clear the goal immediately after");
    expect(goalWork).toContain("REVIEW waits for user input outside the");
    expect(work).toContain("If the rejection count is already 1");
    expect(work).toContain("replace intent and criteria");
  });

  test("uses the canonical helper for top-level goal activation and clearing", () => {
    for (const text of [goalWork, beatImplement, devImplement, visualVerify]) {
      expect(text).toContain(goalSelfSend);
      expect(text).toContain('\"/goal <condition>\"');
      expect(text).toContain('\"/goal clear\"');
      expect(text).toContain("top-level session");
      expect(text).toContain("explicitly confirms");
      expect(text).not.toMatch(/\bagent-msg\b/i);
      expect(text).not.toMatch(/\bRC session\b|remote control/i);
    }
    expect(goalWork).toMatch(/otherwise,?\s+print the literal command and stop/i);
  });

  test("uses the native approved-plan runner boundary", () => {
    // Was `workflows/beat-implement.js`, a script that could never execute under the Workflow
    // runtime. The boundary is now the shared beat, which routes by plan shape and generates a
    // plan-bound script. What is asserted is the same: work names a concrete dispatch boundary and
    // does not hand-roll one.
    expect(work).toContain("beat-implement/SKILL.md");
    expect(goalWork).toContain("Workflow({");
    expect(goalWork).toContain('workflow: "work"');
    const runner = read("workflows/beat-implement.js");
    expect(runner).toContain("'work'");
    expect(runner).toContain("validateApprovedArtifact(PROJECT, cfg.workflow");
    expect(runner).toContain("planReset.planFile");
    expect(runner).toContain("planReset.planHash");
  });

  test("routes the middle category without swallowing specialized work", () => {
    expect(routing).toContain("Lightweight structured work");
    expect(routing).toContain("use work only for the bounded middle category");
    for (const command of ["/dev", "/ds", "/writing", "/workshop"]) expect(routing).toContain(command);
  });

  test("dev execution keeps plan identity and live state in TaskList", () => {
    const devEntry = read("skills/dev/SKILL.md");
    expect(devEntry).toContain("TaskCreate");
    expect(devEntry).toContain("TaskList");
    expect(devEntry).toContain('matcher: "ExitPlanMode"');
    expect(devEntry).toContain("approved-artifact-persist.ts --workflow dev");
    expect(devEntry).not.toContain("TodoWrite");
    const devSkills = [
      "skills/dev-implement/SKILL.md",
      "skills/dev-test-gaps/SKILL.md",
      "skills/dev-review/SKILL.md",
      "skills/dev-verify/SKILL.md",
      "skills/dev-handoff/SKILL.md",
      "skills/dev-delegate/SKILL.md",
      "skills/dev-debug/SKILL.md",
      "skills/dev-tdd/SKILL.md",
      "skills/dev-worktree/SKILL.md",
    ].map(read);
    for (const text of devSkills) {
      expect(text).toContain("TaskList");
      expect(text).toMatch(/planFile.*planHash|planHash.*planFile/s);
    }
    // Domain identity still travels with the dispatch; it is now the generator's `domain` field
    // rather than the runner's `workflow` arg.
    expect(devImplement).toContain('"domain":"dev"');
    expect(devImplement).toContain("beat-implement/SKILL.md");
    expect(devImplement).toContain("valid RED");
    expect(devImplement).toContain("independent fresh verifier");
    expect(read("skills/dev-review/SKILL.md")).toContain("Codex");
    expect(read("skills/dev-verify/SKILL.md")).toContain("beat-review/SKILL.md");
  });
});
