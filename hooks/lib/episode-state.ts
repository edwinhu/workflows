/**
 * `.planning/.state/episode.json` — ALL mutable episode state, in one file.
 *
 * WHY ONE FILE
 *   Audited 2026-08-03: a governed project could carry eight state files across three classes, and
 *   every addition had been justified individually as "+1" against a baseline nobody counted. The
 *   `<X>_CLARIFIED.json` sentinel family alone is six filenames encoding one bit, and
 *   `.planning/.state/writing.json` was a per-workflow file with a single consumer. This is the one
 *   place new mutable episode state goes. See `.claude/CLAUDE.md` -> "State Files".
 *
 * WHY IT IS NOT `review.json`, AND WHY IT NEVER RESTATES APPROVAL
 *   The receipt is immutable approval identity: one sanctioned conversation-level Write behind nine
 *   conditions, and a parse failure there means `blocked`, which costs the user Bash — a state the
 *   source documents as reachable by ORDINARY USE (editing a plan file). Mutable per-turn state must
 *   not share that failure domain, so a bug here can never take approval down with it.
 *
 *   The corollary is an INVARIANT: `review.json.status` is the sole authority for approval status and
 *   this file never restates it. Two files disagreeing about whether a plan is approved is a bug
 *   generator, and whatever rule resolves the disagreement IS the bug. Only what the receipt cannot
 *   know is recorded here.
 *
 * WHY IT IS NOT A FLAT `.planning/.state.json`
 *   The directory-ness of `.state` is load-bearing. `hasReceiptSurface` `lstat`s `.planning/.state`
 *   and treats a symlink or regular file at that path as receipt-shaped, scoring `governed: true`
 *   unconditionally — a regular file there is currently the ANOMALY SIGNAL. Flattening the directory
 *   would collide with the check that decides governance.
 *
 * WHY A HOOK WRITES IT AND THE CONVERSATION CANNOT
 *   A hook is not a tool call. `.planning/.state/` is excluded from every conversation-level write
 *   surface (`implementer-identity-gate.ts:322-345`), so state written here is unforgeable by the
 *   actor it governs. That is the property that makes it worth recording at all — a phase record the
 *   subject can edit is not a record.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite } from "../../workflows/lib/approved-artifact.ts";

/**
 * How many times the Stop gate refuses one debt before standing down permanently.
 *
 * Three, not one and not unbounded. One is the single prompt this replaces — trivially ignored by
 * stopping again. Unbounded is an inescapable session. Three is enough that skipping the review is a
 * deliberate, repeated choice rather than an accident, and small enough that a caller who genuinely
 * cannot discharge the debt is not stuck for long.
 */
export const MAX_REVIEW_BLOCKS = 3;

/**
 * How many times the Stop gate refuses a turn for an UNBOUND PLAN — once, then never again.
 *
 * Stricter than `MAX_REVIEW_BLOCKS` because the two debts are different kinds of thing. A review
 * owed is PROCEDURAL: the machinery knows a step was reached and skipped, and repetition is the
 * enforcement. An unbound plan is INFORMATIONAL: it is inferred from a directory listing, so the
 * gate can be wrong about it in a way it cannot be wrong about `reviewOwed`. Something inferred gets
 * to say its piece once.
 */
export const MAX_PLAN_BINDING_BLOCKS = 1;

export const EPISODE_STATE_RELATIVE = ".planning/.state/episode.json";

export function episodeStatePath(projectDir: string): string {
  return join(projectDir, ".planning", ".state", "episode.json");
}

/**
 * Phases this file owns. `approved` is deliberately absent — that is the receipt's, per the invariant
 * above. Each value is the ISO instant the phase completed.
 */
export type EpisodePhases = {
  clarified?: string;
  implemented?: string;
  reviewed?: string;
};

export type EpisodeExit = { at: string; reason: "completed" | "abandoned" | "superseded" };

