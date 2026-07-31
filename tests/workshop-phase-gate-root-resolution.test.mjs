import assert from "node:assert/strict";
import { test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "workshop-phase-gate-guard.ts");
const PLAN = `## Presentation Intent

- Teach the result.

## Audience, Venue, Duration, and Proportions

- Faculty workshop; 30 minutes.

## Source Paper

- Path: /papers/source.pdf

## Source Inventory

- F1 — headline figure

## Slide Spec

| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|---|---|---|---|---|---|---|
| 1. Title | Motivation | The result matters. | setup; stakes | F1 | none | Open clearly. |

## Outputs and Verification

- Produce slides.typ.

## Review Surfaces

- Review the complete plan independently.
`;

function approve(root) {
  const state = join(root, ".planning", ".state");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(root, ".planning", "workshop-native.md"), PLAN);
  writeFileSync(join(state, "review.json"), JSON.stringify({
    workflow: "workshop",
    plan_file: "workshop-native.md",
    plan_hash: createHash("sha256").update(PLAN).digest("hex"),
    approved_session_id: "author",
    approved_at: "2026-01-01T00:00:00.000Z",
    status: "APPROVED",
    reviewer_session_id: "reviewer",
    reviewed_at: "2026-01-01T00:01:00.000Z",
  }));
}

function run(cwd, filePath) {
  return spawnSync("bun", [HOOK], {
    cwd,
    input: JSON.stringify({ tool_name: "Write", cwd, tool_input: { file_path: filePath, content: "= Deck\n" } }),
    encoding: "utf8",
  });
}

function allowed(result, message) {
  assert.equal(result.status, 0, `${message}: ${result.stderr}`);
  assert.equal(result.stdout, "", message);
}

function denied(result, message) {
  assert.equal(result.status, 0, `${message}: ${result.stderr}`);
  assert.match(result.stdout, /"permissionDecision": "deny"/, message);
}

test("workshop phase gate resolves protected deck files to their nearest planning root", () => {
  const root = mkdtempSync(join(tmpdir(), "workshop-phase-root-"));
  try {
    approve(root);
    mkdirSync(join(root, "deck"));
    mkdirSync(join(root, "presentation"));

    allowed(run(root, "deck/notes.typ"), "relative nested notes resolve to the project receipt");
    allowed(run(root, join(root, "deck", "slides.typ")), "absolute nested slides resolve to the project receipt");
    allowed(run(root, join(root, "presentation", "slides.typ")), "presentation slides retain project-root resolution");

    mkdirSync(join(root, "deck", ".planning"));
    denied(run(root, "deck/notes.typ"), "the nearest planning ancestor wins over an approved parent receipt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
