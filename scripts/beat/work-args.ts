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
import { validateApprovedArtifact, validateGeneratedPlanArtifact } from "../../workflows/lib/approved-artifact.ts";

/**
 * The six identities `validateApprovedArtifact` treats as built-in. Restated here rather than
 * imported because the library does not export the set, and getting it wrong is loud: a built-in
 * routed to the external validator loses the descriptor-ambiguity check, and an external routed to
 * the built-in one is refused with `unknown-workflow`.
 */
const BUILT_IN = new Set(["ds", "dev", "work", "writing", "workshop", "workflow-creator"]);

export type SpineArgs = { projectDir: string; workflow: string; planPath: string; planHash: string };

/**
 * A PUBLISHED CAPABILITY IS IMPORTED, SO IT MUST NOT DO ANYTHING ON IMPORT.
 *
 * MEASURED 2026-08-06, scoping the teaching port. `beat-spine-args` was published in v5.144.0 and
 * consumers reach a capability exactly one way — `import(implementationPath)`, which is what
 * `teaching/scripts/native-workflow-adapter.ts:71` does. This file had no `import.meta.main` guard,
 * so importing it RAN it: it read the consumer's argv, found no `--workflow`, and called
 * `process.exit(2)` — terminating the consuming process on import. The capability was unusable by
 * the only mechanism its consumers have, which is the same shape as the closed adapter table and the
 * unpublished spine, one layer further in. `beat-implement-runner` had the guard all along
 * (`preflight.ts:453`); this one simply never got it.
 *
 * So the work is an exported function that THROWS, and the CLI is a thin `import.meta.main` block
 * that catches and exits. Same diagnostics either way.
 */
export function spineArgs(projectDir: string, workflow: string, session: string): SpineArgs {
  const refuse = (message: string): never => { throw new Error(message); };

  if (!projectDir) refuse("usage: bun scripts/beat/work-args.ts <projectDir> --workflow <name> [--session <id>]");
  if (!workflow) refuse("--workflow is required and selects the domain adapter in workflows/work.js");
  // Do not offer CLAUDE_SESSION_ID as an alternative here: Claude Code never sets it as an
  // environment variable, so naming it sends the reader to export something that changes nothing.
  if (!session) refuse("--session is required: the receipt records who approved, and approver/reviewer separation cannot be checked without the current identity. The routers pass it as `--session ${CLAUDE_SESSION_ID}`, which is substituted into SKILL.md content by Claude Code — that is a different mechanism from the environment, and only the substitution works.");

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

  /**
   * AN EXTERNAL WORKFLOW TAKES A DIFFERENT VALIDATOR, AND SENDING IT TO THE WRONG ONE LOOKS LIKE A
   * MISSING RECEIPT.
   *
   * MEASURED 2026-08-06 against a real `teaching` receipt — `workflow: "teaching"`, status APPROVED,
   * hash matching the plan's bytes. `validateApprovedArtifact` refused it with `unknown-workflow —
   * external workflows require an explicit approval policy`, because that function's descriptor
   * parameter is the schema-1 FIXED-artifact policy (planPath/metadataPath/verdictPath) and a
   * schema-2 generated-plan plugin has none. There was nothing wrong with the receipt at all.
   *
   * `validateGeneratedPlanArtifact` is the entry for exactly this case — it is what the teaching
   * plugin's own gate calls (`hooks/native-workflow.ts:155`), through the same published capability.
   * Dispatching on identity is all that was missing.
   */
  const artifact = BUILT_IN.has(workflow)
    ? validateApprovedArtifact(projectDir, workflow, session)
    : validateGeneratedPlanArtifact(projectDir, workflow, session);
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
  return { projectDir, workflow: approved.receipt.workflow, planPath: approved.planPath, planHash: approved.hash };
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const positional = argv.filter(value => !value.startsWith("--"));
  // A FLAG IS NOT A VALUE. `--session --workflow writing` used to bind session to the literal
  // string "--workflow", which then failed the receipt's approver/reviewer comparison as though a
  // real but unrecognised identity had approved the plan — a typo reported as a policy violation.
  const flag = (name: string): string => {
    const index = argv.indexOf(`--${name}`);
    if (index < 0 || index + 1 >= argv.length) return "";
    const value = argv[index + 1];
    return value.startsWith("--") ? "" : value;
  };
  try {
    /**
     * `--session` IS REQUIRED, AND THERE IS NO `process.env.CLAUDE_SESSION_ID` FALLBACK.
     *
     * Claude Code does not set that variable — `tests/dead-session-variable.test.mjs` exists because
     * reading it always yields `undefined`, so every comparison against it denies silently. This CLI
     * had the read anyway, which the suite reported and `bun` swallowed (the assertion surfaces as an
     * "unhandled error between tests", so the run still exits 0).
     *
     * Nothing is lost by removing it. `${CLAUDE_SESSION_ID}` is substituted into SKILL.md *content*,
     * which is a different mechanism and does work; all six routers already pass `--session` that
     * way. The fallback only ever fired for a hand-run command, where the right answer is the
     * refusal below rather than an empty identity that reads as "no approver recorded".
     */
    const result = spineArgs(positional[0] ?? "", flag("workflow"), flag("session"));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(`[work-args] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
