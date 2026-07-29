#!/usr/bin/env bun
/**
 * PreToolUse hook: block PLAN_REVIEWED.md approval unless PLAN.md carries a
 * machine-EXECUTABLE Implementation Order table.
 *
 * TypeScript port of hooks/dev-plan-executable-guard.py.
 *
 * `dev-compile` turns the Implementation Order table into `.planning/run.js`, which topologically
 * sorts `Deps` into dependency levels, runs each level's tasks sequentially (shared tree, TDD
 * test-first), and gates each task on its `Verify Command` exit code via an independent probe. A
 * plan that records the work as prose phase-headings (or leaves Deps/Files/Verify Command blank) is
 * NOT compilable — neither a DAG nor a per-task gate can be parsed out of it. This guard uses the
 * SAME parser dev-compile uses (scripts/dev/dev_plan_table.py), so a plan that compiles also passes
 * this gate, and vice-versa.
 *
 * This guard fires when something writes `.planning/PLAN_REVIEWED.md` (the approval artifact
 * dev-implement's gate checks). It validates the sibling PLAN.md's table and DENIES the approval
 * write if the table is missing or any row is incomplete.
 *
 * The shared CLI/hook shell (validatePlan + deny + main dispatch) lives in
 * hooks/_plan_guard_common.ts — this file supplies only the dev-specific config.
 *
 * Standalone:  bun dev-plan-executable-guard.ts path/to/PLAN.md
 */

import { type PlanGuardConfig, run } from "./_plan_guard_common.ts";

function denyReason(planPath: string, violations: string[]): string {
  return (
    "GATE BLOCKED: PLAN.md is not machine-executable, so it cannot be " +
    "approved for implementation.\n\n" +
    `\`${planPath}\` problems:\n- ` +
    violations.join("\n- ") +
    "\n\n" +
    "dev-implement reads the Implementation Order table to build the " +
    "dependency DAG and per-task verify gates. Fix the table (see " +
    "dev-design/references/plan-template.md — Task | Deps | Files | " +
    "Failing Test | Verify Command | Implements), then re-run the plan " +
    "reviewer. Do NOT record tasks as prose phase-headings."
  );
}

const CONFIG: PlanGuardConfig = {
  hooksDir: import.meta.dir,
  scriptsSubdir: "dev",
  parserModule: "dev_plan_table",
  tableLabel: "Implementation Order",
  denyReason,
};

await run(CONFIG, Bun.argv.slice(2), () => Bun.stdin.text());
