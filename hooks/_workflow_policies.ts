import { join } from "node:path";
import type { WorkflowName } from "../workflows/lib/approved-artifact.ts";

export type WorkflowPolicy = Readonly<{
  workflow: WorkflowName;
  clarifySentinel: string;
  clarifyReason: string;
  reviewerVerdict: string;
  allowedOrchestratorDirectories: readonly string[];
}>;
const POLICIES: Readonly<Record<WorkflowName, WorkflowPolicy>> = Object.freeze({
  ds: Object.freeze({ workflow: "ds", clarifySentinel: ".planning/DS_CLARIFIED.json", clarifyReason: "Ask the first clarification questions and wait for the response; profiling happens later in the same /ds skill.", reviewerVerdict: ".planning/PLAN_REVIEWED.md", allowedOrchestratorDirectories: [".planning", ".claude", "scripts", "hooks", "references", "skills", "CLAUDE.md"] }),
  dev: Object.freeze({ workflow: "dev", clarifySentinel: ".planning/DEV_CLARIFIED.json", clarifyReason: "Ask the opening product clarification questions and wait for the response before reconnaissance.", reviewerVerdict: ".planning/PLAN_REVIEWED.md", allowedOrchestratorDirectories: [".planning", ".claude"] }),
  writing: Object.freeze({ workflow: "writing", clarifySentinel: ".planning/WRITING_CLARIFIED.json", clarifyReason: "Ask the opening thesis, audience, scope, source, deliverable, and evidence questions before reading project writing or searching sources.", reviewerVerdict: ".planning/PLAN_REVIEWED.md", allowedOrchestratorDirectories: [".planning", ".claude"] }),
  workshop: Object.freeze({ workflow: "workshop", clarifySentinel: ".planning/WORKSHOP_CLARIFIED.json", clarifyReason: "Ask the opening paper, audience, duration, structure, visual, output, and evidence questions before reading the paper or presentation project.", reviewerVerdict: ".planning/PLAN_REVIEWED.md", allowedOrchestratorDirectories: [".planning", ".claude"] }),
});
export function workflowFromArg(argv: string[]): WorkflowPolicy | null {
  const index = argv.indexOf("--workflow");
  if (index < 0 || index + 1 >= argv.length || argv.filter(value => value === "--workflow").length !== 1) return null;
  const name = argv[index + 1];
  return name === "ds" || name === "dev" || name === "writing" || name === "workshop" ? POLICIES[name] : null;
}
export function sentinelPath(projectDir: string, policy: WorkflowPolicy): string { return join(projectDir, policy.clarifySentinel); }
