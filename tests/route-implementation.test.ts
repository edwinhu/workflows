// The routing table from https://code.claude.com/docs/en/workflows#when-to-use-a-workflow, executed.
//
// The decision beat-implement has to make is not "workflow or not" but WHO HOLDS THE PLAN. The docs
// frame subagents and workflows by where intermediate results live — Claude's context window versus
// script variables — and that is exactly the context-poisoning axis beat-implement exists to manage.
// So these cases pin the two ends: a single task must NOT become a workflow (there are no
// intermediates to hold), and a wide or long plan must (its intermediates are the problem).
import { describe, expect, test } from "bun:test";
import { routeImplementation } from "../scripts/beat/route-implementation.ts";

const t = (id: string, dependsOn: string[] = []) => ({ id, dependsOn });
const chain = (n: number) => Array.from({ length: n }, (_, i) => t(`t${i}`, i ? [`t${i - 1}`] : []));
const wide = (n: number) => Array.from({ length: n }, (_, i) => t(`t${i}`));

describe("implementation routing", () => {
  test("no tasks stays inline — nothing to dispatch", () => {
    expect(routeImplementation([]).route).toBe("inline");
  });

  test("one task goes to ONE subagent, never a workflow", () => {
    const decision = routeImplementation([t("only")]);
    expect(decision.route).toBe("single-subagent");
    expect(decision.agentCount).toBe(1);
    // The point of the case: a script would add a runtime and an approval prompt to buy nothing,
    // because the subagent's result already IS the final answer.
    expect(decision.reason).toContain("no intermediate results");
  });

  test("a short sequential plan stays with subagents", () => {
    const decision = routeImplementation(chain(3));
    expect(decision.route).toBe("subagents");
    expect(decision.maxParallelWidth).toBe(1);
  });

  test("fan-out moves the plan into a script", () => {
    const decision = routeImplementation(wide(3));
    expect(decision.route).toBe("workflow");
    expect(decision.maxParallelWidth).toBe(3);
  });

  test("a long chain moves too — length, not width, is the context problem", () => {
    const decision = routeImplementation(chain(8));
    expect(decision.route).toBe("workflow");
    expect(decision.maxParallelWidth).toBe(1);
    expect(decision.sizeGuideline).toBe("medium");
  });

  test("size guidelines are the documented ones", () => {
    // small <5, medium <15, large <50 — from the Dynamic workflow size setting table.
    expect(routeImplementation(wide(4)).sizeGuideline).toBe("small");
    expect(routeImplementation(wide(14)).sizeGuideline).toBe("medium");
    expect(routeImplementation(wide(49)).sizeGuideline).toBe("large");
    expect(routeImplementation(wide(50)).sizeGuideline).toBe("unrestricted");
  });

  test("the large-run warning fires above 25 agents, and only warns", () => {
    expect(routeImplementation(wide(25)).warnLarge).toBe(false);
    const big = routeImplementation(wide(26));
    expect(big.warnLarge).toBe(true);
    expect(big.route).toBe("workflow");   // advisory: Claude Code warns, it does not cap
  });

  test("dependency structure decides width, not task count", () => {
    // diamond: a -> {b,c} -> d. Four tasks, but only two ever run at once.
    const decision = routeImplementation([t("a"), t("b", ["a"]), t("c", ["a"]), t("d", ["b", "c"])]);
    expect(decision.maxParallelWidth).toBe(2);
  });

  test("a dependency cycle terminates instead of hanging", () => {
    // The compiler rejects cycles upstream; a router that loops forever would be worse than one
    // that over-estimates the width, so the remainder is reported as a single wave.
    const decision = routeImplementation([t("a", ["b"]), t("b", ["a"])]);
    expect(decision.maxParallelWidth).toBe(2);
  });
});
