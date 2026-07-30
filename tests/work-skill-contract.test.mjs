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

  test("uses WORK.md as canonical state", () => {
    for (const text of [work, plan, goalWork, verify, review]) {
      expect(text).toContain("WORK.md");
    }
    expect(work).toContain("legacy standalone-mini state");
    expect(work).toContain("Preserve the old file");
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
    expect(work).toContain("If it is already 1");
    expect(work).toContain("replace intent\n  and criteria");
  });

  test("uses the canonical helper for top-level goal activation and clearing", () => {
    for (const text of [goalWork, beatImplement, devImplement, visualVerify]) {
      expect(text).toContain(goalSelfSend);
      expect(text).toContain('"/goal <condition>"');
      expect(text).toContain('"/goal clear"');
      expect(text).toContain("top-level session");
      expect(text).toContain("explicitly confirms");
      expect(text).not.toMatch(/\bagent-msg\b/i);
      expect(text).not.toMatch(/\bRC session\b|remote control/i);
      expect(text).toMatch(/top-level session[\s\S]*goal-self-send\.ts/);
      expect(text).toMatch(/status[" :]+"?delivered"?[\s\S]*explicitly confirm/i);
    }
    expect(goalWork).toMatch(/otherwise,?\s+print the literal command and stop/i);
  });

  test("keeps work outside the native approved-plan execution boundary", () => {
    expect(work).toContain("does **not** execute\n`workflows/beat-implement.js`");
    expect(goalWork).toContain("authenticates\nDS approved-plan metadata");
    const runner = read("workflows/beat-implement.js");
    expect(runner).toContain("['ds', 'writing', 'workshop', 'workflow-creator'].includes(cfg.workflow)");
    expect(runner).toContain("validateApprovedArtifact(PROJECT, cfg.workflow");
    expect(runner).not.toContain("'work'");
    const persist = read("hooks/approved-artifact-persist.ts");
    expect(persist).toContain("workflowFromArg");
    expect(persist).not.toContain('workflow === "work"');
  });

  test("maintains resumable work lifecycle state", () => {
    expect(work).toContain(".planning/ACTIVE_WORKFLOW.md");
    expect(read("hooks/session-start.ts")).toContain('wfType === "work"');
    expect(read("hooks/pre-compact.ts")).toContain("activeWorkflowMarker()");
  });

  test("routes the middle category without swallowing specialized work", () => {
    expect(routing).toContain("Lightweight structured work");
    expect(routing).toContain("use work only for the bounded middle category");
    for (const command of ["/dev", "/ds", "/writing", "/workshop"]) {
      expect(routing).toContain(command);
    }
  });
});
