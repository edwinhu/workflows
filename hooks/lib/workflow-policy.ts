import { readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";

const BUILT_IN_WORKFLOWS = new Set(["ds", "dev", "writing", "workshop", "workflow-creator"]);
const WORKFLOW_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export type WorkflowPolicy = Readonly<{
  workflow: string;
  clarifySentinel: string;
  clarifyReason: string;
  reviewerVerdict: string;
  approvalPolicy?: string;
  allowedOrchestratorDirectories: readonly string[];
}>;

type WorkflowPolicyDescriptor = WorkflowPolicy & Readonly<{ schemaVersion: 1 }>;

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

function parseDescriptor(text: string): WorkflowPolicyDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw descriptorError("malformed JSON");
  }

  const keys = [
    "schemaVersion",
    "workflow",
    "clarifySentinel",
    "clarifyReason",
    "reviewerVerdict",
    "approvalPolicy",
    "allowedOrchestratorDirectories",
  ] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw descriptorError(`expected only ${keys.join(", ")}`);
  }
  if (value.schemaVersion !== 1) throw descriptorError("unsupported schemaVersion");
  if (typeof value.workflow !== "string" || !WORKFLOW_PATTERN.test(value.workflow)) {
    throw descriptorError("invalid workflow identity");
  }
  if (BUILT_IN_WORKFLOWS.has(value.workflow)) {
    throw descriptorError("external descriptor cannot replace a built-in workflow");
  }
  if (!isSafeProjectRelativePath(value.clarifySentinel)) {
    throw descriptorError("clarifySentinel must be a canonical project-relative path");
  }
  if (typeof value.clarifyReason !== "string" || value.clarifyReason.trim() !== value.clarifyReason || value.clarifyReason.length === 0) {
    throw descriptorError("clarifyReason must be a non-empty trimmed string");
  }
  if (!isSafeProjectRelativePath(value.reviewerVerdict)) {
    throw descriptorError("reviewerVerdict must be a canonical project-relative path");
  }
  if (!isSafeProjectRelativePath(value.approvalPolicy)) {
    throw descriptorError("approvalPolicy must be a canonical project-relative path");
  }
  if (!Array.isArray(value.allowedOrchestratorDirectories) || value.allowedOrchestratorDirectories.length === 0) {
    throw descriptorError("allowedOrchestratorDirectories must be a non-empty array");
  }
  const directories: string[] = [];
  const seen = new Set<string>();
  for (const directory of value.allowedOrchestratorDirectories) {
    if (!isSafeProjectRelativePath(directory)) {
      throw descriptorError("allowed orchestrator directory must be a canonical project-relative path");
    }
    if (seen.has(directory)) throw descriptorError(`duplicate allowed orchestrator directory: ${directory}`);
    seen.add(directory);
    directories.push(directory);
  }

  return {
    schemaVersion: 1,
    workflow: value.workflow,
    clarifySentinel: value.clarifySentinel,
    clarifyReason: value.clarifyReason,
    reviewerVerdict: value.reviewerVerdict,
    approvalPolicy: value.approvalPolicy,
    allowedOrchestratorDirectories: directories,
  };
}

export function freezeWorkflowPolicy(policy: WorkflowPolicy): WorkflowPolicy {
  return Object.freeze({
    workflow: policy.workflow,
    clarifySentinel: policy.clarifySentinel,
    clarifyReason: policy.clarifyReason,
    reviewerVerdict: policy.reviewerVerdict,
    ...(policy.approvalPolicy === undefined ? {} : { approvalPolicy: policy.approvalPolicy }),
    allowedOrchestratorDirectories: Object.freeze([...policy.allowedOrchestratorDirectories]),
  });
}

export function loadExternalWorkflowPolicy(descriptorPath: string): WorkflowPolicy {
  if (typeof descriptorPath !== "string" || descriptorPath.length === 0) {
    throw descriptorError("descriptor path must be explicit");
  }
  const descriptor = parseDescriptor(readFileSync(descriptorPath, "utf8"));
  return freezeWorkflowPolicy(descriptor);
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
