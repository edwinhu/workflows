#!/usr/bin/env bun
/**
 * The optional third-party review step of the IMPLEMENT beat: a genuine second opinion from a model
 * that is not Claude, run AFTER Claude's own independent verifier has passed, and ADVISORY by
 * construction.
 *
 * WHY THIS EXISTS
 *   Every review surface in this repo is Claude reviewing Claude. `beat-implement` dispatches a doer
 *   and then a FRESH verifier — independent in context, identical in model and training. A defect
 *   both instances share is invisible by construction, and no amount of adding more Claude verifiers
 *   changes that. A different model is the only thing that can see it.
 *
 * WHY IT IS ADVISORY, AND WHY THAT IS STRUCTURAL RATHER THAN A SETTING
 *   An external model's claims are unverified by construction: nothing here re-derives them, and the
 *   adapters cannot even tell a confident hallucination from a real finding. Letting those claims
 *   gate a phase would import another model's false positives into our gates. So this runner exits 0
 *   when findings exist — including `critical` ones — and only its OWN contract errors are non-zero.
 *   Nothing in the exit-IMPLEMENT gate consults it. A third-party `approve` is not a gate pass and
 *   is not user approval, for the same reason a peer agent's message is not user approval.
 *
 * WHY THE OPT-IN IS READ FROM THE PLAN AND NOT PASSED IN
 *   `preflight.ts` accepts ONLY `planFile` and `planHash` in `planReset` for a generated-plan
 *   workflow and throws on any extra key. That is deliberate — the plan identity is the whole
 *   authority — so the opt-in cannot ride alongside it. It rides INSIDE it: the choice is elicited in
 *   CLARIFY, written into the plan the user approves, and therefore bound to `planHash` and visible
 *   in review. Approved, not improvised mid-run.
 *
 * WHY THERE IS NO PROVIDER NAME IN THIS FILE
 *   The beat never names a provider. Adapters resolve from a registry keyed by whatever token the
 *   approved plan carries, and `tests/third-party-review.test.mjs` asserts on this file's SOURCE that
 *   no provider literal appears in it. A neutral interface with one implementation is an untested
 *   claim; two implementations, with genuinely different output shapes, is what proves the contract
 *   is not secretly shaped around one of them.
 *
 * WHY THERE IS NO SILENT ZERO
 *   An adapter that failed, timed out, or returned output nobody could parse must be distinguishable
 *   from one that reviewed cleanly. Both would otherwise present as `findings: []` — a broken
 *   integration wearing the costume of a clean review. Hence the `status` field, and hence the rule
 *   that an empty findings list is only ever reported alongside `reviewed` or a non-`reviewed` status
 *   that explains itself.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateGeneratedPlanArtifact } from "../../workflows/lib/approved-artifact.ts";
import { resolveAdapter, adapterNames } from "./adapters/registry.ts";

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
   * to `normalizeFindings` here, so the snake_case/camelCase mapping lives in exactly one place and
   * two adapters cannot drift into two different neutral shapes.
   */
  findings: unknown[];
  /** Why a non-`reviewed` status happened. Required for `unavailable` and `unparseable`. */
  reason?: string | null;
  /** Provider output that could not be parsed, preserved verbatim. */
  raw?: string | null;
};

/** One adapter's outcome. Findings are attributed, because the value is in where adapters DISAGREE. */
export type AdapterReview = {
  adapter: string;
  status: Exclude<ReviewStatus, "skipped">;
  verdict: string | null;
  summary: string | null;
  findings: NeutralFinding[];
  reason: string | null;
  raw: string | null;
};

