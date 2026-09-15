/**
 * Approving a plan with "clear context" re-seeds a bare `Implement the following plan:` session, and
 * the plan is all that survives. The IN-PROGRESS line for a result-less craft run therefore reads the
 * plan's frontmatter `workflow:` and names the skill to invoke — otherwise the re-seeded session
 * falls back to generic craft and loses that domain's result handling and human review.
 *
 * Run: bun test tests/session-start-in-progress.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInProgressSection } from "../hooks/session-start.ts";

const TMP = mkdtempSync(join(tmpdir(), "in-progress-test-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A project holding one craft run whose args.json points at a plan with `body` as its text. */
function project(name: string, body: string | null, opts: { result?: boolean } = {}): string {
  const dir = join(TMP, name);
  mkdirSync(join(dir, ".claude", "plans"), { recursive: true });
  mkdirSync(join(dir, ".craft", "0912-run"), { recursive: true });
  let planPath = join(dir, ".claude", "plans", "plan.md");
  if (body === null) {
    planPath = join(dir, ".claude", "plans", "missing.md");
  } else {
    writeFileSync(planPath, body);
  }
  writeFileSync(join(dir, ".craft", "0912-run", "args.json"), JSON.stringify({ planPath }));
  if (opts.result) writeFileSync(join(dir, ".craft", "0912-run", "result.json"), "{}");
  return dir;
}

describe("buildInProgressSection", () => {
  test("a plan declaring `workflow: dev` names the workflow and the skill to invoke", () => {
    const dir = project("dev", "---\nworkflow: dev\n---\n\n# Plan\n");
    const out = buildInProgressSection(dir);
    expect(out).toContain("0912-run");
    expect(out).toContain("(workflow `dev`)");
    expect(out).toContain('Skill(skill="workflows:dev")');
  });

  test("a plugin-qualified workflow is invoked as written", () => {
    const dir = project("teaching", "---\nworkflow: teaching:notes\n---\n\n# Plan\n");
    const out = buildInProgressSection(dir);
    expect(out).toContain("(workflow `teaching:notes`)");
    expect(out).toContain('Skill(skill="teaching:notes")');
    expect(out).not.toContain("workflows:teaching");
  });

  test("a plan with no frontmatter yields the plain line and names no skill", () => {
    const dir = project("plain", "# Plan\n\nNo frontmatter here.\n");
    const out = buildInProgressSection(dir);
    expect(out).toContain("- craft run `0912-run` was dispatched and has no result.json yet.");
    expect(out).not.toContain("Skill(");
  });

  test("a missing plan file is not a throw — the line is unchanged", () => {
    const dir = project("gone", null);
    const out = buildInProgressSection(dir);
    expect(out).toContain("- craft run `0912-run` was dispatched and has no result.json yet.");
    expect(out).not.toContain("Skill(");
  });

  test("silent once the run has a result", () => {
    const dir = project("done", "---\nworkflow: dev\n---\n\n# Plan\n", { result: true });
    expect(buildInProgressSection(dir)).toBe("");
  });
});
