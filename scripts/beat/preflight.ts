#!/usr/bin/env bun
/**
 * The IMPLEMENT beat's deterministic pre-step: authenticate the approval, validate the wave, derive
 * the adjudication expectation, route by shape, and emit the script when a script is warranted.
 *
 * WHY THIS FILE EXISTS — WHAT IT REPLACED
 *   `workflows/beat-implement.js` was one script that did ALL of this plus the dispatch loop. It
 *   could never execute: the Workflow runtime is pure control flow (no `import()`, no `process`, no
 *   `Buffer`), so it died at its first import and /work's implement step had never run. Retiring it
 *   was a MIGRATION rather than a delete, because ~105 assertions across four suites pinned its
 *   dispatch policy, and that policy is the safety property — not the file.
 *
 *   The policy split cleanly along one line: what can be decided BEFORE any agent runs, and what can
 *   only be decided BETWEEN dispatches.
 *
 *     BEFORE  -> here. Approval identity, task contracts, writable-path canonicality, resume proof,
 *                candidate configuration, routing, prompt construction, expectation derivation.
 *     BETWEEN -> hooks/work-implement-observation.ts. The git delta around each dispatch and the
 *                output-contract adjudication, which no pre-step or post-step can supply because the
 *                moment it needs does not exist yet at one end and is unattributable at the other.
 *
 *   Nothing was dropped in the split. Each half is asserted where it now lives:
 *   tests/beat-implement-preflight.test.mjs and tests/work-implement-observation.test.mjs.
 *
 * ONE DELIBERATE CHANGE, STATED RATHER THAN HIDDEN
 *   The old runner re-captured a git observation before EACH task and bound that task's approval to
 *   it, so task N's approval carried the post-state of task N-1. This binds every task in the wave to
 *   the ONE pre-wave observation instead, because a pre-step by definition runs before any of the
 *   intervening states exist.
 *
 *   That is not a loss of per-task attribution — it is a relocation of it. Per-task pre/post
 *   observation now happens in the hook that actually brackets each dispatch, which is strictly
 *   better attribution than the old loop had (it bracketed the `agent()` call; the hook brackets the
 *   agent's own tool calls). What the approval binding still proves is what it was for: this wave was
 *   authorised against this plan, from this filesystem state, by this session.
 *
 * IDENTITY. The runner read `process.env.CLAUDE_CODE_SESSION_ID` because the Workflow runtime has no
 * hook payload. This is an ordinary script with the same environment, and the same rule applies: the
 * value is session-TREE-wide, so it may serve as a DISPATCH identity and never as a reviewer or
 * implementer identity. approver != implementer is enforced on each implementer's own tool calls by
 * hooks/implementer-identity-gate.ts, where a real implementer identity first exists.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  parseApprovalPolicyDescriptor,
  validateApprovedArtifact,
  validateBuiltInImplementationApproval,
  validateCapturedApprovalBundle,
  validateExternalImplementationApproval,
  validateGeneratedPlanArtifact,
  validateGeneratedPlanImplementationApproval,
} from "../../workflows/lib/approved-artifact.ts";
import {
  concretePaths,
  fingerprint,
  pathsOverlap,
  requiredText,
  validateTask,
  writablePathsWithin,
} from "../../workflows/lib/task-contract.ts";
import { captureGitObservation } from "../../workflows/lib/git-observation.ts";
import { validateCandidateMutationConfiguration } from "../../workflows/lib/candidate-state.ts";
import { OBSERVATION_DIR, expectationPath, type Expectation } from "../../hooks/work-implement-observation.ts";
import { sessionFlagKey } from "../../hooks/_gate_common.ts";
import { routeImplementation, type RoutingDecision } from "./route-implementation.ts";
import { emitImplementationWorkflow } from "./emit-implementation-workflow.ts";

export const BUILT_IN_WORKFLOWS = ["ds", "dev", "work", "writing", "workshop", "workflow-creator"] as const;

export type PreflightRequest = {
  projectDir: string;
  workflow: string;
  approvalMode?: "external-fixed-v1" | "generated-plan-receipt-v1";
  approvalPolicy?: unknown;
  capturedApprovalBundle?: unknown;
  readyWave: unknown;
  planReset?: Record<string, unknown>;
  resume?: { attemptedTaskIds?: unknown; attemptRecords?: unknown };
  candidateState?: unknown;
  affectedChecks?: unknown;
  /** Phase titles the DOMAIN skill supplies; the beat never invents them. */
  phases?: readonly string[];
  /** Overrides the dispatching session identity. Tests set it; production reads the environment. */
  dispatchSession?: string;
};

