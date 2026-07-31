import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveGeneratedPlanReviewState, type ResolvedGeneratedPlan } from "../../workflows/lib/approved-artifact.ts";

export type AuthenticatedWritingPlan = Readonly<{
  projectRoot: string;
  plan: ResolvedGeneratedPlan;
  style: string;
  notebook: string;
}>;

function planSection(plan: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|$)`, "mi").exec(plan)?.[1] ?? "";
}

function sourceField(sourcePlan: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`, "mi")
    .exec(sourcePlan)?.[1]?.trim() ?? "";
}

/**
 * Find an APPROVED receipt-selected native writing plan enclosing `path`.
 * Legacy planning files are deliberately not probed: they are conversion-only.
 */
export function authenticatedWritingPlan(path: string): AuthenticatedWritingPlan | null {
  let cursor: string;
  try {
    cursor = resolve(path);
  } catch {
    return null;
  }
  for (;;) {
    const resolved = resolveGeneratedPlanReviewState(cursor, "writing");
    if (!("code" in resolved) && resolved.receipt.status === "APPROVED") {
      try {
        const planText = readFileSync(resolved.planPath, "utf8");
        const intent = planSection(planText, "Writing Intent");
        const style = sourceField(intent, "Domain").toLowerCase();
        const notebook = sourceField(planSection(planText, "Source Plan"), "Notebook");
        return { projectRoot: cursor, plan: resolved, style, notebook: notebook.toLowerCase() === "none" ? "" : notebook };
      } catch {
        return null;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

export function writingStatePath(projectRoot: string): string {
  return join(projectRoot, ".planning", ".state", "writing.json");
}