export type EpisodeState = {
  schemaVersion: 1;
  /** The workflow this episode belongs to. `work` is the bare primitive and the default. */
  workflow: string;
  /**
   * Plan binding. NULL BEFORE A PLAN EXISTS, which is not an edge case: CLARIFY completes before
   * anything has been planned, so the earliest phase this file records predates any
   * `{planFile, planHash}` to bind to. Pre-plan episodes are bound by `sessionId` alone.
   */
  planFile: string | null;
  planHash: string | null;
  /**
   * The session that started the episode, or NULL when the writer had no session context.
   *
   * Nullable because requiring it was a mistake caught by `tests/writing-canonical-hooks.test.mjs`:
   * the edit-counter hook receives a payload with no `session_id`, so a mandatory field made it
   * silently no-op — a hook that stops working and says nothing, which is precisely the silent-zero
   * failure the rest of this design exists to prevent. Session binding matters to the CLARIFY record
   * (a new session must not inherit another's clarify) and not to an edit count, so it is filled by
   * the first session-bound writer and left null until then.
   */
  sessionId: string | null;
  phases: EpisodePhases;
  /** Set when IMPLEMENT's gate passes; cleared by a recorded review or a recorded exit. */
  reviewOwed: boolean;
  /**
   * How many times the Stop gate has already refused to end a turn for the CURRENT debt.
   *
   * THIS COUNTER IS THE ESCAPE HATCH, AND IT IS WHY THE GATE CAN BLOCK MORE THAN ONCE.
   * The gate previously passed unconditionally whenever `stop_hook_active` was set, which bounded the
   * loop but reduced enforcement to a single prompt — a caller could simply stop on the second
   * attempt. Blocking until the debt is discharged would be real enforcement and an infinite loop
   * with no operator escape, in a hook that fires on every turn end in every project.
   *
   * A bounded count is the middle: refuse `MAX_REVIEW_BLOCKS` times, then stand down permanently for
   * this debt. Enforcement has teeth; the session can always finish.
   *
   * RESET WHEN THE DEBT IS SET, NOT WHEN IT IS CLEARED. A fresh IMPLEMENT deserves fresh refusals; a
   * counter that survived from the previous debt would silently spend this one's budget.
   */
  reviewBlocks: number;
  exit: EpisodeExit | null;
  /** Absorbed from the retired `.planning/.state/writing.json`. */
  editsSinceVerify: number;
};

const PHASE_KEYS = ["clarified", "implemented", "reviewed"] as const;
const EXIT_REASONS = new Set(["completed", "abandoned", "superseded"]);
const KEYS = ["schemaVersion", "workflow", "planFile", "planHash", "sessionId", "phases", "reviewOwed", "reviewBlocks", "exit", "editsSinceVerify"];

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validPhases(value: unknown): value is EpisodePhases {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const phases = value as Record<string, unknown>;
  return Object.keys(phases).every(key => (PHASE_KEYS as readonly string[]).includes(key) && isIso(phases[key]));
}

function validExit(value: unknown): value is EpisodeExit | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const exit = value as Record<string, unknown>;
  return Object.keys(exit).length === 2 && isIso(exit.at) && typeof exit.reason === "string" && EXIT_REASONS.has(exit.reason);
}

/**
 * Strict, like every other state parser here. Unknown keys are rejected rather than ignored: a field
 * this version does not understand means the file was written by something that is not this code,
 * and silently dropping it would let two writers disagree about what the episode is.
 */
export function validEpisodeState(value: unknown): value is EpisodeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const keys = Object.keys(state);
  if (keys.length !== KEYS.length || KEYS.some(key => !Object.hasOwn(state, key))) return false;
  return state.schemaVersion === 1
    && typeof state.workflow === "string" && state.workflow.trim() !== ""
    && (state.planFile === null || (typeof state.planFile === "string" && state.planFile.trim() !== ""))
    && (state.planHash === null || (typeof state.planHash === "string" && /^[0-9a-f]{64}$/.test(state.planHash)))
    && (state.sessionId === null || (typeof state.sessionId === "string" && state.sessionId.trim() !== ""))
    && validPhases(state.phases)
    && typeof state.reviewOwed === "boolean"
    && typeof state.reviewBlocks === "number" && Number.isSafeInteger(state.reviewBlocks) && state.reviewBlocks >= 0
    && validExit(state.exit)
    && typeof state.editsSinceVerify === "number" && Number.isSafeInteger(state.editsSinceVerify) && state.editsSinceVerify >= 0;
}

/**
 * Read the episode state, or `null` if it is absent, unreadable, or malformed.
 *
 * `null` MEANS "DO NOT ACT", NEVER "START FRESH". A caller that treats an unreadable file as an empty
 * episode would overwrite state it could not parse — losing a recorded phase and, worse, discharging
 * a review debt nobody satisfied. Creation is `initEpisodeState`, which is explicit about it.
 */
export function readEpisodeState(projectDir: string): EpisodeState | null {
  const path = episodeStatePath(projectDir);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return validEpisodeState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeEpisodeState(projectDir: string, state: EpisodeState): void {
  const path = episodeStatePath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function initEpisodeState(input: { workflow: string; sessionId?: string | null; planFile?: string | null; planHash?: string | null }): EpisodeState {
  return {
    schemaVersion: 1,
    workflow: input.workflow,
    planFile: input.planFile ?? null,
    planHash: input.planHash ?? null,
    sessionId: input.sessionId ?? null,
    phases: {},
    reviewOwed: false,
    reviewBlocks: 0,
    exit: null,
    editsSinceVerify: 0,
  };
}

/**
 * Is this state the one for the plan the caller is acting under?
 *
 * A state bound to a DIFFERENT plan is not this episode — the plan moved, and reading its phases
 * would let one episode's recorded progress discharge another's obligations. An UNBOUND state
 * (pre-plan) matches any plan, because that is the state CLARIFY leaves behind before a plan exists.
 */
export function matchesPlan(state: EpisodeState, planFile: string, planHash: string): boolean {
  if (state.planFile === null && state.planHash === null) return true;
  return state.planFile === planFile && state.planHash === planHash;
}
