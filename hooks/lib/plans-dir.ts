import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** `plansDirectory` from `path`, or "" when absent, empty, or unreadable/unparseable. */
function declaredPlansDirectory(path: string): string {
  if (!existsSync(path)) return "";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const value = parsed["plansDirectory"];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    // A malformed settings file falls back; it never throws out of a hook.
    return "";
  }
}

/**
 * Where plan mode writes plans for `projectRoot` — the single resolver for this plugin.
 *
 * Settings precedence is Claude Code's own: project local beats shared project beats user
 * (https://code.claude.com/docs/en/settings). The value is resolved relative to the project
 * root, as the setting is documented; `~` is expanded and an absolute value is taken as is.
 * Falls back to `<projectRoot>/.claude/plans` when unset at every tier.
 */
export function resolvePlansDir(projectRoot: string): string {
  const root = resolve(projectRoot);
  const declared =
    declaredPlansDirectory(join(root, ".claude", "settings.local.json")) ||
    declaredPlansDirectory(join(root, ".claude", "settings.json")) ||
    declaredPlansDirectory(join(homedir(), ".claude", "settings.json"));
  if (!declared) return join(root, ".claude", "plans");
  if (declared === "~") return homedir();
  if (declared.startsWith("~/")) return join(homedir(), declared.slice(2));
  return isAbsolute(declared) ? resolve(declared) : resolve(root, declared);
}
