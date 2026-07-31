import { join } from "node:path";
import {
  workflowPolicyFromArg,
  type WorkflowPolicy,
} from "./lib/workflow-policy.ts";
import type { WorkflowName } from "../workflows/lib/approved-artifact.ts";

export type { WorkflowPolicy } from "./lib/workflow-policy.ts";

const POLICIES: Readonly<Record<WorkflowName, WorkflowPolicy>> = Object.freeze({
  ds: Object.freeze({ workflow: "ds", clarifySentinel: ".planning/DS_CLARIFIED.json", clarifyReason: "Ask the first clarification questions and wait for the response; profiling happens later in the same /ds skill.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude", "scripts", "hooks", "references", "skills", "CLAUDE.md"]) }),
  dev: Object.freeze({ workflow: "dev", clarifySentinel: ".planning/DEV_CLARIFIED.json", clarifyReason: "Ask the opening product clarification questions and wait for the response before reconnaissance.", reviewerVerdict: ".planning/PLAN_REVIEWED.md", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  work: Object.freeze({ workflow: "work", clarifySentinel: ".planning/WORK_CLARIFIED.json", clarifyReason: "Ask the bounded task's intent, exclusions, success criteria, evidence, and review surfaces before reconnaissance.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  writing: Object.freeze({ workflow: "writing", clarifySentinel: ".planning/WRITING_CLARIFIED.json", clarifyReason: "Ask the opening thesis, audience, scope, source, deliverable, and evidence questions before reading project writing or searching sources.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  workshop: Object.freeze({ workflow: "workshop", clarifySentinel: ".planning/WORKSHOP_CLARIFIED.json", clarifyReason: "Ask the opening paper, audience, duration, structure, visual, output, and evidence questions before reading the paper or presentation project.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
  "workflow-creator": Object.freeze({ workflow: "workflow-creator", clarifySentinel: ".planning/WC_CLARIFIED.json", clarifyReason: "Ask the desired workflow outcome, target repository, scope, exclusions, failure modes, and evidence before inspecting workflow files.", reviewerVerdict: ".planning/.state/review.json", allowedOrchestratorDirectories: Object.freeze([".planning", ".claude"]) }),
});
function builtInWorkflowFromArg(argv: string[]): WorkflowPolicy | null {
  const index = argv.indexOf("--workflow");
  if (index < 0 || index + 1 >= argv.length || argv.filter(value => value === "--workflow").length !== 1) return null;
  const name = argv[index + 1];
  return name === "ds" || name === "dev" || name === "work" || name === "writing" || name === "workshop" || name === "workflow-creator" ? POLICIES[name] : null;
}

export function workflowFromArg(argv: string[]): WorkflowPolicy | null {
  return workflowPolicyFromArg(argv, builtInWorkflowFromArg);
}
export function sentinelPath(projectDir: string, policy: WorkflowPolicy): string { return join(projectDir, policy.clarifySentinel); }
