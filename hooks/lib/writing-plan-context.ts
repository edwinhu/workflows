import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AuthenticatedWritingPlan = Readonly<{
  projectRoot: string;
  planPath: string;
  style: string;
  notebook: string;
}>;

function planSection(plan: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `(?![\s\S])` IS END-OF-INPUT; `$` IS NOT, under the `m` flag. With `$` the lazy body matched
  // the empty string at the first line break, so every section came back "" — which meant
  // `style` was ALWAYS "" and the domain style guide (Volokh / McCloskey) never loaded for any
  // draft this hook linted, silently, on a plan that declared its Domain correctly.
  return new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi").exec(plan)?.[1] ?? "";
}

function sourceField(sourcePlan: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`, "mi")
    .exec(sourcePlan)?.[1]?.trim() ?? "";
}

/** The newest `.claude/plans/*.md` under `dir` that is an armed writing plan, or null. */
function armedWritingPlan(dir: string): string | null {
  const plansDir = join(dir, ".claude", "plans");
  if (!existsSync(plansDir)) return null;
  let newest: { path: string; mtime: number } | null = null;
  for (const name of readdirSync(plansDir)) {
    if (!name.endsWith(".md")) continue;
    const path = join(plansDir, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    // Armed = carries a craft:dispatch spec. A writing plan = declares Writing Intent.
    if (!text.includes("<!-- craft:dispatch") || !/^##\s+Writing Intent\s*$/mi.test(text)) continue;
    const mtime = statSync(path).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  return newest?.path ?? null;
}

/**
 * Find the armed craft writing plan governing `path`: the nearest enclosing directory whose
 * `.claude/plans/` holds a plan carrying a `craft:dispatch` block and a `## Writing Intent`
 * section. The plan file is the authority — craft hashes it in place, so there is no separate
 * receipt to consult.
 */
export function authenticatedWritingPlan(path: string): AuthenticatedWritingPlan | null {
  let cursor: string;
  try {
    cursor = resolve(path);
  } catch {
    return null;
  }
  for (;;) {
    const planPath = armedWritingPlan(cursor);
    if (planPath) {
      try {
        const planText = readFileSync(planPath, "utf8");
        const intent = planSection(planText, "Writing Intent");
        const style = sourceField(intent, "Domain").toLowerCase();
        const notebook = sourceField(planSection(planText, "Source Plan"), "Notebook");
        return { projectRoot: cursor, planPath, style, notebook: notebook.toLowerCase() === "none" ? "" : notebook };
      } catch {
        return null;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}