export type ThirdPartyReviewResult = {
  enabled: boolean;
  /** Every adapter the approved plan asked for, in plan order. Empty when the step is skipped. */
  reviews: AdapterReview[];
  /** WHAT was reviewed. A finding list means nothing without knowing the diff it came from. */
  scope: ReviewScope;
  planFile: string;
  planHash: string;
  /**
   * The WEAKEST claim any adapter supports, so a consumer glancing at one field is never told more
   * than was established. `reviewed` only when EVERY adapter reviewed; otherwise the first
   * non-`reviewed` status. One adapter being down must not present as a clean pass by both.
   */
  status: ReviewStatus;
  /** Always true. Present in the output so a consumer cannot claim it did not know. */
  advisory: true;
  /** Every finding from every adapter, each carrying its `adapter` attribution. */
  findings: (NeutralFinding & { adapter: string })[];
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
 *   reviewing a pull request was impossible through the shipped path: PR #130 had to be reviewed by
 *   hand-injecting a branch diff through the `invoke` seam. It also matters for the ordinary flow —
 *   the third-party step runs after the verifier, when the work may already be committed.
 */
export type ReviewScope = { kind: "working-tree" } | { kind: "branch"; base: string };

export const DEFAULT_SCOPE: ReviewScope = { kind: "working-tree" };

export type Adapter = {
  name: string;
  review(context: { projectDir: string; invoke: Invoke; scope: ReviewScope }): AdapterResult;
};

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/**
 * The opt-in line, as it appears in the approved plan.
 *
 * Matches `Third-party review: <token>` with optional list-marker and bold decoration, which is how
 * the Review Surfaces section of a generated plan actually writes it. The token is captured
 * OPAQUELY — this function does not know which providers exist, and the registry is the only thing
 * that does.
 */
// Captures the whole value after the colon so a LIST can be read; the individual names are split
// and validated below. Anchored to end-of-line so it cannot run on into the next paragraph.
const OPT_IN_LINE = /^[ \t]*(?:[-*+][ \t]*)?(?:\*\*)?third-party review(?:\*\*)?[ \t]*:[ \t]*\**[ \t]*([^\n\r]+)/gim;
const ADAPTER_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
const DISABLED = new Set(["none", "off", "no"]);

export type OptIn = { enabled: false } | { enabled: true; adapters: string[] };

/**
 * DEFAULT OFF IS THE ABSENCE OF THE LINE, NOT A LINE THAT SAYS OFF.
 *
 * A plan written before this feature existed carries no such line and must yield `{enabled:false}`
 * with no provider call — otherwise adding an opt-in step would retroactively change what every
 * already-approved plan authorises. An explicit `none` is accepted too, because the Review Surfaces
 * section is prose a human writes and "none" is what a human writes there.
 *
 * A MALFORMED VALUE THROWS rather than falling back to off. Silently reading an unparseable opt-in
 * as "disabled" is the same silent-zero failure the status field exists to prevent, one layer up:
 * the user asked for a review, no review ran, and nothing said so.
 */
export function readOptIn(planText: unknown): OptIn {
  if (typeof planText !== "string") throw new Error("third-party-review requires the approved plan text as a string");
  const lines: string[][] = [];
  OPT_IN_LINE.lastIndex = 0;
  for (let match = OPT_IN_LINE.exec(planText); match; match = OPT_IN_LINE.exec(planText)) {
    // A LIST ON ONE LINE IS NOT A CONFLICT — it is the request to run several, and both run. Across
    // three review rounds of this feature only ONE finding out of eight was raised by both shipped
    // adapters; the value is in where they DISAGREE, so choosing between them throws most of it away.
    const names = match[1].split(/[,/]|\band\b|\s+/).map(part => part.trim().replace(/\*+$/, "").toLowerCase()).filter(Boolean);
    if (names.length) lines.push(names);
  }
  if (lines.length === 0) return { enabled: false };

  // Two SEPARATE lines are still an ambiguous authority. Picking the first would let a stale line in
  // an earlier section silently win, which is the case this refusal has always been about.
  const rendered = lines.map(names => names.join(","));
  if (new Set(rendered).size > 1) {
    throw new Error(`third-party-review found conflicting opt-in values in the approved plan: ${rendered.join(" | ")}`);
  }

  const names = lines[0];
  if (names.some(name => DISABLED.has(name))) {
    // "none" alongside a provider is not a preference to reconcile — it is a plan that says two
    // things. Refusing beats guessing which half the approver meant.
    if (names.length > 1) throw new Error(`third-party-review opt-in mixes a disabled value with adapters: ${names.join(", ")}`);
    return { enabled: false };
  }
  for (const name of names) {
    if (!ADAPTER_TOKEN.test(name)) throw new Error(`third-party-review opt-in value is not a valid adapter name: ${name}`);
  }
  // Order is preserved and duplicates collapse — a name repeated is one review, not two paid calls.
  return { enabled: true, adapters: [...new Set(names)] };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}
function unit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/**
 * Map whatever a provider returned onto the neutral finding shape.
 *
 * Accepts both `line_start` and `lineStart` because one provider emits a JSON schema with snake_case
 * keys and the other is asked for the neutral camelCase shape directly. A finding with no usable
 * title AND no usable body is DROPPED — not carried as an empty row — because an empty row is
 * indistinguishable from a real finding that failed to serialise, and downstream this becomes a
 * TaskList item a human is asked to act on.
 *
 * An unrecognised severity becomes `medium` rather than being dropped: losing a finding because its
 * severity label was unexpected is strictly worse than mis-ranking it.
 */
export function normalizeFindings(raw: unknown): NeutralFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: NeutralFinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const title = text(item.title);
    const body = text(item.body) ?? text(item.description);
    if (!title && !body) continue;
    const severity = String(item.severity ?? "").toLowerCase();
    out.push({
      severity: (SEVERITIES as readonly string[]).includes(severity) ? (severity as NeutralFinding["severity"]) : "medium",
      title: title ?? (body as string).slice(0, 120),
      body: body ?? (title as string),
      file: text(item.file) ?? text(item.path),
      lineStart: integer(item.line_start) ?? integer(item.lineStart),
      lineEnd: integer(item.line_end) ?? integer(item.lineEnd),
      confidence: unit(item.confidence),
      recommendation: text(item.recommendation),
    });
  }
  return out;
}

