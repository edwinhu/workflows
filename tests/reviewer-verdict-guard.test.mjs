import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const HOOK = join(REPO, "hooks", "reviewer-verdict-guard.ts");

const verdict = "---\nplan_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nstatus: APPROVED\nreviewer_session_id: reviewer-456\nreviewed_at: 2026-01-01T00:00:00.000Z\n---\n\nreview";

function run(cwd, filePath) {
  return spawnSync("bun", [HOOK, "--workflow", "ds"], {
    cwd,
    env: { ...process.env, CLAUDE_SESSION_ID: "reviewer-456" },
    input: JSON.stringify({ tool_name: "Write", cwd, tool_input: { file_path: filePath, content: verdict } }),
    encoding: "utf8",
  });
}

const cwd = mkdtempSync(join(tmpdir(), "reviewer-guard-"));
const outside = mkdtempSync(join(tmpdir(), "reviewer-guard-outside-"));
try {
  mkdirSync(join(cwd, ".planning"));
  for (const filePath of [
    ".planning/PLAN_REVIEWED.md",
    "./.planning/PLAN_REVIEWED.md",
    join(cwd, ".planning", "PLAN_REVIEWED.md"),
  ]) {
    assert.equal(run(cwd, filePath).status, 0, filePath);
  }

  symlinkSync(join(outside, "missing-verdict.md"), join(cwd, ".planning", "PLAN_REVIEWED.md"));
  assert.match(run(cwd, ".planning/PLAN_REVIEWED.md").stdout, /"permissionDecision": "deny"/, "dangling symlinked verdict leaf must be denied");
  rmSync(join(cwd, ".planning", "PLAN_REVIEWED.md"));
  writeFileSync(join(outside, "verdict.md"), "outside verdict");
  symlinkSync(join(outside, "verdict.md"), join(cwd, ".planning", "PLAN_REVIEWED.md"));
  assert.match(run(cwd, ".planning/PLAN_REVIEWED.md").stdout, /"permissionDecision": "deny"/, "symlinked verdict leaf must be denied");
  rmSync(join(cwd, ".planning", "PLAN_REVIEWED.md"));
  symlinkSync(join(outside, "also-missing-verdict.md"), join(cwd, ".planning", "verdict-link"));
  symlinkSync("verdict-link", join(cwd, ".planning", "PLAN_REVIEWED.md"));
  assert.match(run(cwd, ".planning/PLAN_REVIEWED.md").stdout, /"permissionDecision": "deny"/, "chained dangling verdict symlink must be denied");
  rmSync(join(cwd, ".planning"), { recursive: true });
  symlinkSync(outside, join(cwd, ".planning"));
  assert.match(run(cwd, ".planning/PLAN_REVIEWED.md").stdout, /"permissionDecision": "deny"/, "symlinked verdict parent must be denied");
} finally {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
}

console.log("reviewer-verdict-guard tests passed");
