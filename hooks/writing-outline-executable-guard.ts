#!/usr/bin/env bun
/**
 * PreToolUse/CLI guard for the canonical writing PLAN grammar.
 *
 * The shared Python parser authenticates exact receipt-selected generated-plan bytes and compiles the
 * same section index consumed by draft and review workflows. There is no second
 * outline approval artifact and no legacy or LLM parser fallback.
 */
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { deny, denyOnCrash, parsePayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("WRITING OUTLINE EXECUTABLE GUARD");

const SCRIPTS_DIR = `${import.meta.dir.replace(/\/[^/]*$/, "")}/scripts/writing`;
const VALIDATE_SNIPPET = [
  "import json, sys",
  "from pathlib import Path",
  "sys.path.insert(0, sys.argv[1])",
  'mod = __import__("writing_section_index", fromlist=["build_index"])',
  "res = mod.build_index(Path(sys.argv[2]))",
  'print("\\x00PARITY\\x00" + json.dumps(res.to_dict()))',
].join("\n");

type Validation = {
  ok: boolean;
  planPath: string;
  planHash: string;
  reviewStatus: string;
  layout: string;
  conversionRequired: boolean;
  violations: string[];
  sections: Array<{ name: string; outlineFile: string; granular: boolean; granularityNote: string }>;
};

function validate(project: string): Validation {
  const result = Bun.spawnSync([
    "python3",
    "-c",
    VALIDATE_SNIPPET,
    SCRIPTS_DIR,
    project,
  ]);
  const stdout = new TextDecoder().decode(result.stdout);
  const marker = stdout.lastIndexOf("\x00PARITY\x00");
  if (result.exitCode !== 0 || marker < 0) {
    process.stderr.write(new TextDecoder().decode(result.stderr));
    process.exit(result.exitCode === 0 ? 1 : result.exitCode);
  }
  return JSON.parse(stdout.slice(marker + "\x00PARITY\x00".length).split("\n")[0]);
}

function rootForTarget(filePath: string, cwd: string): string {
  const absolute = isAbsolute(filePath) ? normalize(filePath) : resolve(cwd, filePath);
  const planningMarker = `${join(".planning", "")}`;
  const planningIndex = absolute.lastIndexOf(planningMarker);
  if (planningIndex >= 0) return absolute.slice(0, planningIndex).replace(/[\\/]$/, "");
  const outlinesMarker = `${join("outlines", "")}`;
  const outlinesIndex = absolute.lastIndexOf(outlinesMarker);
  if (outlinesIndex >= 0) return absolute.slice(0, outlinesIndex).replace(/[\\/]$/, "");
  return dirname(absolute);
}

function failureMessage(result: Validation): string {
  if (result.conversionRequired || result.layout === "legacy-only") {
    return (
      "GATE BLOCKED: legacy writing planning files are conversion input only. Preserve them, " +
      "create a fresh native generated plan under `.planning/`, bind its exact path in hidden review state, and obtain independent whole-plan review."
    );
  }
  return (
    "GATE BLOCKED: the authenticated writing PLAN is not executable.\n\n" +
    `Problems from scripts/writing/writing_section_index.py:\n- ${result.violations.join("\n- ")}\n\n` +
    "Fix the proposed structure through replacement native Plan mode. Do not create or patch " +
    "`.planning/OUTLINE.md` or `OUTLINE_REVIEWED.md`, and do not fall back to LLM discovery."
  );
}

const argv = process.argv.slice(2);
if (argv.length && argv[0] !== "-") {
  const result = validate(argv[0]);
  if (!result.ok) {
    console.log(failureMessage(result));
    process.exit(1);
  }
  console.log(
    `Writing PLAN executable: ${result.sections.length} sections, hash ${result.planHash}.`,
  );
  process.exit(0);
}

let payload: Record<string, unknown>;
try {
  payload = parsePayload(await Bun.stdin.text());
} catch {
  deny("GATE BLOCKED: malformed hook payload cannot authorize writing outline mutation.");
}
const toolName = String(payload.tool_name ?? "");
if (!["Write", "Edit", "MultiEdit"].includes(toolName)) process.exit(0);
const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
const filePath = String(toolInput.file_path ?? "");
if (!filePath) process.exit(0);

if (/(^|[\\/])\.planning[\\/](?:OUTLINE|OUTLINE_REVIEWED)\.md$/.test(normalize(filePath))) {
  deny(
    "GATE BLOCKED: `.planning/OUTLINE.md` and `OUTLINE_REVIEWED.md` are retired. The authenticated " +
      "PLAN's Document Structure, Claim → Section Map, Section Outputs, and independent whole-plan " +
      "review are the only canonical structure authority.",
  );
}

if (!/(^|[\\/])outlines[\\/].+\.md$/.test(normalize(filePath))) process.exit(0);
const root = rootForTarget(filePath, String(payload.cwd ?? process.cwd()));
const result = validate(root);
if (!result.ok) deny(failureMessage(result));
if (result.reviewStatus !== "APPROVED") {
  deny(`GATE BLOCKED: the receipt-selected writing plan is ${result.reviewStatus || "unreviewed"}; domain outline mutation requires APPROVED independent whole-plan review.`);
}
const target = resolve(root, filePath);
const selected = result.sections.some((section) => resolve(section.outlineFile) === target);
if (!selected) {
  deny("GATE BLOCKED: outline mutation must target an exact Outline path from the authenticated plan's Section Outputs table.");
}
try {
  if (lstatSync(target).isSymbolicLink()) deny("GATE BLOCKED: authenticated outline outputs cannot be symlink mutation targets.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") deny("GATE BLOCKED: cannot validate the authenticated outline target.");
}
process.exit(0);
