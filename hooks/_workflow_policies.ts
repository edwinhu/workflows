import { join } from "node:path";
import {
  workflowPolicyFromArg,
  type WorkflowPolicy,
} from "./lib/workflow-policy.ts";
import type { WorkflowName } from "../workflows/lib/approved-artifact.ts";

export type { WorkflowPolicy } from "./lib/workflow-policy.ts";

const POLICIES: Readonly<Record<WorkflowName, WorkflowPolicy>> = Object.freeze({
  ds: Object.freeze({ approvalMode: "built-in-native", workflow: "ds", clarifySentinel: ".planning/DS_CLARIFIED.json", clarifyReason: "Ask the first clarification questions and wait for the response; profiling happens later in the same /ds skill.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude", "scripts", "hooks", "references", "skills", "CLAUDE.md"]) }),
  dev: Object.freeze({ approvalMode: "built-in-native", workflow: "dev", clarifySentinel: ".planning/DEV_CLARIFIED.json", clarifyReason: "Ask the opening product clarification questions and wait for the response before reconnaissance.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  work: Object.freeze({ approvalMode: "built-in-native", workflow: "work", clarifySentinel: ".planning/WORK_CLARIFIED.json", clarifyReason: "Ask the bounded task's intent, exclusions, success criteria, evidence, and review surfaces before reconnaissance.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  writing: Object.freeze({ approvalMode: "built-in-native", workflow: "writing", clarifySentinel: ".planning/WRITING_CLARIFIED.json", clarifyReason: "Ask the opening thesis, audience, scope, source, deliverable, and evidence questions before reading project writing or searching sources.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  workshop: Object.freeze({ approvalMode: "built-in-native", workflow: "workshop", clarifySentinel: ".planning/WORKSHOP_CLARIFIED.json", clarifyReason: "Ask the opening paper, audience, duration, structure, visual, output, and evidence questions before reading the paper or presentation project.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  "workflow-creator": Object.freeze({ approvalMode: "built-in-native", workflow: "workflow-creator", clarifySentinel: ".planning/WC_CLARIFIED.json", clarifyReason: "Ask the desired workflow outcome, target repository, scope, exclusions, failure modes, and evidence before inspecting workflow files.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
});
function builtInWorkflowFromArg(argv: string[]): WorkflowPolicy | null {
  const index = argv.indexOf("--workflow");
  if (index < 0 || index + 1 >= argv.length || argv.filter(value => value === "--workflow").length !== 1) return null;
  const name = argv[index + 1];
  return name === "ds" || name === "dev" || name === "work" || name === "writing" || name === "workshop" || name === "workflow-creator" ? POLICIES[name] : null;
}

/**
 * The orchestrator write surface for a built-in workflow, by name rather than by CLI argument.
 *
 * The plugin-wide identity gate learns its workflow from the receipt, not from `--workflow`, and it
 * must hold the orchestrator to the SAME surface the skill-scoped mutation guard does. Reading it
 * from this one table is what keeps the two gates from drifting apart.
 */
/**
 * `Object.hasOwn`, NOT a bare index. `receipt.workflow` under schema-v2 is an arbitrary
 * `WORKFLOW_IDENTITY` string, and that regex admits `constructor` — a bare index then returned
 * `Object`'s inherited constructor, `policy.allowedOrchestratorDirectories` was `undefined`, and
 * `permitted.some(...)` threw a TypeError out of `implementer-identity-gate`. Claude Code treats a
 * non-zero hook exit as NON-BLOCKING, so a receipt naming `workflow: "constructor"` turned the gate
 * into a silent allow for arbitrary project writes. Measured before the fix.
 */
export function builtInOrchestratorDirectories(workflow: string): readonly string[] {
  const policy = Object.hasOwn(POLICIES, workflow) ? (POLICIES as Record<string, WorkflowPolicy | undefined>)[workflow] : undefined;
  return policy ? policy.allowedOrchestratorDirectories : [".planning", ".claude"];
}

export function workflowFromArg(argv: string[]): WorkflowPolicy | null {
  return workflowPolicyFromArg(argv, builtInWorkflowFromArg);
}
export function sentinelPath(projectDir: string, policy: Exclude<WorkflowPolicy, { approvalMode: "generated-plan-receipt-v1" }>): string { return join(projectDir, policy.clarifySentinel); }
