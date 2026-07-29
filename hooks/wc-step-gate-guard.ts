#!/usr/bin/env bun
/**
 * PreToolUse hook: Multi-step gate guard for workflow-creator. (TS port of wc-step-gate-guard.py)
 *
 * Two enforcement layers across ALL three modes:
 *
 * Layer 1 — File-path gates (mode: create only):
 *   INTERVIEW.md  → requires 1-philosophy
 *   DESIGN.md     → requires 2-interview
 *   AUDIT.md      → requires 6-generate
 *   skills/*.md   → requires 5-entry-points
 *   constraints/  → requires 5-entry-points
 *
 * Layer 2 — STATE.md step-chain validation (all modes):
 *   When writing to STATE.md with a new step, the predecessor step must be completed.
 *
 * Layer 3 — Structural review-marker gates (mode: create only):
 *   Advancing to 3-decomposition requires INTERVIEW_REVIEWED.md (status: APPROVED).
 *   Advancing to 4-enforcement   requires DESIGN_REVIEWED.md   (status: APPROVED).
 *
 * PORT NOTES (behavior preserved verbatim, quirks included):
 *   - parse_state's `step:\s*(\S+)` swallows a trailing comma, so `step: X, status: completed`
 *     records the step as "X," and never satisfies a gate. Do NOT "fix" this.
 *   - completed-step detection scans a 200-CHARACTER window after each match start.
 *   - manifest_violations imports a sibling Python module; any failure is swallowed → None (allow).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { deny, readPayload } from "./_gate_common.ts";

const MARKER_GATES: Record<string, Record<string, string>> = {
  create: {
    "3-decomposition": "INTERVIEW_REVIEWED.md",
    "4-enforcement": "DESIGN_REVIEWED.md",
  },
};

const STEP_CHAINS: Record<string, string[]> = {
  create: [
    "1-philosophy",
    "2-interview",
    "3-decomposition",
    "3b-artifact-review",
    "4-enforcement",
    "4b-cross-skill",
    "5-entry-points",
    "6-generate",
    "7-self-audit",
  ],
  audit: ["1-read", "2-score", "3-enforcement", "3b-portability", "4-report"],
  improve: ["1-initial-audit", "1-audit-loop"],
};

function buildPredecessors(chain: string[]): Record<string, string> {
  const preds: Record<string, string> = {};
  chain.forEach((step, i) => {
    if (i > 0) preds[step] = chain[i - 1];
  });
  return preds;
}

/** Python pathlib PurePath.parts for a POSIX path string. */
function pathParts(p: string): string[] {
  const parts: string[] = [];
  if (p.startsWith("/")) parts.push(p.startsWith("//") && !p.startsWith("///") ? "//" : "/");
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    parts.push(seg);
  }
  return parts;
}

/** Python pathlib PurePath.name. */
function pathName(p: string): string {
  const parts = pathParts(p);
  if (!parts.length) return "";
  const last = parts[parts.length - 1];
  if (last === "/" || last === "//") return "";
  return last;
}

