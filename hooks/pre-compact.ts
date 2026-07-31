#!/usr/bin/env bun
/**
 * PreCompact hook: Save state before context compaction.
 *
 * 1. Adds a compaction marker to LEARNINGS.md
 * 2. Detects active workflow from PLAN.md
 * 3. Persists .planning/STATE.md + prints a systemMessage
 *
 * Port of pre-compact.py — behavior-identical, including the odd bits (STATE.md is written only
 * when .planning/ already exists, even though the marker may have gone to a legacy .claude/ file).
 * See: https://github.com/anthropics/claude-code/issues/13919
 */
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pyJson } from "./_gate_common.ts";
import { classifyPlanningLifecycle } from "../workflows/lib/approved-artifact.ts";

// Legacy PLAN-prose fallback only. Shared-v1 writing/workshop route from ACTIVE_WORKFLOW.md.
const WORKFLOW_PATTERNS: Array<[string, string[]]> = [
  ["dev", [String.raw`## Dev Workflow`, String.raw`/dev\b`, String.raw`TDD`, String.raw`RED-GREEN-REFACTOR`]],
  ["ds", [String.raw`## DS Workflow`, String.raw`/ds\b`, String.raw`data science`, String.raw`EDA`]],
  ["writing", [String.raw`## Writing`, String.raw`/writing\b`, String.raw`draft`, String.raw`revision`]],
];

type ActiveWorkflow = { workflow: string; lifecycle: string | null; phase: string | null };

function cwd(): string {
  return process.cwd();
}

function isFile(p: string): boolean {
  // Python's Path.exists() is true for directories too; keep the same loose semantics.
  return existsSync(p);
}

function findLearningsFile(): string | null {
  const planningPath = join(cwd(), ".planning", "LEARNINGS.md");
  if (isFile(planningPath)) return planningPath;
  const legacyPath = join(cwd(), ".claude", "LEARNINGS.md");
  return isFile(legacyPath) ? legacyPath : null;
}

function findPlanFile(): string | null {
  const planningPath = join(cwd(), ".planning", "PLAN.md");
  if (isFile(planningPath)) return planningPath;
  const legacyPath = join(cwd(), ".claude", "PLAN.md");
  return isFile(legacyPath) ? legacyPath : null;
}

function findStateFile(): string | null {
  const statePath = join(cwd(), ".planning", "STATE.md");
  return isFile(statePath) ? statePath : null;
}

function activeWorkflowMarker(): ActiveWorkflow | null {
  const marker = join(cwd(), ".planning", "ACTIVE_WORKFLOW.md");
  if (!isFile(marker)) return null;
  try {
    const content = readFileSync(marker, "utf-8");
    const workflow = content.match(/^workflow:\s*([a-z0-9_-]+)\s*$/m)?.[1];
    if (!workflow) return null;
    return {
      workflow,
      lifecycle: content.match(/^lifecycle:\s*([a-z0-9_-]+)\s*$/m)?.[1] ?? null,
      phase: content.match(/^phase:\s*([a-z0-9_-]+)\s*$/m)?.[1] ?? null,
    };
  } catch {
    return null;
  }
}

function sharedResumeCommand(active: ActiveWorkflow | null): string | null {
  if (!active || active.lifecycle !== "shared-v1" || !["writing", "workshop", "workflow-creator"].includes(active.workflow)) return null;
  const phase = active.phase ?? "";
  if (["human-review", "review", "human_review"].includes(phase)) return "reload the shared beat-review skill";
  if (active.workflow === "workflow-creator") {
    if (["diagnose", "diagnosis", "compile", "implement", "implementation", "verify", "verification", "revise", "revision"].includes(phase)) return "invoke /workflow-creator-improve";
    return "invoke /workflow-creator";
  }
  if (["draft", "generate", "implement", "implementation", "verify", "verification", "revise", "revision"].includes(phase)) return `invoke /${active.workflow}-revise`;
  return `invoke /${active.workflow}`;
}