/** The default shell. Replaced wholesale in tests; never reached there. */
export const shellInvoke: Invoke = ({ command, args, cwd, input, timeoutMs }) => {
  const run = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    timeout: timeoutMs ?? 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  return { code: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
};

export type RunRequest = {
  projectDir: string;
  workflow: string;
  planReset: { planFile?: unknown; planHash?: unknown };
  /** Injected in tests. Production leaves it undefined and the adapter shells out for real. */
  invoke?: Invoke;
  /**
   * What to review. Defaults to the working tree, so every plan approved before branch scope existed
   * keeps meaning exactly what it meant.
   */
  scope?: ReviewScope;
  /** Overrides the dispatching session identity. Tests set it; production reads the environment. */
  dispatchSession?: string;
};

/**
 * Resolve the AUTHENTICATED plan, read the opt-in from it, and run the named adapter.
 *
 * The hash check is not belt-and-braces on top of `validateGeneratedPlanArtifact` — it is the point.
 * The artifact resolution answers "what plan does the receipt currently select"; the caller's
 * `planReset` answers "what plan did the wave I just implemented run under". If those disagree, the
 * plan moved underneath the episode and the opt-in being read is not the one that was approved for
 * this work. Refuse rather than review under the wrong authority.
 */
export function runThirdPartyReview(request: RunRequest): ThirdPartyReviewResult {
  const project = request.projectDir;
  if (!project) throw new Error("third-party-review requires projectDir");
  if (typeof request.workflow !== "string" || !request.workflow.trim()) {
    throw new Error("third-party-review requires workflow");
  }
  const reset = request.planReset || {};
  const planFile = reset.planFile;
  const planHash = reset.planHash;
  if (typeof planFile !== "string" || !planFile.trim()) throw new Error("third-party-review requires nonempty planReset.planFile");
  if (typeof planHash !== "string" || !planHash.trim()) throw new Error("third-party-review requires nonempty planReset.planHash");

  const session = request.dispatchSession ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof session !== "string" || !session.trim()) {
    throw new Error("third-party-review cannot authenticate its dispatching session: CLAUDE_CODE_SESSION_ID is absent or empty");
  }
  const artifact: any = validateGeneratedPlanArtifact(project, request.workflow, { role: "dispatch", identity: session });
  if (artifact.code) throw new Error(`third-party-review ${artifact.message}`);
  if (artifact.planFile !== planFile || artifact.hash !== planHash) {
    throw new Error("third-party-review rejects planReset that differs from the current receipt-selected generated plan");
  }
  const bytes = readFileSync(artifact.planPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== planHash) {
    throw new Error("third-party-review read plan bytes that do not hash to the approved planHash");
  }

  const scope = request.scope ?? DEFAULT_SCOPE;
  const base = { planFile, planHash, advisory: true as const, scope };
  const optIn = readOptIn(bytes.toString("utf8"));
  if (!optIn.enabled) {
    return { ...base, enabled: false, reviews: [], status: "skipped", findings: [] };
  }

  // An approved plan naming an adapter this repo does not ship is a contract error of THIS runner's
  // input, not a provider failure, so it is the one case that exits non-zero. Reporting it as
  // `unavailable` would let a typo in an approved plan present as a provider that happened to be
  // down — the user would read "review unavailable" and never learn no such review exists. Checked
  // for EVERY named adapter before any of them runs, so a typo in the second name cannot be
  // discovered only after the first has made a paid call.
  const adapters = optIn.adapters.map(name => {
    const resolved = resolveAdapter(name);
    if (!resolved) {
      throw new Error(`third-party-review approved plan names an unknown adapter: ${name} (available: ${adapterNames().join(", ")})`);
    }
    return resolved;
  });

  const invoke = request.invoke ?? shellInvoke;
  const reviews: AdapterReview[] = [];
  for (const adapter of adapters) {
    let result: AdapterResult;
    try {
      result = adapter.review({ projectDir: project, invoke, scope });
    } catch (error) {
      // DEGRADE, NEVER BLOCK, AND NEVER ABANDON THE REST. The verifier already passed; this step can
      // only add. One adapter throwing must not turn a passing IMPLEMENT into a failing one, and it
      // must not suppress the other adapter's findings either — most findings in practice come from
      // exactly one of the two.
      reviews.push({
        adapter: adapter.name, status: "unavailable", verdict: null, summary: null,
        findings: [], reason: error instanceof Error ? error.message : String(error), raw: null,
      });
      continue;
    }
    if (!result || typeof result !== "object" || !["reviewed", "unavailable", "unparseable"].includes(result.status)) {
      throw new Error(`third-party-review adapter ${adapter.name} returned a result outside the adapter contract`);
    }
    reviews.push({
      adapter: adapter.name,
      status: result.status,
      verdict: text(result.verdict),
      summary: text(result.summary),
      findings: result.status === "reviewed" ? normalizeFindings(result.findings) : [],
      reason: text(result.reason),
      raw: typeof result.raw === "string" && result.raw !== "" ? result.raw : null,
    });
  }

  return {
    ...base,
    enabled: true,
    reviews,
    // The weakest claim, never the most flattering one.
    status: reviews.every(review => review.status === "reviewed")
      ? "reviewed"
      : reviews.find(review => review.status !== "reviewed")!.status,
    findings: reviews.flatMap(review => review.findings.map(finding => ({ ...finding, adapter: review.adapter }))),
  };
}
