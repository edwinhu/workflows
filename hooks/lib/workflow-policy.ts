import { readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

const BUILT_IN_WORKFLOWS = new Set(["ds", "dev", "work", "writing", "workshop", "workflow-creator"]);
const WORKFLOW_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export type ApprovalMode = "external-fixed-v1" | "generated-plan-receipt-v1" | "built-in-native";
type WorkflowPolicyBase = Readonly<{
  workflow: string;
  approvalMode: ApprovalMode;
  allowedOrchestratorDirectories: readonly string[];
}>;
export type ExternalFixedWorkflowPolicy = WorkflowPolicyBase & Readonly<{
  approvalMode: "external-fixed-v1";
  clarifySentinel: string;
  clarifyReason: string;
  reviewerVerdict: string;
  approvalPolicy: string;
}>;
export type GeneratedPlanWorkflowPolicy = WorkflowPolicyBase & Readonly<{
  approvalMode: "generated-plan-receipt-v1";
}>;
export type BuiltInWorkflowPolicy = WorkflowPolicyBase & Readonly<{
  approvalMode: "built-in-native";
  clarifySentinel: string;
  clarifyReason: string;
  reviewerVerdict: string;
}>;
export type WorkflowPolicy = ExternalFixedWorkflowPolicy | GeneratedPlanWorkflowPolicy | BuiltInWorkflowPolicy;

type WorkflowPolicyDescriptorV1 = Readonly<{
  schemaVersion: 1;
  workflow: string;
  clarifySentinel: string;
  clarifyReason: string;
  reviewerVerdict: string;
  approvalPolicy: string;
  allowedOrchestratorDirectories: readonly string[];
}>;
type WorkflowPolicyDescriptorV2 = Readonly<{
  schemaVersion: 2;
  workflow: string;
  approvalMode: "generated-plan-receipt-v1";
  allowedOrchestratorDirectories: readonly string[];
}>;
type WorkflowPolicyDescriptor = WorkflowPolicyDescriptorV1 | WorkflowPolicyDescriptorV2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(record, key));
}

function descriptorError(message: string): Error {
  return new Error(`Invalid workflow policy descriptor: ${message}`);
}

function isSafeProjectRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.includes("\\")) return false;
  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return normalize(value) === value;
}

function parseDirectories(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw descriptorError("allowedOrchestratorDirectories must be a non-empty array");
  }
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const directory of value) {
    if (!isSafeProjectRelativePath(directory)) {
      throw descriptorError("allowed orchestrator directory must be a canonical project-relative path");
    }
    if (seen.has(directory)) throw descriptorError(`duplicate allowed orchestrator directory: ${directory}`);
    seen.add(directory);
    directories.push(directory);
  }
  return directories;
}

function parseWorkflowIdentity(value: unknown): string {
  if (typeof value !== "string" || !WORKFLOW_PATTERN.test(value)) throw descriptorError("invalid workflow identity");
  if (BUILT_IN_WORKFLOWS.has(value)) throw descriptorError("external descriptor cannot replace a built-in workflow");
  return value;
}

