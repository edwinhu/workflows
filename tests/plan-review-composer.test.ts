import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindApprovedGeneratedPlan } from "../workflows/lib/approved-artifact";
import { composePlanReview, finalizeComposedPlanReview } from "../workflows/lib/plan-review-composer";

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
    const receipt = finalizeComposedPlanReview({ projectDir: root, policy, composition, reviewerSessionId: "review-session", reviewedAt: "2026-07-31T11:00:00.000Z" });
    expect("code" in receipt).toBe(false); if ("code" in receipt) return;
    expect(receipt).toEqual({ ...composition.approvalReceipt, status: "APPROVED", reviewer_session_id: "review-session", reviewed_at: "2026-07-31T11:00:00.000Z" });
    expect(JSON.parse(readFileSync(join(root, ".planning/.state/review.json"), "utf8"))).toEqual(receipt);
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition, reviewerSessionId: "other" })).toEqual(expect.objectContaining({ code: "review-race" }));
  });

  /**
   * PINS THE CAVEAT, NOT A CONTROL. `reviewerSessionId` is whatever the caller passes, and this
   * library writes `review.json` with `fs`, so no hook observes the write and nothing here can
   * check the identity. This test asserts the fabricated reviewer SUCCEEDS — deliberately — so the
   * contract's limit is visible in the suite instead of being rediscovered by the next reviewer.
   *
   * Round 9 replaced the parameter with a hook-issued nonce and called the identity derived. It was
   * reverted: the issuing function took the hook PAYLOAD and `hookActorIdentity` is a pure function
   * of it, so a caller spelled any actor by writing a payload — and the shipping reviewer never
   * called either function. Enforcement is `hooks/implementer-identity-gate.ts`, on the `Write`
   * tool call the dispatched reviewer actually makes (tests/implementer-identity-contract.test.mjs).
   */
  test("reviewerSessionId is asserted by the caller and is not an identity control", async () => {
    const { root } = fixture();
    const composition = await composePlanReview({ projectDir: root, policy, commonChecks: [{ id: "common", run: () => [] }], domainChecks: [{ id: "domain", run: () => [] }] });
    if ("code" in composition) throw new Error(composition.message);
    const receipt = finalizeComposedPlanReview({ projectDir: root, policy, composition, reviewerSessionId: "nobody-reviewed-this", reviewedAt: "2026-07-31T11:00:00.000Z" });
    expect("code" in receipt).toBe(false); if ("code" in receipt) return;
    expect(receipt.reviewer_session_id).toBe("nobody-reviewed-this");
    // The one identity rule this layer CAN enforce: the approver may not name itself the reviewer.
    const second = fixture();
    const composition2 = await composePlanReview({ projectDir: second.root, policy, commonChecks: [{ id: "common", run: () => [] }], domainChecks: [{ id: "domain", run: () => [] }] });
    if ("code" in composition2) throw new Error(composition2.message);
    expect(finalizeComposedPlanReview({ projectDir: second.root, policy, composition: composition2, reviewerSessionId: "approval-session", reviewedAt: "2026-07-31T11:00:00.000Z" }))
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
    expect(finalizeComposedPlanReview({ projectDir: root, policy, composition: tampered, reviewerSessionId: "review-session", reviewedAt: "2026-07-31T11:00:00.000Z" }))
      .toEqual(expect.objectContaining({ code: "review-composition" }));
  });
});
