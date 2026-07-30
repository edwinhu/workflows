import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const routing = readFileSync(join(ROOT, "skills/using-skills/SKILL.md"), "utf8");
const work = readFileSync(join(ROOT, "skills/work/SKILL.md"), "utf8");

const cases = [
  { prompt: "Do this properly: clean up these configs and verify the result", route: "/work" },
  { prompt: "Plan and verify this small structured task", route: "/work" },
  { prompt: "Change this typo", route: "direct" },
  { prompt: "Build a feature with a spec and TDD", route: "/dev" },
  { prompt: "Analyze this dataset and design the study", route: "/ds" },
  { prompt: "Draft a long-form paper", route: "/writing" },
  { prompt: "Build my faculty workshop deck", route: "/workshop" },
  { prompt: "Iteratively improve this artifact against a score", route: "/audit-fix-loop" },
  { prompt: "Review this existing code change", route: "review-only" },
  { prompt: "Verify the citations in this existing draft", route: "specialized-review" },
];

describe("work routing contract", () => {
  test("documents representative positive and negative routes", () => {
    for (const { route } of cases) {
      if (route === "direct") {
        expect(routing).toContain("Direct execution for trivial work");
      } else if (route === "review-only" || route === "specialized-review") {
        expect(work.match(/^description:\s*"([^"]+)"/m)?.[1] ?? "").not.toContain("review this");
      } else {
        expect(`${routing}\n${work}`).toContain(route);
      }
    }
  });

  test("work description is trigger-only and bounded", () => {
    const description = work.match(/^description:\s*"([^"]+)"/m)?.[1] ?? "";
    expect(description).toContain("bounded task");
    expect(description).not.toContain("ANY domain");
    expect(description).not.toContain("implement");
    expect(description).not.toContain("analyze");
  });

  test("active and legacy state behavior is fail-safe", () => {
    expect(work).toContain("resume that workflow");
    expect(work).toContain("offer to resume it");
    expect(work).toContain("ask before\n   converting it");
    expect(work).toContain("Never merge automatically");
  });

  test("mechanical escalation thresholds remain explicit", () => {
    expect(work).toMatch(/five substantial files or eight implementation\s+steps/);
    expect(work).toMatch(/Same treatment over independent pinned items/i);
    expect(work).toMatch(/More than roughly ten plan steps/);
  });
});
