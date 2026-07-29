#!/usr/bin/env bun
/**
 * PreToolUse hook: block PLAN_REVIEWED.md approval unless the ds PLAN.md carries a
 * machine-EXECUTABLE Task Breakdown table.
 *
 * `ds-implement` (the transform workflow) reads the Task Breakdown table directly: it topologically
 * sorts `Deps` (the data-flow DAG — which intermediates a task consumes) into levels, runs each
 * level output-first, and gates each task on its `Verify` assertion exit code. A plan that records
 * tasks as prose `### Task N` headers (or leaves Deps/Outputs/Expected Output/Verify blank) is NOT
 * executable.
 *
 * This guard fires when something writes `.planning/PLAN_REVIEWED.md` (the approval artifact
 * ds-implement's gate checks). It validates the sibling PLAN.md's table and DENIES the approval
 * write if the table is missing or any row is incomplete.
 *
 * The shared CLI/hook shell (validatePlan + deny + main dispatch) lives in
 * hooks/_plan_guard_common.ts — this file supplies only the ds-specific config.
 *
 * Standalone:  bun ds-plan-executable-guard.ts path/to/PLAN.md
 */
import { run, type PlanGuardConfig } from "./_plan_guard_common.ts";

function denyReason(planPath: string, violations: string[]): string {
  return (
    "GATE BLOCKED: ds PLAN.md is not machine-executable, so it cannot be " +
    "approved for implementation.\n\n" +
    `\`${planPath}\` problems:\n- ` + violations.join("\n- ") + "\n\n" +
    "ds-implement reads the Task Breakdown table to build the data-flow DAG " +
    "and per-task Verify gates. Fix the table (see ds-plan — Task | Deps | " +
    "Outputs | Expected Output | Verify | Implements), then re-run the plan " +
    "reviewer. Do NOT record tasks as prose `### Task N` headers."
  );
}

const CONFIG: PlanGuardConfig = {
  hooksDir: import.meta.dir,
  scriptsSubdir: "ds",
  parserModule: "ds_plan_table",
  tableLabel: "Task Breakdown",
  denyReason,
};

await run(CONFIG, process.argv.slice(2), () => Bun.stdin.text());
