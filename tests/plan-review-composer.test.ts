import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindApprovedGeneratedPlan, issueReviewerAuthorization } from "../workflows/lib/approved-artifact";
import { composePlanReview, finalizeComposedPlanReview } from "../workflows/lib/plan-review-composer";

/** Stand in for `reviewer-verdict-guard`: issue a nonce for the actor a hook payload names. */
function authorize(root: string, agentId = "reviewer-agent", issuedAt = "2026-07-31T10:30:00.000Z"): string {
  const record = issueReviewerAuthorization(root, "dev", { session_id: "review-session", agent_id: agentId }, issuedAt);
  if ("code" in record) throw new Error(record.message);
  return record.nonce;
}

const roots: string[] = [];
const policy = { workflow: "dev", approvalMode: "built-in-native" as const };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plan-review-composer-")); roots.push(root);
  mkdirSync(join(root, ".planning"), { recursive: true });
  const planPath = join(root, ".planning", "generated.md"); writeFileSync(planPath, "# Whole plan\nAll tasks.\n");
  bindApprovedGeneratedPlan(root, "dev", planPath, "approval-session", "2026-07-31T10:00:00.000Z");
  return { root, planPath };
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("plan review composer public contract", () => {
  test("authenticates one whole plan and deterministically composes common then domain checks", async () => {
    const { root } = fixture(); const observed: string[] = [];
    const result = await composePlanReview({ projectDir: root, policy,
      commonChecks: [{ id: "z", run: c => { observed.push(`z:${c.plan}`); return []; } }, { id: "a", run: c => { observed.push(`a:${c.plan}`); return []; } }],
      domainChecks: [{ id: "domain", run: c => { observed.push(`domain:${c.plan}`); return [{ severity: "blocker", code: "TRACE", message: "missing trace" }]; } }],
    });
    expect("code" in result).toBe(false); if ("code" in result) return;
    expect(observed).toEqual(["a:# Whole plan\nAll tasks.\n", "z:# Whole plan\nAll tasks.\n", "domain:# Whole plan\nAll tasks.\n"]);
    expect(result.status).toBe("ISSUES_FOUND"); expect(result.executedCheckIds).toEqual(["a", "z", "domain"]); expect(Object.isFrozen(result)).toBe(true);
  });

  test("fails closed on empty, duplicate, thrown, and malformed checks", async () => {
    const { root } = fixture();
    expect(await composePlanReview({ projectDir: root, policy, commonChecks: [], domainChecks: [{ id: "d", run: () => [] }] })).toEqual(expect.objectContaining({ code: "review-checks" }));
    expect(await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "same", run: () => [] }], domainChecks: [{ id: "same", run: () => [] }] })).toEqual(expect.objectContaining({ code: "review-checks" }));
    expect(await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "c", run: () => { throw new Error("boom"); } }], domainChecks: [{ id: "d", run: () => [] }] })).toEqual(expect.objectContaining({ code: "review-check", message: expect.stringContaining("boom") }));
    expect(await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "c", run: () => [{ severity: "warning" } as never] }], domainChecks: [{ id: "d", run: () => [] }] })).toEqual(expect.objectContaining({ code: "review-finding" }));
  });

  test("re-authenticates before returning composition and fails on plan mutation", async () => {
    const { root, planPath } = fixture();
    const result = await composePlanReview({ projectDir: root, policy,
      commonChecks: [{ id: "mutator", run: () => { writeFileSync(planPath, "changed"); return []; } }],
      domainChecks: [{ id: "domain", run: () => [] }],
    });
    expect(result).toEqual(expect.objectContaining({ code: "stale-receipt" }));
  });

  test("finalizes only the authenticated composition and changes review-owned receipt fields", async () => {
    const { root } = fixture();
    const composition = await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "common", run: () => [] }], domainChecks: [{ id: "domain", run: () => [{ severity: "advisory", message: "optional" }] }] });
    if ("code" in composition) throw new Error(composition.message);
    const receipt = finalizeComposedPlanReview({ projectDir: root, policy, composition, reviewerAuthorizationNonce: authorize(root), reviewedAt: "2026-07-31T11:00:00.000Z" });
    expect("code" in receipt).toBe(false); if ("code" in receipt) return;
    expect(receipt).toEqual({ ...composition.approvalReceipt, status: "APPROVED", reviewer_session_id: "review-session#reviewer-agent", reviewed_at: "2026-07-31T11:00:00.000Z" });
    expect(JSON.parse(readFileSync(join(root, ".planning/.state/review.json"), "utf8"))).toEqual(receipt);
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition, reviewerAuthorizationNonce: "f".repeat(64) })).toEqual(expect.objectContaining({ code: "review-race" }));
  });

  /**
   * THE VACUOUS TEST THIS REPLACES. The original passed a LITERAL reviewer id and asserted success,
   * so the published contract's separation rule was verified only against a string the test itself
   * invented. Measured on the old code: one actor bound PENDING as `sess-ORCH`, finalized APPROVED
   * naming `"totally-made-up-reviewer"`, and `validateGeneratedPlanArtifact` ADMITTED it.
   */
  test("refuses every caller-supplied reviewer identity and every unissued nonce", async () => {
    const { root } = fixture();
    const compose = async () => {
      const composition = await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "common", run: () => [] }], domainChecks: [{ id: "domain", run: () => [] }] });
      if ("code" in composition) throw new Error(composition.message);
      return composition;
    };

    // A bare identity literal in the old parameter's place. It is not a nonce, and there is no
    // longer any parameter it could be routed through.
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: await compose(), reviewerSessionId: "totally-made-up-reviewer", reviewedAt: "2026-07-31T11:00:00.000Z" } as never))
      .toEqual(expect.objectContaining({ code: "reviewer-authorization" }));
    // The same literal in the nonce's place.
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: await compose(), reviewerAuthorizationNonce: "totally-made-up-reviewer", reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ code: "reviewer-authorization" }));
    // A well-formed nonce that was never issued.
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: await compose(), reviewerAuthorizationNonce: "a".repeat(64), reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ code: "reviewer-authorization" }));
    // A real issued nonce, guessed wrong by one character.
    const issued = authorize(root);
    const nearMiss = `${issued.slice(0, 63)}${issued.endsWith("a") ? "b" : "a"}`;
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: await compose(), reviewerAuthorizationNonce: nearMiss, reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ code: "reviewer-authorization" }));
    // The issued nonce works exactly once.
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: await compose(), reviewerAuthorizationNonce: issued, reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ reviewer_session_id: "review-session#reviewer-agent" }));
  });

  test("refuses an authorization naming the approving actor, so the separation rule has a real subject", async () => {
    const { root } = fixture();
    const composition = await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "common", run: () => [] }], domainChecks: [{ id: "domain", run: () => [] }] });
    if ("code" in composition) throw new Error(composition.message);
    const record = issueReviewerAuthorization(root, "dev", { session_id: "approval-session" }, "2026-07-31T10:30:00.000Z");
    if ("code" in record) throw new Error(record.message);
    expect(record.actor).toBe("approval-session");
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition, reviewerAuthorizationNonce: record.nonce, reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ code: "session-separation" }));
  });

  test("rejects caller-cloned or verdict-tampered compositions", async () => {
    const { root } = fixture();
    const composition = await composePlanReview({
      projectDir: root,
      policy,
      commonChecks: [{ id: "common", run: () => [] }],
      domainChecks: [{ id: "domain", run: () => [{ severity: "blocker", message: "must fix" }] }],
    });
    if ("code" in composition) throw new Error(composition.message);
    expect(composition.status).toBe("ISSUES_FOUND");
    const tampered = { ...composition, status: "APPROVED" as const };
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: tampered, reviewerAuthorizationNonce: authorize(root), reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ code: "review-composition" }));
  });
});
