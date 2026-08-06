#!/usr/bin/env bun
/**
 * SubagentStart hook: brief every spawned subagent with the project's domain knowledge.
 *
 * TypeScript port of subagent-start.py — behavior-identical, including the odd bits:
 *   - malformed/empty stdin is swallowed (the payload is parsed and then never read);
 *   - a missing .planning/ dir and an empty `parts` list are two DIFFERENT silent exits;
 *   - `Path.glob('*.md')` matches dotfiles AND directories, so the reference listing does too;
 *   - the `## Active workflow:` value is rejected only when it upper-cases to exactly UNKNOWN.
 *
 * WHY THIS EXISTS
 *     Domain references (e.g. wrds/references/taq.md) are discovered by /ds while drafting
 *     the native plan. Nothing re-reads them during implementation, so a subagent
 *     spawned to write code starts with no idea that verified, project-specific facts exist
 *     -- and re-derives (or contradicts) them.
 *
 * Output goes through pyJson, never JSON.stringify: json.dumps' separators and ensure_ascii
 * change the bytes of the em dashes in the injected text.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pyJson } from "./_gate_common.ts";
import { classifyPlanningLifecycle } from "../workflows/lib/approved-artifact.ts";

const SKILLS_ROOT = join(homedir(), "projects", "workflows", "skills");

/** Path.read_text, degrading to "" on any IOError/OSError (missing file, a directory, …). */
function read(p: string): string {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Skill names listed in workflow state or the approved native PLAN ('Skills Touched'). */
function domainSkills(): string[] {
  const skills: string[] = [];
  const lifecycle = classifyPlanningLifecycle(process.cwd());
  // Do not scan visible plan names: only the receipt-selected generated plan is modern authority.
  const names = lifecycle.kind === "canonical" ? [lifecycle.resolved.planFile] : [];
  for (const name of names) {
    const text = read(join(process.cwd(), ".planning", name));
    const re = /^\s*[-*]\s+`([a-z0-9][a-z0-9:_-]*)`\s*[-—]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m[1];
      if (!skills.includes(s)) skills.push(s);
    }
  }
  return skills;
}

function referenceFiles(skill: string): string[] {
  const d = join(SKILLS_ROOT, skill, "references");
  if (!isDir(d)) return [];
  // Path.glob('*.md') matches dotfiles and directories too — only the suffix is checked.
  return readdirSync(d).filter((n) => n.endsWith(".md")).sort();
}

function activeWorkflow(): string | null {
  const lifecycle = classifyPlanningLifecycle(process.cwd());
  if (lifecycle.kind === "canonical") return lifecycle.resolved.receipt.workflow;
  if (lifecycle.kind === "blocked") return null;

  return null;
}

async function main(): Promise<void> {
  try {
    JSON.parse(await Bun.stdin.text());
  } catch {
    /* pass — the parsed payload is never used */
  }

  if (!isDir(join(process.cwd(), ".planning"))) process.exit(0);

  const lifecycle = classifyPlanningLifecycle(process.cwd());
  if (lifecycle.kind === "blocked") {
    console.log(pyJson({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        /**
         * THE EXEMPTION IS NOT A LOOPHOLE — IT IS THE DIFFERENCE BETWEEN DISCOVERY AND AUTHORITY.
         *
         * MEASURED 2026-08-06, in the first real run of `workflows/work.js`. Every implementer this
         * hook briefs is handed ONE plan path pinned by sha256 in its own task, and its first act is
         * to verify those bytes. This text told it not to read that file. The agent read it anyway —
         * correctly, since the task designated it as sole authority and pinned it — and then FLAGGED
         * THE CONFLICT in its report rather than silently resolving it, which is the behaviour we
         * want and also a sign the instruction was wrong.
         *
         * An instruction that well-behaved agents must violate to do the job teaches them that this
         * hook's output is advisory. That is a far worse outcome than the retired-state resumption
         * this text exists to prevent, because it devalues every other thing the hook says.
         *
         * What is actually forbidden is DISCOVERY: choosing a plan by looking in `.planning/`. A
         * file whose hash your caller pinned was not discovered, it was authenticated upstream.
         */
        additionalContext: "PLANNING STATE BLOCKED. Do not DISCOVER a plan by reading or listing visible planning files, and do not write them: the retired state here cannot authorize work. EXCEPTION — if your task pins one plan path by sha256, read that file and verify the hash before using it. That is not discovery; it was authenticated by your caller, and it is the only planning file you may read. Convert the retired state or create a fresh approved generated plan before resuming anything else.",
      },
    }));
    process.exit(0);
  }

  const parts: string[] = [];

  const wf = activeWorkflow();
  if (wf) {
    parts.push(
      `ACTIVE WORKFLOW: /${wf}. This task is part of that workflow -- follow its ` +
        `conventions, and read the receipt-selected generated plan for approved decisions and evidence. ` +
        `Call TaskList for live work and consult project auto-memory for durable technical facts ` +
        `from earlier tasks.`,
    );
  }

  const skills = domainSkills();
  if (skills.length) {
    const lines = [
      "DOMAIN KNOWLEDGE -- READ BEFORE WRITING ANY CODE IN THESE AREAS.",
      "",
      "These reference files contain VERIFIED, project-specific facts (data-model",
      "gotchas, validated patterns, measured benchmarks) that SUPERSEDE your training",
      "data. They are frequently updated. Re-derived answers have repeatedly been wrong",
      "or slower than the documented pattern. Read the relevant file FIRST, and treat",
      "numbers in them as provisional if they are the project's own (not published)",
      "results.",
      "",
    ];
    for (const s of skills) {
      const refs = referenceFiles(s);
      const base = join(SKILLS_ROOT, s, "references");
      if (refs.length) {
        lines.push(`- \`${s}\` -> ${base}/`);
        lines.push(`    ${refs.join(", ")}`);
      } else {
        lines.push(`- \`${s}\` (skill: ${join(SKILLS_ROOT, s)})`);
      }
    }
    parts.push(lines.join("\n"));
  }

  if (!parts.length) process.exit(0);

  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: parts.join("\n\n"),
      },
    }),
  );
  process.exit(0);
}

await main();
