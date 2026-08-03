#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sentinelPath, workflowFromArg } from "./_workflow_policies.ts";
import { allow, deny, denyOnCrash, readPayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny instead of an
// exit-1, which Claude Code treats as NON-BLOCKING — i.e. a silent allow in a PreToolUse gate.
denyOnCrash("CLARIFY BEFORE RECON GUARD");

const policy = workflowFromArg(Bun.argv.slice(2));
if (!policy) { deny("Clarification guard requires exactly one known --workflow ds|dev|writing|workshop|workflow-creator policy."); }
const payload = await readPayload();
if (policy.approvalMode === "generated-plan-receipt-v1") allow();
const tool = String(payload.tool_name ?? "");
const input = (payload.tool_input as Record<string, unknown>) ?? {};
const cwd = String(payload.cwd ?? process.cwd());
/**
 * TWO SOURCES OF CLARIFY EVIDENCE, AND THE TRUSTWORTHY ONE IS TRIED FIRST.
 *
 * `.planning/.state/episode.json` records `phases.clarified` from a PostToolUse on
 * `AskUserQuestion` — the tool actually ran, so the user was actually asked, and a hook wrote it
 * where the conversation cannot. The sentinel below is the model asserting about itself: `/ds`'s own
 * SKILL.md has it `printf` its own `{"status":"clarified"}`, and the Bash branch further down
 * carries a regex specifically permitting that write. Self-certification is not evidence, so the
 * observed record wins where it exists.
 *
 * THE SENTINEL CANNOT SIMPLY BE RETIRED, AND THIS IS WHY BOTH PATHS REMAIN.
 *   This guard is SKILL-scoped: it fires in every project that runs `/dev` or `/ds`. The phase
 *   recorder is MARKER-gated: it writes nothing in a project without `.claude-workflows.json`.
 *   Delete the sentinel and `clarified()` can never become true in an unmarked project, so `/dev`
 *   and `/ds` are permanently denied all reconnaissance — measured, not theorised. Retiring the
 *   sentinel family therefore needs the recorder to run ungoverned (breaking the invariant that an
 *   unmarked project is untouched) or a different evidence channel entirely. Recorded as task #21.
 */
/**
 * CLARIFY evidence. The observed record is authoritative; the sentinel survives for two narrow
 * reasons and neither of them is "we might as well keep it".
 *
 * `.planning/.state/episode.json` records `phases.clarified` from a PostToolUse on
 * `AskUserQuestion` — the tool ran, so the user was asked — and a hook writes it where the
 * conversation cannot. The sentinel was the model asserting about ITSELF: `/ds` used to `printf` its
 * own `{"status":"clarified"}`, and the Bash branch below carried a regex permitting exactly that
 * write. Self-certification is not evidence, and for built-in workflows it is now gone.
 *
 * THE SENTINEL IS STILL READ IN TWO CASES:
 *   1. `external-fixed-v1` policies. `clarifySentinel` is a REQUIRED field of the published
 *      schemaVersion-1 external descriptor (`hooks/lib/workflow-policy.ts:154-157`, exact-key
 *      validated), so third-party workflows are contractually entitled to it. Removing it is a
 *      breaking change to a public extension surface and needs a major version, not a tidy-up.
 *   2. Built-ins, as a one-release COMPATIBILITY READ. A project mid-CLARIFY when it upgrades has a
 *      sentinel on disk and no episode record; denying it would re-lock reconnaissance for work
 *      already clarified. Nothing WRITES a built-in sentinel any more, so this path drains itself.
 */
function clarified(): boolean {
  if (typeof payload.session_id !== "string") return false;
  const episode = join(cwd, ".planning", ".state", "episode.json");
  if (existsSync(episode)) {
    try {
      const value = JSON.parse(readFileSync(episode, "utf8"));
      if (!!value && typeof value === "object" && !Array.isArray(value)
        && !!value.phases && typeof value.phases === "object"
        && typeof value.phases.clarified === "string" && value.phases.clarified !== ""
        && value.sessionId === payload.session_id) return true;
    } catch { /* an unreadable episode is not a denial; fall through */ }
  }
  const path = sentinelPath(cwd, policy);
  if (!existsSync(path)) return false;
  try { const value = JSON.parse(readFileSync(path, "utf8")); return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 2 && value.status === "clarified" && value.sessionId === payload.session_id; } catch { return false; }
}
function reconPath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const path = value.replaceAll("\\", "/").toLowerCase();
  if (policy.workflow === "ds") return /(^|\/)(data|src|notebooks?|analysis|artifacts?|results?|outputs?|tasks?)(\/|$)/.test(path) || /\.ipynb(?:$|[/?*])/.test(path);
  if (policy.workflow === "writing") return /(^|\/)(drafts?|outlines?|references?|sources?|scratch)(\/|$)|\.(?:md|docx|tex|typ|bib|ris)$/.test(path);
  if (policy.workflow === "workshop") return /(^|\/)(presentation|figures?|slides?|notes?|references?|sources?)(\/|$)|\.(?:pdf|pptx|typ|tex|md)$/.test(path);
  return /(^|\/)(src|test|tests|lib|app|config|scripts?)(\/|$)|\.(?:ts|tsx|js|jsx|py|go|rs|java|json|ya?ml)$/.test(path);
}
const dsPatterns = ["python3 -c", "python -c", "import pandas", "import numpy", "import polars", "pd.read_", "pd.DataFrame", "df.head", "df.describe", "df.info", "df.shape", "df.columns", "df.dtypes", ".read_csv", ".read_parquet", ".read_sql", ".read_excel", "pixi run python"];
if (clarified()) allow();
if (
  tool === "Read" &&
  policy.workflow === "dev" &&
  /(^|\/)\.planning\/(?:PLAN|SPEC|STATE|LEARNINGS|HANDOFF|VALIDATION|REVIEW_STATE|VERIFY_STATE|HUMAN_REVIEW|ACTIVE_WORKFLOW)(?:\.meta\.json|_REVIEWED\.md|\.md)$/.test(
    String(input.file_path).replaceAll("\\", "/"),
  )
) deny(policy.clarifyReason);
if (tool === "Bash") {
  const command = String(input.command ?? "").trim();
  // THE SELF-CERTIFICATION CHANNEL, NOW CLOSED FOR BUILT-INS.
  //
  // This exemption let the conversation write its OWN clarify proof — the one Bash command permitted
  // before clarification, whose whole purpose was to declare that clarification had happened. For a
  // built-in workflow that is now unreachable: nothing writes a sentinel, the phase is recorded by a
  // hook observing the real `AskUserQuestion`, and there is no command that can fake it.
  //
  // `external-fixed-v1` keeps it because `clarifySentinel` is a required field of the published
  // schemaVersion-1 descriptor and those workflows have no other way to satisfy this guard. Their
  // proof remains self-asserted; that is their contract, not ours to break in a minor release.
  if (policy.approvalMode === "external-fixed-v1") {
    const sentinel = policy.clarifySentinel.replaceAll(".", "\\.").replaceAll("/", "\\/");
    const sentinelWrite = new RegExp(`^(?:mkdir -p \\.planning && )?(?:printf|echo) .+ > ${sentinel}$`);
    if (sentinelWrite.test(command)) allow();
  }
  if (policy.workflow === "ds" && dsPatterns.some(pattern => command.includes(pattern))) deny(policy.clarifyReason);
  deny(policy.clarifyReason);
}
if (tool === "Read" && reconPath(input.file_path)) deny(policy.clarifyReason);
if (tool === "Glob" && (reconPath(input.pattern) || reconPath(input.path))) deny(policy.clarifyReason);
if (tool === "Grep" && (reconPath(input.path) || reconPath(input.glob))) deny(policy.clarifyReason);
allow();