/** Python pathlib PurePath.suffix. */
function pathSuffix(p: string): string {
  const name = pathName(p);
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

function findActiveWcState(): string | null {
  const wcDir = join(".planning", "wc");
  if (!existsSync(wcDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(wcDir);
  } catch {
    return null;
  }
  const stateFiles: string[] = [];
  for (const name of entries) {
    const candidate = join(wcDir, name, "STATE.md");
    if (existsSync(candidate)) stateFiles.push(candidate);
  }
  if (!stateFiles.length) return null;
  // Python: max(state_files, key=mtime) — first maximum wins on ties.
  let best = stateFiles[0];
  let bestM = statSync(best).mtimeMs;
  for (const f of stateFiles.slice(1)) {
    const m = statSync(f).mtimeMs;
    if (m > bestM) {
      best = f;
      bestM = m;
    }
  }
  return best;
}

function parseState(statePath: string): { completed: Set<string>; mode: string | null } {
  let content: string;
  try {
    content = readFileSync(statePath, "utf8");
  } catch {
    return { completed: new Set(), mode: null };
  }

  const modeMatch = /mode:\s*(\S+)/.exec(content);
  const mode = modeMatch ? modeMatch[1] : null;

  const completed = new Set<string>();
  const re = /step:\s*(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const step = m[1];
    const rest = content.slice(m.index, m.index + 200);
    if (/status:\s*completed/.test(rest)) completed.add(step);
  }

  return { completed, mode };
}

type Gate = "STATE_CHAIN" | [string, string] | null;

function matchFileToGate(filePath: string, mode: string | null): Gate {
  const parts = pathParts(filePath);
  const name = pathName(filePath);

  if (name === "HANDOFF.md" || name === "SCORES.md") return null;
  if (name === "STATE.md") return "STATE_CHAIN";

  if (parts.includes(".planning") || parts.includes(".claude")) {
    if (parts.includes("wc") && mode === "create") {
      if (name === "INTERVIEW.md")
        return ["1-philosophy", "Step 1 (philosophy) must be completed before writing INTERVIEW.md"];
      if (name === "DESIGN.md")
        return ["2-interview", "Step 2 (interview) must be completed before writing DESIGN.md"];
      if (name === "AUDIT.md")
        return ["6-generate", "Step 6 (generate) must be completed before writing AUDIT.md"];
    }
    return null;
  }

  if (mode === "create") {
    if (parts.includes("skills") && pathSuffix(filePath) === ".md")
      return ["5-entry-points", "Steps 1-5 must be completed before generating skill files"];
    if (parts.includes("constraints"))
      return ["5-entry-points", "Steps 1-5 must be completed before generating constraint files"];
  }

  return null;
}

function markerApproved(stateDir: string, marker: string): boolean {
  try {
    return /status:\s*APPROVED/.test(readFileSync(join(stateDir, marker), "utf8"));
  } catch {
    return false;
  }
}

/**
 * Single-source generation guard (P23). Mirrors the Python: it imports the sibling
 * scripts/wc/wc_file_set module and validates DESIGN.md's Generation Manifest; ANY failure
 * (module missing, parse error) is swallowed and returns null → never blocks on tooling error.
 */
async function manifestViolations(stateDir: string): Promise<string[] | null> {
  const design = join(stateDir, "DESIGN.md");
  try {
    if (!statSync(design).isFile()) return null;
  } catch {
    return null;
  }
  try {
    const modPath = join(import.meta.dir, "..", "scripts", "wc", "wc_file_set.ts");
    const mod: any = await import(modPath);
    const fs = mod.parseDesign(readFileSync(design, "utf8"));
    const viols = (fs.violations as string[]).filter((v) => !v.includes("Generation Manifest"));
    return viols.length ? viols : null;
  } catch {
    return null;
  }
}

async function checkStateChain(
  toolInput: Record<string, unknown>,
  completedSteps: Set<string>,
  mode: string | null,
  stateDir: string,
): Promise<string | null> {
  const content = (toolInput.content as string) ?? "";
  const newString = (toolInput.new_string as string) ?? "";
  const text = content || newString;

  if (!text) return null;

  const stepMatch = /step:\s*(\S+)/.exec(text);
  if (!stepMatch) return null;

  const newStep = stepMatch[1].replace(/,+$/, "");

  const chain = mode !== null ? STEP_CHAINS[mode] : undefined;
  if (!chain) return null;

  const predecessors = buildPredecessors(chain);

  if (!(newStep in predecessors)) return null;

  const predecessor = predecessors[newStep];
  if (!completedSteps.has(predecessor)) {
    return (
      `STEP-CHAIN BLOCKED: Cannot write step '${newStep}' — ` +
      `predecessor '${predecessor}' not completed.\n\n` +
      `Required: STATE.md must show \`step: ${predecessor}, status: completed\` ` +
      `before advancing to ${newStep}.\n\n` +
      `**Remedy:** Complete step ${predecessor} first.`
    );
  }

  const marker = (MARKER_GATES[mode as string] ?? {})[newStep];
  if (marker && !markerApproved(stateDir, marker)) {
    return (
      `REVIEW-GATE BLOCKED: Cannot write step '${newStep}' — ` +
      `the artifact review marker '${marker}' is missing or not APPROVED.\n\n` +
      `Required: \`${marker}\` must exist in ${stateDir} with \`status: APPROVED\` ` +
      `(written by the upstream review gate once the reviewer returns APPROVED).\n\n` +
      `**Remedy:** Run the review gate to convergence and write the marker before advancing.`
    );
  }

  if (newStep === "6-generate") {
    const viols = await manifestViolations(stateDir);
    if (viols) {
      return (
        "MANIFEST BLOCKED: Cannot enter step '6-generate' — DESIGN.md's " +
        "`## Generation Manifest` is present but invalid:\n- " +
        viols.join("\n- ") +
        "\n\n" +
        "**Remedy:** Fix the manifest in DESIGN.md (run " +
        "`uv run python3 scripts/wc/wc_file_set.py --check .planning/wc/{name}/DESIGN.md` " +
        "until clean), then advance."
      );
    }
  }

  return null;
}

let hookInput: Record<string, unknown>;
try {
  hookInput = await readPayload();
} catch {
  process.exit(0);
}

const toolName = String((hookInput as any).tool_name ?? "");
const toolInput = ((hookInput as any).tool_input ?? {}) as Record<string, unknown>;

if (toolName !== "Write" && toolName !== "Edit") process.exit(0);

const filePath = String(toolInput.file_path ?? "");
if (!filePath) process.exit(0);

const statePath = findActiveWcState();
if (!statePath) process.exit(0);

const { completed: completedSteps, mode } = parseState(statePath);
if (!mode) process.exit(0);

const gate = matchFileToGate(filePath, mode);
if (gate === null) process.exit(0);

// Python: state_path.parent
const stateDir = statePath.includes("/") ? statePath.slice(0, statePath.lastIndexOf("/")) : ".";

if (gate === "STATE_CHAIN") {
  const reason = await checkStateChain(toolInput, completedSteps, mode, stateDir);
  if (reason) deny(reason);
  process.exit(0);
}

const [requiredStep, gateDescription] = gate;

if (!completedSteps.has(requiredStep)) {
  deny(
    `GATE BLOCKED: ${gateDescription}\n\n` +
      `Required: STATE.md must show \`step: ${requiredStep}, status: completed\` ` +
      `before this write is allowed.\n\n` +
      `**Remedy:** Complete step ${requiredStep} first and update STATE.md.`,
  );
}

process.exit(0);
