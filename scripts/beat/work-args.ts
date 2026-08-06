#!/usr/bin/env bun
/**
 * Emit the AUTHENTICATED half of `workflows/work.js`'s `args`, or refuse and say why.
 *
 * WHY ACTIVATION NEEDS A SCRIPT AND NOT AN INSTRUCTION
 *   `work.js` refuses to start without `planPath` and a 64-hex `planHash`, precisely so it cannot be
 *   used to skip PLAN. But a refusal is only as good as where the caller gets those two values, and
 *   "read them out of review.json" is a step a model performs from memory — which is how a plan that
 *   was never approved gets implemented anyway, with a hash typed from the last thing in context.
 *
 *   So the two authority fields are produced HERE, by `validateApprovedArtifact`, which re-reads the
 *   receipt twice and re-hashes the plan's CURRENT bytes. A plan edited after approval fails with
 *   `stale-receipt` rather than being implemented under a hash that no longer describes it.
 *
 * WHAT IT DELIBERATELY DOES NOT EMIT
 *   `tasks`. The task list lives in TaskList, which is Claude Code's and is not readable from a
 *   script — inventing tasks from the plan's prose here would be exactly the LLM-discovery fallback
 *   every other authority path in this repo refuses. The caller merges them in, and `work.js`
 *   refuses an empty list.
 *
 * Usage: bun scripts/beat/work-args.ts <projectDir> --workflow <name> [--session <id>]
 * Prints one JSON object on stdout, or a diagnostic on stderr and exits non-zero.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateApprovedArtifact } from "../../workflows/lib/approved-artifact.ts";

const argv = Bun.argv.slice(2);
const positional = argv.filter(value => !value.startsWith("--"));
const flag = (name: string): string => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
};

const projectDir = positional[0] ?? "";
const workflow = flag("workflow");
// The actor is only used for the reviewer/approver separation check inside the validator. A caller
// that omits it gets the same refusal a session with no identity would, which is the honest answer.
const session = flag("session") || process.env.CLAUDE_SESSION_ID || "";

function refuse(message: string): never {
  console.error(`[work-args] ${message}`);
  process.exit(2);
}

if (!projectDir) refuse("usage: bun scripts/beat/work-args.ts <projectDir> --workflow <name> [--session <id>]");
if (!workflow) refuse("--workflow is required and selects the domain adapter in workflows/work.js");
if (!session) refuse("--session (or CLAUDE_SESSION_ID) is required: the receipt records who approved, and approver/reviewer separation cannot be checked without the current identity");

/**
 * THE IDENTITY DISAGREEMENT IS DIAGNOSED BEFORE THE VALIDATOR RUNS, BECAUSE THE VALIDATOR CANNOT
 * SAY WHAT WENT WRONG.
 *
 * `validateApprovedArtifact` passes `workflow` down as `expectedWorkflow`, and `parseReviewState`
 * folds that comparison into one boolean with seven others — so a receipt naming a DIFFERENT
 * workflow comes back as `review-schema: combined review state has an invalid strict schema`. That
 * message sends the reader to look for a malformed field, and every field is well-formed.
 *
 * Measured 2026-08-06: a live `/writing` episode whose `review.json` read `"workflow": "work"`. The
 * session spent its remaining turns diagnosing it, hand-wrote a retired `WRITING_CLARIFIED.json`
 * trying to get unstuck, and finally had to ask the user to clear state. The receipt was correct
 * JSON throughout. So this reads the one field first and says the true thing about it.
 */
const receiptPeek = ((): string | null => {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(projectDir, ".planning", ".state", "review.json"), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const named = (raw as Record<string, unknown>).workflow;
    return typeof named === "string" && named.trim() ? named : null;
  } catch { return null; }   // absent/unreadable is the validator's story to tell, not this one's.
})();
if (receiptPeek !== null && receiptPeek !== workflow) {
  refuse(`receipt identity disagreement: you asked for "${workflow}" but .planning/.state/review.json binds "${receiptPeek}". Every implementer gate compares against the receipt, so this episode would be enforced as "${receiptPeek}" whatever you pass here. The receipt is written once at ExitPlanMode and never corrected, so the fix is a fresh approval under the right workflow — not a different argument.`);
}

const artifact = validateApprovedArtifact(projectDir, workflow, session);
// `ArtifactError` is `{ code, message }` — the same discriminant `isError` uses inside the library.
// Testing for a `.error` key instead (the first spelling of this) made EVERY refusal fall through
// to the success path and crash on `approved.receipt.workflow`, so a project with no receipt at all
// got a TypeError instead of "you have not been through PLAN". Caught by running the four cases.
if (artifact && typeof artifact === "object" && "code" in artifact) {
  const failure = artifact as { code: string; message?: string };
  // NAME THE RECEIPT STATE, NOT JUST "no". Every deadlock this repo has debugged was a gate that
  // refused without saying which field was wrong, so the reader could not tell "you skipped PLAN"
  // from "your plan was edited after approval".
  refuse(`no authenticated plan for workflow "${workflow}" in ${projectDir}: ${failure.code}${failure.message ? ` — ${failure.message}` : ""}. Take the plan through native Plan mode and ExitPlanMode; work.js cannot run without a receipt.`);
}

const approved = artifact as { planPath: string; hash: string; receipt: { workflow: string } };
// THE RECEIPT'S OWN WORKFLOW IS ECHOED BACK RATHER THAN THE ARGUMENT. They can disagree —
// measured 2026-08-06, a `/writing` episode whose receipt read `work` — and when they do, the
// receipt is what every downstream gate compares against, so it is what the workflow must run as.
// Emitting the argument here would hide the disagreement behind a value that merely looks right.
const receiptWorkflow = approved.receipt.workflow;
process.stdout.write(`${JSON.stringify({
  projectDir,
  workflow: receiptWorkflow,
  planPath: approved.planPath,
  planHash: approved.hash,
}, null, 2)}\n`);
