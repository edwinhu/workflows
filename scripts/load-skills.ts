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
 * A nested bang that fails (non-zero, timeout, spawn error) prints a loud line in its place and the
 * CLI exits 1 after printing everything.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

/** The whole-line executable bang form `` !`cmd` `` — the one form the harness and renderSkill run. */
const BANG = /^!`(.*)`\s*$/;

/** Skill names the load-skills.ts loader is asked for by the executable bang lines of a SKILL.md, never prose or inline code. */
export function bangLoaderNames(text: string): string[] {
  return text.split("\n").flatMap((l) => {
    const cmd = BANG.exec(l)?.[1];
    if (!cmd?.includes("load-skills.ts")) return [];
    return (/exec bun \S+ ([^;`]+);/.exec(cmd)?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
  });
}

/** Skills whose nested bang failed in the last renderSkill calls; the CLI reads it to pick its exit code. */
export const bangFailures: string[] = [];

export function renderSkill(file: string): string {
  const skillDir = dirname(file);
  const pluginRoot = resolve(skillDir, "..", "..");
  const sub = (s: string) => s.replaceAll("${CLAUDE_SKILL_DIR}", skillDir).replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
  const body = readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  return sub(body).split("\n").map((l) => {
    const m = BANG.exec(l);
    if (!m) return l;
    const r = spawnSync("bash", ["-c", m[1]], { encoding: "utf8", timeout: 30_000, cwd: skillDir });
    const out = (r.stdout ?? "").replace(/\n$/, "");
    if (r.status === 0) return out;
    const name = basename(skillDir);
    bangFailures.push(name);
    const why = r.error ? `${r.error.message}` : `status ${r.status}${r.signal ? ` (${r.signal})` : ""}: ${(r.stderr ?? "").trim()}`;
    return `${out}${out ? "\n" : ""}(load-skills: ${name} bang failed, ${why} — this register is NOT in your context)`;
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
  // Exit 1, not 2: a bang's exit 1 still loads (output reaches context, so the loud line is read) while exit 2 aborts the whole skill load silently (references/bang-reach.md).
  if (bangFailures.length) process.exit(1);
}