export type PreflightResult = {
  workflow: string;
  approvalMode: "built-in-native" | "external-fixed-v1" | "generated-plan-receipt-v1";
  generatedPlanMode: boolean;
  dispatchSession: string;
  planReset: Record<string, unknown>;
  waveFingerprint: string;
  preDispatchObservationDigest: string;
  executionMode: "sequential";
  executionReason: string;
  routing: RoutingDecision;
  /** Tasks actually to be dispatched — the full wave, or only the proven attempted subset on resume. */
  tasks: { id: string; name: string; prompt: string }[];
  resumedAttemptedWorkOnly: boolean;
  approvals: { taskId: string; approvalBundleDigest: string }[];
  expectationPath: string;
  emittedWorkflowPath?: string;
};

function requiredWorkflowIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
}

/**
 * The implementation prompt, verbatim in substance from the retired runner's `promptFor`.
 *
 * Two properties here are load-bearing and asserted, not stylistic:
 *   - It opens the task section with `TASK <id>: <name>` on its own line. That marker is the ONLY way
 *     the observation hook correlates an Agent call with the task it implements — hooks receive the
 *     tool input, not the caller's variables. Reword it and adjudication silently stops happening.
 *   - It carries immutable approval identity and NOTHING mutable. No phase cursor, no TaskList
 *     history, no STATE/SPEC/LEARNINGS, no prior agent memory. Mutable context smuggles earlier
 *     interpretation across the approval boundary and turns the approved plan into a suggestion.
 */
export function buildTaskPrompt(task: Record<string, any>, projectDir: string): string {
  return `You are the direct implementation agent for one already-approved task. Work only in ${projectDir}.

TASK ${task.id}: ${task.name}
WORK:
${task.work}

SUCCESS CRITERIA:
${task.criteria}

DECLARED OUTPUTS:
${(task.outputs || []).map((output: string) => `- ${output}`).join("\n") || "- None declared"}

EXCLUSIVE WRITABLE PATHS (your only authority to modify; include every changed file in changedFiles):
${(task.writablePaths || []).map((path: string) => `- ${path}`).join("\n")}

REQUIRED INSTRUCTIONS — read every file before work; they are part of this task's contract:
${(task.instructionFiles || []).map((path: string) => `- ${path}`).join("\n") || "- None supplied"}

Read every REQUIRED INSTRUCTIONS file first, then implement the task and run the task-local evidence needed to support the criteria. You may modify only EXCLUSIVE WRITABLE PATHS. Do not parse or reinterpret a plan file; the caller already supplied this complete ready-wave spec. Do not perform final verification or grade the result; an independent verifier runs outside this workflow. Do not delegate. If you encounter a blocker requiring a decision, return status="blocked". If execution cannot complete, return status="failed". Return every modified project-relative path in changedFiles.`;
}

function contractDigest(task: any): string {
  return createHash("sha256").update(Buffer.from(fingerprint(task), "utf8")).digest("hex");
}

/**
 * Dispatch stays sequential regardless of how disjoint the declared paths look.
 *
 * This is not conservatism about the plan's honesty — it is that a post-return manifest cannot
 * establish isolation that did not exist during the run. Two concurrent agents with disjoint
 * `writablePaths` still share one working tree, and the git delta that adjudicates them cannot be
 * attributed to either. Concurrency becomes available when workers have enforced filesystem
 * isolation, and not before.
 */
function selectMode(tasks: any[]): { mode: "sequential"; reason: string } {
  const overlapping = tasks.some((task, index) => tasks.slice(index + 1).some(other =>
    [...(concretePaths(task.writablePaths) ?? [])].some(left =>
      [...(concretePaths(other.writablePaths) ?? [])].some(right => pathsOverlap(left, right)))));
  return {
    mode: "sequential",
    reason: overlapping
      ? "implementation dispatch is sequential because declared writable paths overlap"
      : "implementation dispatch is sequential until workers have enforced filesystem isolation; post-return manifests cannot authorize concurrency",
  };
}

