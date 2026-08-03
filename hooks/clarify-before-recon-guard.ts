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
 * CLARIFY evidence. The observed record is authoritative; the sentinel survives for two narrow
 * reasons and neither of them is "we might as well keep it".
 *
 * `.planning/.state/episode.json` records `phases.clarified` from a PostToolUse on
 * `AskUserQuestion` — the tool ran, so the user was asked — and a hook writes it where the
 * conversation cannot. The sentinel was the model asserting about ITSELF: `/ds` used to `printf` its
 * own `{"status":"clarified"}`, and the Bash branch below carried a regex permitting exactly that
 * write. Self-certification is not evidence, and for built-in workflows it is now gone.
 *
 * THE SENTINEL IS NOW READ FOR EXTERNAL POLICIES ONLY.
 *   `external-fixed-v1` keeps it because `clarifySentinel` is a REQUIRED field of the published
 *   schemaVersion-1 descriptor (`hooks/lib/workflow-policy.ts:154-157`, exact-key validated), so
 *   third-party workflows are contractually entitled to it and have no other way to satisfy this
 *   guard. Their proof stays self-asserted; that is their contract to change, and schemaVersion 2 —
 *   which drops the field entirely and requires `generated-plan-receipt-v1` — is already the
 *   migration path, so no major version is needed to move off it.
 *
 * THE BUILT-IN COMPATIBILITY READ IS GONE, ONE RELEASE AFTER IT WAS PROMISED. v5.110.0 retired the
 * sentinel and kept reading it so a project mid-CLARIFY across that upgrade was not re-locked;
 * v5.111.0 has since shipped, so the window is spent. Anyone still holding a stale sentinel is asked
 * again — the cost is one `AskUserQuestion`, and keeping a legacy read alive to avoid that is how a
 * temporary path becomes permanent.
 */
function clarified(): never | boolean {
  if (typeof payload.session_id !== "string") return false;
  const episode = join(cwd, ".planning", ".state", "episode.json");
  if (existsSync(episode)) {
    try {
      const value = JSON.parse(readFileSync(episode, "utf8"));
      if (!!value && typeof value === "object" && !Array.isArray(value)
        && !!value.phases && typeof value.phases === "object"
        && typeof value.phases.clarified === "string" && value.phases.clarified !== ""
        && value.sessionId === payload.session_id) return true;
    } catch {
      // AN UNREADABLE EPISODE IS A WEDGE UNLESS IT SAYS SO. Recon is refused because clarification
      // cannot be established, but `episode-phase` deliberately REFUSES to overwrite a file it
      // cannot parse — so asking the user again does not fix it either, and the generic
      // "clarify first" message sends the reader in a direction that cannot work. Naming the file
      // is the difference between a two-second fix and an unexplainable lockout.
      deny(
        `${policy.clarifyReason}\n\nNOTE: ${episode} exists but does not parse, so the clarify phase ` +
        `cannot be read from it — and it is deliberately never overwritten, so asking again will not ` +
        `clear this. Repair or delete that file, then ask.`,
      );
    }
  }
  // Only an external policy may still satisfy this with a self-written sentinel.
  if (policy.approvalMode !== "external-fixed-v1") return false;
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
