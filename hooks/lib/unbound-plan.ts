/**
 * "Does `.planning/` hold a native-plan-shaped file that no receipt ever bound?"
 *
 * WHY THIS SHAPE IS ALWAYS ANOMALOUS
 *   Under the modern flow a generated plan and its receipt are written by the SAME call:
 *   `bindApprovedGeneratedPlan` (`workflows/lib/approved-artifact.ts:761`) accepts the plan and
 *   writes `.planning/.state/review.json` together. A plan-named file with no receipt beside it
 *   cannot come out of that path. The only way to produce it is to hand-write the plan — which is
 *   exactly what happened on 2026-08-03: `ExitPlanMode` was REJECTED, the plan was written into
 *   `.planning/` with the `Write` tool, and `approved-artifact-persist.ts` — which only runs on
 *   `PostToolUse:ExitPlanMode` — never fired. No receipt was ever bound, so every downstream gate
 *   that keys on one was inert. See
 *   `docs/investigations/2026-08-03_workflow-routing-provenance-gap.md`.
 *
 * WHY IT IS ANSWERED FROM THE FILESYSTEM AND NOTHING ELSE
 *   The other two levers considered both need something the incident did not have. The prompt router
 *   needs to RECOGNISE PROSE, which is a heuristic and wrong at both ends. The identity gate needs a
 *   RECEIPT, which is the very thing that is missing. A directory listing needs neither: it is
 *   deterministic, costs one `readdir` at turn end, and records no new per-turn observation.
 *
 * EVERY FAILURE IS `null`, AND THAT DIRECTION IS DELIBERATE.
 *   The one caller is the repo's only blocking Stop hook, where a false positive is not a bad denial
 *   but a session that cannot finish. Absent, symlinked, unreadable, ambiguous — all silent.
 */
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** No receipt at all: nothing in `.planning/` is bound. */
const NOTHING_BOUND = Symbol("nothing-bound");
/** A receipt exists but cannot be read for a plan name: treat everything as bound and stay silent. */
const ANY_PLAN = Symbol("any-plan");

/**
 * Which plan the receipt binds, read SHALLOWLY on purpose.
 *
 * This deliberately does not use `parseReviewState`: the full validator refuses a receipt for
 * reasons — chronology, session separation, reviewer identity — that are about whether the REVIEW is
 * sound, not about which plan was approved. A receipt that is merely stale still tells you which
 * file it is about, and that is the only question here.
 */
function boundPlanFile(receiptPath: string): string | typeof NOTHING_BOUND | typeof ANY_PLAN {
  let raw: string;
  try {
    raw = readFileSync(receiptPath, "utf8");
  } catch {
    // Absent is the common case. Present-but-unreadable (a directory, a permission error, a dangling
    // link) is not distinguished from it here, and must not be: an unreadable receipt takes the
    // silent branch below via the parse failure, never the "nothing is bound" branch.
    try { lstatSync(receiptPath); return ANY_PLAN; } catch { return NOTHING_BOUND; }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return ANY_PLAN; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ANY_PLAN;
  const receipt = parsed as Record<string, unknown>;
  const planFile = receipt.plan_file;
  return typeof planFile === "string" && planFile.trim() !== "" ? planFile : ANY_PLAN;
}

/**
 * A native generated-plan basename: three lowercase words, hyphenated, `.md`.
 *
 * This is the shape Claude Code's own plan naming produces — `compressed-riding-mitten.md` (the
 * incident), `noble-wandering-snowflake.md`, `snoopy-prancing-cookie.md`. It is narrow on purpose.
 * A wider pattern (any `.md`) would sweep in every retired ledger in
 * `RETIRED_MODERN_ARTIFACTS` (`hooks/orchestrator-mutation-guard.ts:18`) and every ad-hoc note a
 * user keeps there, and the cost of a false positive here is a blocked turn.
 */
const NATIVE_PLAN_NAME = /^[a-z]+-[a-z]+-[a-z]+\.md$/;

/**
 * A `.planning/` holding a LEGACY LEDGER is not a modern episode, and must never be judged as one.
 *
 * This repo's own `.planning/` is the case that forces the rule: it carries `SPEC.md`,
 * `HYPOTHESES.md`, `MINI.md`, `STATE.md`, `DEV_CLARIFIED.json` and friends from the pre-receipt era
 * — AND `snoopy-prancing-cookie.md`. Those files are preserved as provenance and are conversion
 * input, never authority (`orchestrator-mutation-guard.ts:16-17`), so a plan name sitting among them
 * says nothing about whether a modern approval was skipped.
 *
 * Detected by leading capital rather than by enumerating `RETIRED_MODERN_ARTIFACTS`, because the
 * ledger family was never closed — `MINI-tasklist-2026-07-29.md`, `REVIEW-slice1-*.md` and the
 * `<X>_CLARIFIED.json` sentinel family are all outside that set — while the shared convention (a
 * SHOUTING basename for a visible ledger, lowercase for everything the modern flow writes) holds
 * across all of them. It errs toward silence, which is the only safe direction here.
 */
function isLegacyLedger(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * The unbound plan's basename, or `null` when there is nothing to say.
 *
 * `null` when: `.planning` is absent, is a symlink, or is not a directory; a receipt binds the only
 * plan-shaped file (or is unreadable); the directory holds a legacy ledger; no entry matches the
 * plan shape; or anything at all throws.
 * A symlinked `.planning` or a symlinked candidate is refused rather than followed, on the same
 * grounds as `hasReceiptSurface` — an alias is the documented route around a filesystem predicate.
 */
export function unboundGeneratedPlan(projectDir: string): string | null {
  const planning = join(projectDir, ".planning");
  try {
    if (!lstatSync(planning).isDirectory()) return null;
  } catch {
    return null;
  }

  // THE RECEIPT ANSWERS FIRST, AND IT ANSWERS ABOUT A NAMED PLAN — NOT ABOUT THE DIRECTORY.
  //
  // Existence alone was the first version, and the codex third-party adapter was right that it is a
  // bypass: a receipt left behind by an EARLIER plan makes a newly hand-written one invisible, which
  // is the same trust-boundary failure this predicate exists to close. So a receipt that parses is
  // read for the plan it actually binds, and only that plan is treated as bound.
  //
  // A receipt that does NOT parse still silences this, and that asymmetry is deliberate rather than
  // an oversight. An unparseable receipt is already `blocked` for `implementer-identity-gate`, which
  // is where it gets reported and where the cost is understood. Refusing a turn on it here would put
  // the repo's ONLY BLOCKING Stop hook into the receipt-parsing failure domain — the exact coupling
  // `episode-state.ts` refuses, on the grounds that a bug in mutable per-turn state must never be
  // able to take approval down with it. The failure mode of getting this wrong is a session that
  // cannot finish, so an unreadable receipt is read as "not my question".
  const bound = boundPlanFile(join(planning, ".state", "review.json"));
  if (bound === ANY_PLAN) return null;

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(planning, { withFileTypes: true });
  } catch {
    return null;
  }

  if (entries.some(entry => isLegacyLedger(entry.name))) return null;

  const plans = entries
    .filter(entry => entry.isFile() && NATIVE_PLAN_NAME.test(entry.name))
    .map(entry => entry.name)
    .filter(name => name !== bound)
    .sort();
  // Sorted, so a directory holding two candidates names the same one every turn — the denial quotes
  // this name and a name that moves between refusals reads as the gate being broken.
  return plans[0] ?? null;
}
