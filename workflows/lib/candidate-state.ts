export type CandidateStatus = "eligible" | "superseded" | "recaptured-awaiting-checks";
export type CheckStatus = "passed" | "invalidated" | "pending";
export interface CandidateEligibilityState {
  readonly manifestDigest: string;
  readonly status: CandidateStatus;
  readonly releaseEligible: boolean;
  readonly checks: Readonly<Record<string, CheckStatus>>;
  readonly supersededManifestDigests: readonly string[];
}
export interface CandidateMutation {
  readonly declaredTargets: readonly string[];
  readonly observedTargets: readonly string[];
  readonly affectedChecks: readonly string[];
}
const digestPattern = /^[0-9a-f]{64}$/;
function validDigest(digest: string): void { if (!digestPattern.test(digest)) throw new Error("candidate manifest digest must be lowercase SHA-256"); }
function freeze(state: Omit<CandidateEligibilityState, "checks" | "supersededManifestDigests"> & { checks: Record<string, CheckStatus>; supersededManifestDigests: string[] }): Readonly<CandidateEligibilityState> {
  Object.freeze(state.checks); Object.freeze(state.supersededManifestDigests); return Object.freeze(state);
}
function unique(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string" || !value.trim())) throw new Error(`${label} must contain non-empty strings`);
  const result = [...new Set(values)];
  if (result.length !== values.length) throw new Error(`${label} contains duplicates`);
  return result;
}
export function createCandidateState(manifestDigest: string, passedChecks: readonly string[]): Readonly<CandidateEligibilityState> {
  validDigest(manifestDigest);
  const checks = Object.fromEntries(unique(passedChecks, "checks").sort().map(check => [check, "passed" as const]));
  return freeze({ manifestDigest, status: "eligible", releaseEligible: true, checks, supersededManifestDigests: [] });
}

export function validateCandidateMutationConfiguration(state: CandidateEligibilityState, affectedChecks: readonly string[]): void {
  if (!state || typeof state !== "object") throw new Error("candidate state must be an object");
  validDigest(state.manifestDigest);
  if (!(["eligible", "superseded", "recaptured-awaiting-checks"] as const).includes(state.status)) throw new Error("candidate status is invalid");
  if (typeof state.releaseEligible !== "boolean" || !state.checks || typeof state.checks !== "object" || Array.isArray(state.checks)) throw new Error("candidate state has an invalid schema");
  if (!Array.isArray(state.supersededManifestDigests) || state.supersededManifestDigests.some((digest) => typeof digest !== "string" || !digestPattern.test(digest))) throw new Error("candidate supersession history is invalid");
  const affected = unique(affectedChecks, "affected checks");
  if (affected.length === 0) throw new Error("candidate state requires non-empty affected checks");
  for (const [name, status] of Object.entries(state.checks)) {
    if (!name.trim() || !(["passed", "invalidated", "pending"] as const).includes(status)) throw new Error("candidate checks are invalid");
  }
  for (const check of affected) {
    if (!(check in state.checks)) throw new Error(`affected check is unknown: ${check}`);
    if (state.checks[check] !== "passed") throw new Error(`affected check is stale: ${check}`);
  }
}

export function failClosedCandidateState(state: CandidateEligibilityState, affectedChecks: readonly string[]): Readonly<CandidateEligibilityState> {
  const checks: Record<string, CheckStatus> = { ...state.checks };
  for (const check of affectedChecks) checks[check] = "invalidated";
  const history = state.supersededManifestDigests.includes(state.manifestDigest)
    ? [...state.supersededManifestDigests]
    : [...state.supersededManifestDigests, state.manifestDigest];
  return freeze({ manifestDigest: state.manifestDigest, status: "superseded", releaseEligible: false, checks, supersededManifestDigests: history });
}
export function markCandidateMutation(state: CandidateEligibilityState, mutation: CandidateMutation): Readonly<CandidateEligibilityState> {
  const targets = [...unique(mutation.declaredTargets, "declared targets"), ...unique(mutation.observedTargets, "observed targets")];
  if (targets.length === 0) return state;
  const affected = unique(mutation.affectedChecks, "affected checks");
  if (affected.length === 0) throw new Error("target edits require affected checks to be invalidated and rerun");
  const checks: Record<string, CheckStatus> = { ...state.checks };
  for (const check of affected) {
    if (!(check in checks)) throw new Error(`affected check is unknown: ${check}`);
    checks[check] = "invalidated";
  }
  return freeze({ manifestDigest: state.manifestDigest, status: "superseded", releaseEligible: false, checks, supersededManifestDigests: [...state.supersededManifestDigests, state.manifestDigest] });
}
export function recaptureCandidate(state: CandidateEligibilityState, manifestDigest: string): Readonly<CandidateEligibilityState> {
  if (state.status !== "superseded") throw new Error("only a superseded candidate may be recaptured");
  validDigest(manifestDigest);
  if (manifestDigest === state.manifestDigest) throw new Error("recapture must name a new candidate manifest digest");
  const checks = Object.fromEntries(Object.entries(state.checks).map(([name, status]) => [name, status === "invalidated" ? "pending" : status])) as Record<string, CheckStatus>;
  const awaiting = Object.values(checks).some(status => status !== "passed");
  return freeze({ manifestDigest, status: awaiting ? "recaptured-awaiting-checks" : "eligible", releaseEligible: !awaiting, checks, supersededManifestDigests: [...state.supersededManifestDigests] });
}
export function markChecksPassed(state: CandidateEligibilityState, passedChecks: readonly string[]): Readonly<CandidateEligibilityState> {
  if (state.status !== "recaptured-awaiting-checks") throw new Error("checks may only complete after recapture");
  const checks: Record<string, CheckStatus> = { ...state.checks };
  for (const check of unique(passedChecks, "passed checks")) {
    if (!(check in checks)) throw new Error(`check is unknown: ${check}`);
    checks[check] = "passed";
  }
  const awaiting = Object.values(checks).some(status => status !== "passed");
  return freeze({ manifestDigest: state.manifestDigest, status: awaiting ? "recaptured-awaiting-checks" : "eligible", releaseEligible: !awaiting, checks, supersededManifestDigests: [...state.supersededManifestDigests] });
}