function detectActiveWorkflow(planPath: string): string | null {
  let content: string;
  try {
    content = readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }
  for (const [workflow, patterns] of WORKFLOW_PATTERNS) {
    for (const pattern of patterns) {
      if (new RegExp(pattern, "i").test(content)) return workflow;
    }
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function ymdHhmm(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hhmm(d)}`;
}

function appendCompactionMarker(learningsPath: string, workflow: string | null): boolean {
  const timestamp = hhmm(new Date());
  const workflowNote = workflow ? ` (workflow: /${workflow})` : "";
  const marker = `\n[Compaction at ${timestamp}]${workflowNote} - Context was summarized\n`;
  try {
    appendFileSync(learningsPath, marker, { encoding: "utf-8" });
    return true;
  } catch (e) {
    console.error(`[PreCompact] Failed to update LEARNINGS.md: ${e}`);
    return false;
  }
}

/**
 * Skills listed under a 'Skills Touched'-style section of SPEC.md / PLAN.md.
 *
 * /ds planning evidence discovery reads these skills' references/ while drafting the native plan.
 * That is planning-time only -- nothing re-reads them during implementation, which is how stale
 * domain knowledge slips through. Persisting them here lets SubagentStart re-assert it.
 */
function domainSkillsFromState(workflow: string | null): string[] {
  const skills: string[] = [];
  // The shared classifier selects a receipt-authenticated modern plan or the isolated /dev
  // compatibility path. Blocked residue is never parsed for skill hints.
  const lifecycle = classifyPlanningLifecycle(cwd());
  const names = lifecycle.kind === "canonical" ? [lifecycle.resolved.planFile] : [];
  for (const name of names) {
    const p = join(cwd(), ".planning", name);
    if (!isFile(p)) continue;
    let text: string;
    try {
      text = readFileSync(p, "utf-8");
    } catch {
      continue;
    }
    // lines like:  - `wrds` -- TAQ millisecond data, SAS on the WRDS grid
    const re = /^\s*[-*]\s+`([a-z0-9][a-z0-9:_-]*)`\s*[-—]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const s = m[1];
      if (!skills.includes(s)) skills.push(s);
    }
  }
  return skills;
}

/** Persist workflow state so it survives compaction AND reaches spawned subagents. */
function writeStateFile(workflow: string | null, instructions: string[]): void {
  const planning = join(cwd(), ".planning");
  let isDir = false;
  try {
    isDir = statSync(planning).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return;
  const skills = domainSkillsFromState(workflow);
  const ts = ymdHhmm(new Date());
  const lines: string[] = [
    "# STATE (auto-written by pre-compact.py -- safe to edit by hand)",
    "",
    `_Last updated: ${ts}_`,
    "",
    `## Active workflow: ${workflow ? "/" + workflow : "UNKNOWN"}`,
    "",
    ...instructions.map((i) => `- ${i}`),
    "",
  ];
  if (skills.length) {
    lines.push(
      "## Domain knowledge — READ BEFORE WRITING CODE",
      "",
      "These skills' `references/` and `examples/` hold verified, project-specific",
      "facts that supersede training data. Re-read them at implementation time, not",
      "just at plan time:",
      "",
      ...skills.map((s) => `- \`${s}\` — see \`~/projects/workflows/skills/${s}/references/\``),
      "",
    );
  }
  try {
    writeFileSync(join(planning, "STATE.md"), lines.join("\n"), { encoding: "utf-8" });
  } catch (e) {
    console.error(`[PreCompact] Failed to write STATE.md: ${e}`);
  }
}

async function main(): Promise<void> {
  // Read hook input. Malformed stdin falls back to {} exactly as the Python does — and, as there,
  // the parsed payload is never read again.
  try {
    JSON.parse(await Bun.stdin.text());
  } catch {
    /* hook_input = {} */
  }

  const lifecycle = classifyPlanningLifecycle(cwd());
  if (lifecycle.kind === "blocked") {
    console.log(pyJson({
      systemMessage: "Planning state is blocked; do not read or write visible planning files. Convert the retired state or create a fresh approved generated plan.",
    }));
    process.exit(0);
  }

  const marker = activeWorkflowMarker();
  const planPath = findPlanFile();
  const activeWorkflow = lifecycle.kind === "canonical"
    ? lifecycle.resolved.receipt.workflow
    : (marker?.lifecycle === "shared-v1" || marker?.workflow === "work"
      ? marker.workflow
      : (planPath ? detectActiveWorkflow(planPath) : null));
  const resumeCommand = lifecycle.kind === "canonical" ? null : sharedResumeCommand(marker);

  // Canonical lifecycle state is receipt-selected; only pre-.planning legacy state retains
  // its historical persistence behavior.
  const nativePlanLifecycle = lifecycle.kind === "canonical";
  const learningsPath = nativePlanLifecycle ? null : findLearningsFile();
  if (learningsPath) appendCompactionMarker(learningsPath, activeWorkflow);

  // Build reload instructions
  const reloadInstructions: string[] = [];

  if (activeWorkflow) {
    reloadInstructions.push(
      `IMPORTANT: The /${activeWorkflow} workflow was active before compaction. ` +
        `After compaction completes, ${resumeCommand ?? `invoke /${activeWorkflow}`} to reload the workflow context.`,
    );
  } else {
    reloadInstructions.push(
      "After compaction, check .claude/PLAN.md to determine which workflow " +
        "was in use (/dev, /ds, or /writing) and reload it.",
    );
  }

  // Include .planning/STATE.md if it exists
  if (findStateFile()) {
    reloadInstructions.push("Read .planning/STATE.md for current workflow phase and decisions.");
  }

  // Remind legacy workflows about their ledger; DS reloads PLAN + TaskList + project auto-memory.
  if (nativePlanLifecycle) {
    reloadInstructions.push("Call TaskList for live work and consult project auto-memory for durable technical facts.");
  } else if (learningsPath) {
    const learningsLoc = relative(cwd(), learningsPath);
    reloadInstructions.push(`Read ${learningsLoc} for session context and recent progress.`);
  }

  // PreCompact does NOT support hookSpecificOutput.additionalContext. Legacy workflows persist
  // STATE.md; DS deliberately does not — its copied PLAN + TaskList + project auto-memory suffice.
  if (reloadInstructions.length) {
    if (!nativePlanLifecycle) writeStateFile(activeWorkflow, reloadInstructions);
    console.log(
      pyJson({
        systemMessage:
          nativePlanLifecycle
            ? `${activeWorkflow ? `/${activeWorkflow}` : "Native-plan workflow"} context compacted; ${resumeCommand ?? "resume"} from the receipt-selected generated plan, TaskList, and project auto-memory`
            : "Workflow state saved to .planning/STATE.md" +
              (activeWorkflow ? ` (/${activeWorkflow} active)` : ""),
      }),
    );
  }

  process.exit(0);
}

await main();
