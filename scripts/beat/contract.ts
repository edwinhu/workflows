/**
 * THE ADAPTER CONTRACT — a LEAF module, and that is its whole job.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `third-party-review.ts`
 *   The adapters need `DEFAULT_SCOPE` as a VALUE, not just the types beside it. When that value
 *   lived in `third-party-review.ts` the import graph was a cycle:
 *
 *       prose.ts -> third-party-review.ts -> adapters/registry.ts -> prose.ts
 *
 *   which is fine until something imports an adapter FIRST. Then `registry.ts` evaluates while
 *   `prose.ts` is still initialising and dies on
 *   `ReferenceError: Cannot access 'proseCodexAdapter' before initialization`. Measured against
 *   5.131.0: importing `prose.ts` before `third-party-review.ts` throws at `registry.ts:19`. The
 *   shipped entrypoint happens to import the runner first, so the cycle never bit in production —
 *   which is exactly what makes it a packaging hazard rather than a bug: it is invisible until a
 *   caller, a bundler, or a test picks the other order.
 *
 *   A cycle cannot be removed by reordering imports; it is removed by giving the shared definitions
 *   a module that depends on nothing. Everything here is types plus two frozen constants, so this
 *   file can never acquire an edge back.
 *
 * `third-party-review.ts` re-exports every name below, so existing importers keep working and the
 * public surface is unchanged.
 */

/** The neutral finding. Every adapter maps onto exactly this; nothing downstream sees a raw shape. */
export type NeutralFinding = {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  confidence: number | null;
  recommendation: string | null;
  /**
   * Deterministic prose-audit span ids this finding rests on (`S001`, …), or [] for a code
   * adapter and for a judgement call no span produced. Carried through the neutral shape so a
   * reader can tell which findings are anchored to evidence both reviewers saw and which are one
   * model's opinion — the distinction the whole span-injection design exists to make visible.
   */
  spanIds: string[];
};

/**
 * `reviewed`     the provider ran and its output was understood. `findings: []` here means clean.
 * `unavailable`  the provider could not be reached or threw. `findings: []` means NOTHING WAS LOOKED AT.
 * `unparseable`  the provider ran but its output could not be understood. Raw text is preserved.
 * `skipped`      the approved plan carries no opt-in. The step does not exist for this episode.
 */
export type ReviewStatus = "reviewed" | "unavailable" | "unparseable" | "skipped";

export type AdapterResult = {
  status: Exclude<ReviewStatus, "skipped">;
  verdict?: string | null;
  summary?: string | null;
  /**
   * Provider-shaped findings. Deliberately NOT `NeutralFinding[]` — every adapter hands its raw rows
   * to `normalizeFindings`, so the snake_case/camelCase mapping lives in exactly one place and two
   * adapters cannot drift into two different neutral shapes.
   */
  findings: unknown[];
  /** Why a non-`reviewed` status happened. Required for `unavailable` and `unparseable`. */
  reason?: string | null;
  /** Provider output that could not be parsed, preserved verbatim. */
  raw?: string | null;
  /**
   * The PROVIDER TRANSCRIPT (stdout), as distinct from `raw`, which on a parse failure is the
   * assistant text that failed to parse.
   *
   * These were the same field until a real run made the difference matter. On the `unparseable`
   * path `raw` is the extracted TEXT, so it can never contain a `tool_use` block — and a reader
   * counting tool use in it concludes the reviewer never opened a file, when in truth the field
   * could not have shown one. Auditing what the reviewer DID therefore worked only when the run
   * SUCCEEDED, which is the one case least in need of an audit.
   */
  transcript?: string | null;
  /**
   * Every deterministic prose-audit span id the reviewer says it CONSIDERED, including the ones it
   * judged fine. Distinct from the per-finding ids: those name the evidence a finding rests on,
   * this names the evidence that was read at all — which is the only way to tell a reviewer that
   * weighed the spans and disagreed from one that never looked. Empty for code adapters.
   */
  spanIds?: string[] | null;
  /** The provider's own accounting from its terminal `result` event, when it emits one. */
  usage?: { totalCostUsd?: number | null; durationMs?: number | null; numTurns?: number | null } | null;
};

/** How an adapter shells out. Injectable so tests never make a paid external call. */
export type Invoke = (spec: {
  command: string;
  args: string[];
  cwd: string;
  input?: string;
  timeoutMs?: number;
}) => { code: number; stdout: string; stderr: string };

/**
 * WHAT AN ADAPTER IS ASKED TO REVIEW.
 *
 * `working-tree` — uncommitted changes. The default, because that is the state IMPLEMENT usually
 *   leaves behind and because every already-approved plan was written against it.
 * `branch` — `<base>..HEAD`. Needed because the adapters could ONLY see uncommitted work, so
 *   reviewing a pull request was impossible through the shipped path.
 * `document` — a FILE, not a diff. Prose review has no meaningful diff: a draft is judged whole,
 *   and the reviewer needs the surrounding argument to judge any sentence in it.
 */
export type ReviewScope =
  | { kind: "working-tree" }
  | { kind: "branch"; base: string }
  | { kind: "document"; path: string };

export const DEFAULT_SCOPE: ReviewScope = { kind: "working-tree" };

export type Adapter = {
  name: string;
  review(context: { projectDir: string; invoke: Invoke; scope: ReviewScope }): AdapterResult;
};

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