function parseDescriptor(text: string): WorkflowPolicyDescriptor {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw descriptorError("malformed JSON"); }
  if (!isRecord(value)) throw descriptorError("descriptor must be an object");

  if (value.schemaVersion === 1) {
    const keys = ["schemaVersion", "workflow", "clarifySentinel", "clarifyReason", "reviewerVerdict", "approvalPolicy", "allowedOrchestratorDirectories"] as const;
    if (!hasExactKeys(value, keys)) throw descriptorError(`expected only ${keys.join(", ")}`);
    const workflow = parseWorkflowIdentity(value.workflow);
    if (!isSafeProjectRelativePath(value.clarifySentinel)) throw descriptorError("clarifySentinel must be a canonical project-relative path");
    if (typeof value.clarifyReason !== "string" || value.clarifyReason.trim() !== value.clarifyReason || value.clarifyReason.length === 0) throw descriptorError("clarifyReason must be a non-empty trimmed string");
    if (!isSafeProjectRelativePath(value.reviewerVerdict)) throw descriptorError("reviewerVerdict must be a canonical project-relative path");
    if (!isSafeProjectRelativePath(value.approvalPolicy)) throw descriptorError("approvalPolicy must be a canonical project-relative path");
    return {
      schemaVersion: 1,
      workflow,
      clarifySentinel: value.clarifySentinel,
      clarifyReason: value.clarifyReason,
      reviewerVerdict: value.reviewerVerdict,
      approvalPolicy: value.approvalPolicy,
      allowedOrchestratorDirectories: parseDirectories(value.allowedOrchestratorDirectories),
    };
  }

  if (value.schemaVersion === 2) {
    const keys = ["schemaVersion", "workflow", "approvalMode", "allowedOrchestratorDirectories"] as const;
    if (!hasExactKeys(value, keys)) throw descriptorError(`expected only ${keys.join(", ")}`);
    if (value.approvalMode !== "generated-plan-receipt-v1") throw descriptorError("approvalMode must be generated-plan-receipt-v1");
    return {
      schemaVersion: 2,
      workflow: parseWorkflowIdentity(value.workflow),
      approvalMode: value.approvalMode,
      allowedOrchestratorDirectories: parseDirectories(value.allowedOrchestratorDirectories),
    };
  }
  throw descriptorError("unsupported schemaVersion");
}

export function isGeneratedPlanWorkflow(policy: WorkflowPolicy): policy is GeneratedPlanWorkflowPolicy | BuiltInWorkflowPolicy {
  return policy.approvalMode === "generated-plan-receipt-v1" || policy.approvalMode === "built-in-native";
}

export function freezeWorkflowPolicy(policy: WorkflowPolicy): WorkflowPolicy {
  const base = {
    workflow: policy.workflow,
    approvalMode: policy.approvalMode,
    allowedOrchestratorDirectories: Object.freeze([...policy.allowedOrchestratorDirectories]),
  };
  if (policy.approvalMode === "generated-plan-receipt-v1") return Object.freeze(base);
  if (policy.approvalMode === "external-fixed-v1") return Object.freeze({
    ...base,
    clarifySentinel: policy.clarifySentinel,
    clarifyReason: policy.clarifyReason,
    reviewerVerdict: policy.reviewerVerdict,
    approvalPolicy: policy.approvalPolicy,
  });
  return Object.freeze({
    ...base,
    clarifySentinel: policy.clarifySentinel,
    clarifyReason: policy.clarifyReason,
    reviewerVerdict: policy.reviewerVerdict,
  });
}

export function loadExternalWorkflowPolicy(descriptorPath: string): WorkflowPolicy {
  if (typeof descriptorPath !== "string" || descriptorPath.length === 0) throw descriptorError("descriptor path must be explicit");
  const descriptor = parseDescriptor(readFileSync(descriptorPath, "utf8"));
  if (descriptor.schemaVersion === 2) return freezeWorkflowPolicy({
    workflow: descriptor.workflow,
    approvalMode: descriptor.approvalMode,
    allowedOrchestratorDirectories: descriptor.allowedOrchestratorDirectories,
  });
  return freezeWorkflowPolicy({
    workflow: descriptor.workflow,
    approvalMode: "external-fixed-v1",
    clarifySentinel: descriptor.clarifySentinel,
    clarifyReason: descriptor.clarifyReason,
    reviewerVerdict: descriptor.reviewerVerdict,
    approvalPolicy: descriptor.approvalPolicy,
    allowedOrchestratorDirectories: descriptor.allowedOrchestratorDirectories,
  });
}

export function workflowPolicyFromArg(
  argv: string[],
  builtInPolicy?: (argv: string[]) => WorkflowPolicy | null,
): WorkflowPolicy | null {
  const workflowCount = argv.filter((value) => value === "--workflow").length;
  const descriptorCount = argv.filter((value) => value === "--workflow-policy").length;
  if (workflowCount + descriptorCount !== 1) return null;
  if (descriptorCount === 1) {
    const index = argv.indexOf("--workflow-policy");
    if (index + 1 >= argv.length) return null;
    return loadExternalWorkflowPolicy(argv[index + 1]);
  }
  return builtInPolicy?.(argv) ?? null;
}