export function preflight(request: PreflightRequest): PreflightResult {
  const project = request.projectDir;
  if (!project) throw new Error("beat-implement preflight requires projectDir");
  if (!requiredWorkflowIdentity(request.workflow)) {
    throw new Error("beat-implement preflight requires workflow as a validated workflow identity");
  }
  const builtIn = (BUILT_IN_WORKFLOWS as readonly string[]).includes(request.workflow);
  if (builtIn && request.approvalMode !== undefined) {
    throw new Error("beat-implement built-in workflows cannot override approvalMode");
  }
  if (!builtIn && !["external-fixed-v1", "generated-plan-receipt-v1"].includes(request.approvalMode as string)) {
    throw new Error("beat-implement external workflows require explicit approvalMode as external-fixed-v1 or generated-plan-receipt-v1");
  }
  const approvalMode = builtIn ? "built-in-native" : request.approvalMode!;
  const generatedPlanMode = approvalMode === "built-in-native" || approvalMode === "generated-plan-receipt-v1";
  if (!Array.isArray(request.readyWave)) {
    throw new Error("beat-implement preflight requires readyWave as a complete task-spec array");
  }

  const reset = request.planReset || {};
  if (approvalMode === "external-fixed-v1") {
    if (request.approvalPolicy === undefined) throw new Error("beat-implement external-fixed-v1 requires an explicit approval policy");
    const policy = parseApprovalPolicyDescriptor(request.approvalPolicy, request.workflow);
    if ((policy as any).code) throw new Error(`beat-implement ${(policy as any).message}`);
  } else if (request.approvalPolicy !== undefined) {
    if (builtIn) throw new Error("beat-implement built-in workflows cannot override approval policy");
    throw new Error(`beat-implement ${approvalMode} does not accept an approval policy`);
  }
  if (generatedPlanMode) {
    if (!requiredText(reset.planFile)) throw new Error("beat-implement requires nonempty immutable planReset.planFile");
    if (!requiredText(reset.planHash)) throw new Error("beat-implement requires nonempty immutable planReset.planHash");
    if (Object.keys(reset).some(key => !["planFile", "planHash"].includes(key))) {
      throw new Error(`beat-implement ${approvalMode} planReset accepts only planFile and planHash`);
    }
  } else {
    if (!requiredText(reset.approvedBodyHash)) throw new Error("beat-implement external planReset requires nonempty approvedBodyHash");
    if (!requiredText(reset.session)) throw new Error("beat-implement external planReset requires nonempty session");
    if (Object.keys(reset).some(key => !["approvedBodyHash", "session"].includes(key))) {
      throw new Error("beat-implement external planReset accepts only approvedBodyHash and session");
    }
  }

  const dispatchSession = request.dispatchSession ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof dispatchSession !== "string" || !dispatchSession.trim()) {
    throw new Error("beat-implement cannot authenticate its dispatching session: CLAUDE_CODE_SESSION_ID is absent or empty. Refusing to dispatch implementation without an actor identity.");
  }
  const actor = { role: "dispatch" as const, identity: dispatchSession };

  let artifact: any = null;
  if (request.capturedApprovalBundle === undefined) {
    artifact = approvalMode === "generated-plan-receipt-v1"
      ? validateGeneratedPlanArtifact(project, request.workflow, actor)
      : validateApprovedArtifact(project, request.workflow, actor, request.approvalPolicy as any);
    if (artifact.code) throw new Error(`beat-implement ${artifact.message}`);
    if (generatedPlanMode) {
      if (reset.planFile !== artifact.planFile || reset.planHash !== artifact.hash) {
        throw new Error("beat-implement rejects caller planReset that differs from current receipt-selected generated plan");
      }
    } else if (reset.approvedBodyHash !== artifact.hash || reset.session !== artifact.metadata?.approvedSession) {
      throw new Error("beat-implement rejects caller planReset that differs from durable external approval metadata");
    }
  } else if (approvalMode !== "external-fixed-v1") {
    throw new Error(`beat-implement ${approvalMode} workflows do not accept captured approval bundles`);
  }

  const wave = request.readyWave as any[];
  const ids = new Set<string>();
  for (const task of wave) {
    if (!validateTask(task)) throw new Error(`beat-implement task violates the shared task contract: ${JSON.stringify(task)}`);
    if (!writablePathsWithin(project, task.writablePaths)) {
      throw new Error(`beat-implement task writablePaths must remain below the canonical project root without symlinks: ${JSON.stringify(task.writablePaths)}`);
    }
    if (ids.has(task.id)) throw new Error(`beat-implement readyWave has duplicate task id: ${task.id}`);
    ids.add(task.id);
  }

  // Resume proof. A retry may re-dispatch ONLY work a PRIOR run of THIS approved plan actually
  // attempted — proven by a complete prior record whose task fingerprint still matches. Without that,
  // "resume" becomes an unbounded re-dispatch under the authority of an approval that never covered it.
  const attempted = request.resume?.attemptedTaskIds;
  const attemptRecords = request.resume?.attemptRecords;
  if (attempted !== undefined && !Array.isArray(attempted)) throw new Error("beat-implement resume.attemptedTaskIds must be an array");
  if (attempted && !Array.isArray(attemptRecords)) throw new Error("beat-implement retry requires resume.attemptRecords from the preceding runner result");
  const isPriorResult = (record: any) => {
    const sameApproval = generatedPlanMode
      ? record?.planFile === reset.planFile && record?.planHash === reset.planHash
      : record?.approvedBodyHash === reset.approvedBodyHash && record?.session === reset.session;
    return record && typeof record === "object"
      && requiredText(record.taskId)
      && requiredText(record.taskFingerprint)
      && sameApproval
      && ["implemented", "blocked", "failed"].includes(record.status)
      && typeof record.summary === "string"
      && Array.isArray(record.reusableFacts)
      && record.reusableFacts.every((fact: unknown) => typeof fact === "string")
      && Array.isArray(record.changedFiles)
      && record.changedFiles.every((path: unknown) => typeof path === "string");
  };
  if (attemptRecords && !(attemptRecords as any[]).every(isPriorResult)) {
    throw new Error("beat-implement resume.attemptRecords must be complete records for this approved plan identity");
  }
  const priorAttempts = new Map(((attemptRecords as any[]) || []).map(record => [record.taskId, record]));
  const attemptedIds = attempted ? new Set(attempted as string[]) : null;
  if (attemptedIds) {
    for (const id of attemptedIds) {
      if (!ids.has(id)) throw new Error(`beat-implement resume names task not in readyWave: ${id}`);
      const record = priorAttempts.get(id);
      if (!record || record.taskFingerprint !== fingerprint(wave.find(task => task.id === id))) {
        throw new Error(`beat-implement refuses retry without a matching prior record for task: ${id}`);
      }
    }
  }
  const tasks = attemptedIds ? wave.filter(task => attemptedIds.has(task.id)) : wave;

  if (request.candidateState !== undefined) {
    validateCandidateMutationConfiguration(request.candidateState as any, request.affectedChecks as any);
  } else if (request.affectedChecks !== undefined) {
    throw new Error("beat-implement affectedChecks require candidateState");
  }

  // The pre-wave observation. It anchors every approval binding below, and a failure to capture it is
  // fatal HERE rather than fail-open, because unlike the hook this runs before any agent exists: there
  // is no work in flight to avoid disrupting, and dispatching without an anchor would authorise a wave
  // against a filesystem state nobody recorded.
  const preObservation = captureGitObservation(project);

  const approvals: { taskId: string; approvalBundleDigest: string }[] = [];
  for (const task of tasks) {
    const binding = {
      taskIdentity: task.id,
      taskContractDigest: contractDigest(task),
      preDispatchObservationDigest: preObservation.digest,
      implementationSession: dispatchSession,
      implementationRole: "dispatch" as const,
    };
    const approval: any = request.capturedApprovalBundle !== undefined
      ? validateCapturedApprovalBundle(request.capturedApprovalBundle as any, request.workflow, binding)
      : approvalMode === "built-in-native"
        ? validateBuiltInImplementationApproval(artifact, request.workflow, binding)
        : approvalMode === "generated-plan-receipt-v1"
          ? validateGeneratedPlanImplementationApproval(artifact, request.workflow, binding)
          : validateExternalImplementationApproval(artifact, request.workflow, binding);
    if (approval.code) throw new Error(approval.message);
    if (generatedPlanMode) {
      if (approval.planFile !== reset.planFile || approval.planHash !== reset.planHash) {
        throw new Error("current generated-plan approval differs from immutable planReset identity");
      }
    } else if (approval.planDigest !== reset.approvedBodyHash || approval.approvalSession !== reset.session) {
      throw new Error("captured external approval differs from immutable planReset identity");
    }
    approvals.push({ taskId: task.id, approvalBundleDigest: approval.approvalBundleDigest });
  }

  const waveFingerprint = createHash("sha256")
        // NUL separator, written as an ESCAPE and never as a literal byte. The value is right --
    // fingerprints are JSON, which escapes control characters, so a raw NUL cannot appear inside
    // one and cannot forge a boundary. A literal NUL in the source is not: it makes this file
    // classify as binary, which fails the public privacy scanner and would ship an unreviewable
    // blob. The same slip put a NUL in a sentinel string earlier this week.
    .update(Buffer.from(tasks.map(task => fingerprint(task)).join("\u0000"), "utf8"))
    .digest("hex");

  // THE EXPECTATION IS DERIVED FROM THE AUTHENTICATED PLAN, AND IT IS WRITTEN HERE ON PURPOSE.
  //
  // The hook adjudicates each task against these bounds. If it took them from the dispatch prompt
  // instead, the orchestrator would be supplying the standard its own agents are judged by, which is
  // not adjudication. Writing it in the pre-step — after approval authentication, before any agent
  // exists — is the only point at which the bounds are both known and untouched by the run.
  const expectation: Expectation = {
    waveFingerprint,
    projectDir: project,
    workflow: request.workflow,
    tasks: Object.fromEntries(tasks.map(task => [task.id, {
      writablePaths: [...task.writablePaths],
      outputs: [...(task.outputs || [])],
    }])),
  };
  // KEYED THE WAY THE HOOK READS IT, NOT THE WAY THIS SCRIPT KNOWS IT.
  //
  // The hook resolves its session via `sessionFlagKey(payload)`, which is a sanitised-plus-hashed
  // DERIVATIVE of the raw session id, not the id itself. Writing this file under the raw id produces
  // no error anywhere: the preflight succeeds, the hook finds no expectation, and every dispatch is
  // recorded as "no-expectation" and adjudicated against nothing. Silent, total loss of enforcement.
  // The same call is used on both sides so the two cannot drift.
  const expectationFile = expectationPath(sessionFlagKey({ session_id: dispatchSession }));
  mkdirSync(OBSERVATION_DIR, { recursive: true });
  writeFileSync(expectationFile, JSON.stringify(expectation, null, 2));

  const selected = selectMode(tasks);
  const routing = routeImplementation(tasks.map(task => ({ id: task.id, outputs: task.outputs })));

  const prompted = tasks.map(task => ({ id: task.id, name: task.name, prompt: buildTaskPrompt(task, project) }));

  let emittedWorkflowPath: string | undefined;
  if (routing.route === "workflow") {
    const { path } = emitImplementationWorkflow({
      projectDir: project,
      planFile: String(reset.planFile ?? reset.approvedBodyHash),
      planHash: String(reset.planHash ?? reset.approvedBodyHash),
      domain: request.workflow,
      phases: request.phases?.length ? request.phases : ["Implement"],
      tasks: prompted.map(task => ({ id: task.id, name: task.name, prompt: task.prompt })),
    });
    emittedWorkflowPath = path;
  }

  return {
    workflow: request.workflow,
    approvalMode,
    generatedPlanMode,
    dispatchSession,
    planReset: reset,
    waveFingerprint,
    preDispatchObservationDigest: preObservation.digest,
    executionMode: selected.mode,
    executionReason: selected.reason,
    routing,
    tasks: prompted,
    resumedAttemptedWorkOnly: !!attemptedIds,
    approvals,
    expectationPath: expectationFile,
    emittedWorkflowPath,
  };
}

if (import.meta.main) {
  const request = JSON.parse(await new Response(Bun.stdin.stream()).text()) as PreflightRequest;
  try {
    console.log(JSON.stringify({ ok: true, ...preflight(request) }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}
