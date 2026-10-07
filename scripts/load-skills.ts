#!/usr/bin/env bun
/**
 * load-skills.ts <skill>...   print each skill's body as the harness would render it on invocation.
 *
 * For a thin skill whose bang must put OTHER skills in context: an agent's `initialPrompt` can only
 * name user-invocable skills, and the writing registers are deliberately not (agent-contract). Per
 * skill it strips the frontmatter, substitutes `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}`, and
 * runs each whole-line `` !`cmd` `` with the output in its place — so the text is the skill file
 * itself, never a copy. `plugin:name` resolves under ~/.claude/skills/<plugin>/ unless the plugin is
 * this one. Exit 2 when any named skill is missing: a partial load must not read as a full one.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8")).name as string; } catch { return ""; }
})();

/** The SKILL.md a name points at, or null. */
export function skillPath(name: string, root = ROOT, plugin = PLUGIN): string | null {
  const [p, n] = name.includes(":") ? name.split(":") : [plugin, name];
  const base = p === plugin ? root : join(homedir(), ".claude", "skills", p);
  const f = join(base, "skills", n, "SKILL.md");
  return existsSync(f) ? f : null;
}

export function renderSkill(file: string): string {
  const skillDir = dirname(file);
  const pluginRoot = resolve(skillDir, "..", "..");
  const sub = (s: string) => s.replaceAll("${CLAUDE_SKILL_DIR}", skillDir).replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
  const body = readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  return sub(body).split("\n").map((l) => {
    const m = /^!`(.*)`\s*$/.exec(l);
    if (!m) return l;
    const r = spawnSync("bash", ["-c", m[1]], { encoding: "utf8", timeout: 30_000, cwd: skillDir });
    return (r.stdout ?? "").replace(/\n$/, "");
  }).join("\n");
}

if (import.meta.main) {
  const names = process.argv.slice(2);
  const missing = names.filter((n) => !skillPath(n));
  if (!names.length || missing.length) {
    console.error(`load-skills: ${names.length ? `no SKILL.md for ${missing.join(", ")}` : "usage: bun load-skills.ts <skill>..."} — NO skill was loaded`);
    process.exit(2);
  }
  for (const n of names) {
    const f = skillPath(n)!;
    process.stdout.write(`# Skill: ${n}\n\nBase directory for this skill: ${dirname(f)}\n${renderSkill(f)}\n`);
  }
}
