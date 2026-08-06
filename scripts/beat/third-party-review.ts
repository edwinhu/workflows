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
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { validateGeneratedPlanArtifact } from "../../workflows/lib/approved-artifact.ts";
import { resolveAdapter, adapterNames } from "./adapters/registry.ts";
import { briefSources, resolveSkillBriefs } from "./skill-brief.ts";
// Imported for LOCAL use (a re-export alone creates no local binding) and re-exported below.
import { DEFAULT_SCOPE, SEVERITIES, type AdapterResult, type Invoke, type NeutralFinding, type ReviewScope, type ReviewStatus, type SkillBrief, type SkillBriefSource } from "./contract.ts";

// The contract itself lives in `contract.ts`, a LEAF module, so that an adapter needing
// `DEFAULT_SCOPE` as a value does not have to import THIS file and close the cycle
// prose -> third-party-review -> registry -> prose. Re-exported here because this module is the
// public surface every existing caller and test imports from; see contract.ts for the measurement.
export {
  DEFAULT_SCOPE,
  SEVERITIES,
  type Adapter,
  type AdapterResult,
  type Invoke,
  type NeutralFinding,
  type ReviewScope,
  type ReviewStatus,
  type SkillBrief,
  type SkillBriefSource,
} from "./contract.ts";

/** This plugin's root, from which a caller's skill bundle is resolved. */
const PLUGIN_ROOT = resolve(import.meta.dir, "..", "..");

/** One adapter's outcome. Findings are attributed, because the value is in where adapters DISAGREE. */
export type AdapterReview = {
  adapter: string;
  status: Exclude<ReviewStatus, "skipped">;
  verdict: string | null;
  summary: string | null;
  findings: NeutralFinding[];
  reason: string | null;
  raw: string | null;
  /**
   * The provider stdout transcript on a FAILURE path, where `raw` is the assistant text instead.
   * Null when the adapter did not supply one (every code adapter, and the success path, where
   * `raw` already IS the transcript).
   */
  transcript: string | null;
  spanIds: string[];
  /** What this adapter cost and how hard it worked. Null fields mean the provider reported none. */
  usage: { totalCostUsd: number | null; durationMs: number | null; numTurns: number | null };
  /**
   * The rules this adapter was handed to give the reviewer, hashed. Empty means none — either the
   * caller supplied no bundle, or this adapter does not consume one. Present on every path, failures
   * included, so the bundle never becomes unknowable precisely where the run went wrong.
   */
  briefSources: SkillBriefSource[];
  /**
   * Whether the provider call actually carried them. Read this BEFORE concluding from `briefSources`
   * that a reviewer applied anything: an adapter that refused the scope, could not read the document,
   * or threw before invoking reports the list with `briefsDelivered: false`.
   */
  briefsDelivered: boolean;
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
      spanIds: Array.isArray(item.spanIds)
        ? item.spanIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
        : [],
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
  /**
   * The DOMAIN'S RULES, named by skill: `["ai-anti-patterns", "de-ai-revise"]`, or a skill-relative
   * path for one reference file. Caller-supplied, exactly like `scope`, and for the same reason —
   * `preflight.ts` accepts only `planFile`/`planHash` in `planReset`, and *which rules* is a property
   * of the domain calling the beat rather than of the approval. The OPT-IN stays plan-carried and
   * planHash-bound; only the rule set is caller-side.
   *
   * Omitting it is not an error: the reviewer then gets the generic second-opinion prompt.
   */
  skills?: unknown;
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

  // RESOLVED BEFORE ANY ADAPTER RUNS, for the same reason the adapter names are: a typo in a bundle
  // name must not be discovered only after a paid call has been made. Every failure in here throws.
  const briefs: SkillBrief[] = resolveSkillBriefs(PLUGIN_ROOT, request.skills);
  const resolvedSources = briefSources(briefs);

  const invoke = request.invoke ?? shellInvoke;
  const reviews: AdapterReview[] = [];
  for (const adapter of adapters) {
    let result: AdapterResult;
    try {
      result = adapter.review({ projectDir: project, invoke, scope, briefs });
    } catch (error) {
      // DEGRADE, NEVER BLOCK, AND NEVER ABANDON THE REST. The verifier already passed; this step can
      // only add. One adapter throwing must not turn a passing IMPLEMENT into a failing one, and it
      // must not suppress the other adapter's findings either — most findings in practice come from
      // exactly one of the two.
      reviews.push({
        adapter: adapter.name, status: "unavailable", verdict: null, summary: null,
        findings: [], reason: error instanceof Error ? error.message : String(error), raw: null,
        transcript: null, spanIds: [], usage: { totalCostUsd: null, durationMs: null, numTurns: null },
        // An adapter that THREW returned no receipt of its own, but the beat still knows what it was
        // about to hand over. Reporting the resolution keeps the failure path from being the one
        // place the bundle becomes unknowable — and `briefsDelivered: false` keeps that from being
        // mistaken for evidence that a reviewer saw any of it.
        briefSources: resolvedSources,
        briefsDelivered: false,
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
      transcript: typeof result.transcript === "string" && result.transcript !== "" ? result.transcript : null,
      spanIds: Array.isArray(result.spanIds)
        ? result.spanIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
        : [],
      usage: {
        totalCostUsd: typeof result.usage?.totalCostUsd === "number" ? result.usage.totalCostUsd : null,
        durationMs: typeof result.usage?.durationMs === "number" ? result.usage.durationMs : null,
        numTurns: typeof result.usage?.numTurns === "number" ? result.usage.numTurns : null,
      },
      // The ADAPTER'S OWN answer wins, because it is the only party that knows what it actually
      // delivered — an adapter that ignores briefs reports `[]`, and overwriting that with the
      // beat's resolution would manufacture a receipt for rules no reviewer ever saw.
      briefSources: Array.isArray(result.briefSources) ? result.briefSources : [],
      // Delivery is likewise the ADAPTER'S claim, defaulting to false: an adapter that says nothing
      // about it has not delivered anything a caller may rely on.
      briefsDelivered: result.briefsDelivered === true,
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

/**
 * THE CLI, which every caller has been documented to use and which did not exist.
 *
 * `beat-implement`, `ds-accept` and `workflows/writing-verify.js` all instruct an agent to run
 *
 *     echo '{...}' | bun scripts/beat/third-party-review.ts
 *
 * and until now that piped JSON into a module with no entrypoint: it defined some exports, wrote
 * nothing, and exited 0. A caller reading the empty stdout had no `status` to branch on, so the one
 * failure this whole file is built to prevent — an integration that produces nothing while looking
 * like it ran — was reachable from the shipped instructions.
 *
 * Guarded on `import.meta.main` so importing this module from a test or an adapter still does
 * nothing. Contract errors exit non-zero on stderr; review outcomes, including a provider being
 * down, exit 0 with the JSON, because the step is advisory by construction.
 */
if (import.meta.main) {
  let payload: any;
  try {
    // `readFileSync(0)` rather than a runtime-specific stdin API, so this behaves the same under any
    // interpreter that can execute the file.
    const input = readFileSync(0, "utf8");
    if (!input.trim()) throw new Error("no request JSON was piped in");
    payload = JSON.parse(input);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("request JSON is not an object");
  } catch (error) {
    process.stderr.write(`third-party-review could not read its request: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  try {
    const result = runThirdPartyReview({
      projectDir: payload.projectDir,
      workflow: payload.workflow,
      planReset: payload.planReset ?? {},
      scope: payload.scope,
      skills: payload.skills,
      dispatchSession: payload.dispatchSession,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
