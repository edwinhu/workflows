import { readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface PlanReviewDispatch {
  domain: string;
  referenceRoot: string;
  planPath: string;
  inputPaths: string[];
}

export interface PlanReviewConstraints {
  common: string[];
  domain: string[];
}

function markdownFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(directory, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function validatePlanReviewDispatch(dispatch: PlanReviewDispatch): string[] {
  const errors: string[] = [];
  if (!DOMAIN_PATTERN.test(dispatch.domain)) errors.push("Workflow/domain must match [a-z0-9][a-z0-9-]*.");
  if (!dispatch.referenceRoot.trim()) errors.push("Reference root is required.");
  else if (!isAbsolute(dispatch.referenceRoot)) errors.push("Reference root must be an absolute path.");
  if (!dispatch.planPath) errors.push("Plan path is required.");
  if (dispatch.inputPaths.length === 0 || dispatch.inputPaths.some((path) => !path)) {
    errors.push("At least one input path is required.");
  }
  return errors;
}

export function discoverPlanReviewConstraints(referenceRoot: string, domain: string): PlanReviewConstraints {
  const errors = validatePlanReviewDispatch({ domain, referenceRoot, planPath: "plan", inputPaths: ["input"] });
  if (errors.length > 0) throw new Error(errors.join(" "));

  const root = resolve(referenceRoot, "plan-review");
  const common = markdownFiles(join(root, "common"));
  const domainConstraints = markdownFiles(join(root, domain));
  if (common.length === 0 || domainConstraints.length === 0) {
    throw new Error(`No plan-review constraints found for common and/or domain '${domain}'.`);
  }
  return { common, domain: domainConstraints };
}
