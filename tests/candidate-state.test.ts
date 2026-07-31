import { describe, expect, test } from "bun:test";
import { createCandidateState, markCandidateMutation, markChecksPassed, recaptureCandidate } from "../workflows/lib/candidate-state";

describe("candidate supersession", () => {
  test("declared or observed target edits require recapture and fresh affected checks", () => {
    const initial = createCandidateState("a".repeat(64), ["privacy", "tests"]);
    expect(initial.status).toBe("eligible");
    const superseded = markCandidateMutation(initial, {
      declaredTargets: ["workflows/lib/a.ts"], observedTargets: [], affectedChecks: ["tests"],
    });
    expect(superseded.status).toBe("superseded");
    expect(superseded.releaseEligible).toBe(false);
    expect(superseded.checks.tests).toBe("invalidated");
    expect(superseded.checks.privacy).toBe("passed");

    const recaptured = recaptureCandidate(superseded, "b".repeat(64));
    expect(recaptured.status).toBe("recaptured-awaiting-checks");
    expect(markChecksPassed(recaptured, ["privacy"]).releaseEligible).toBe(false);
    const eligible = markChecksPassed(recaptured, ["tests"]);
    expect(eligible.status).toBe("eligible");
    expect(eligible.releaseEligible).toBe(true);
  });

  test("observed target edits supersede even when no target was declared", () => {
    const initial = createCandidateState("c".repeat(64), ["tests"]);
    const changed = markCandidateMutation(initial, { declaredTargets: [], observedTargets: ["tests/a.test.ts"], affectedChecks: ["tests"] });
    expect(changed.status).toBe("superseded");
  });

  test("target edits cannot bypass the fresh-check requirement", () => {
    const initial = createCandidateState("d".repeat(64), ["tests"]);
    expect(() => markCandidateMutation(initial, {
      declaredTargets: ["workflows/lib/a.ts"], observedTargets: [], affectedChecks: [],
    })).toThrow(/affected checks/i);
  });
});
