import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "work-lifecycle-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

async function run(script, cwd, input, args = []) {
  const proc = Bun.spawn(["bun", join(ROOT, "hooks", script), ...args], {
    cwd,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("work lifecycle hooks", () => {
  test("orphan generated plan and obsolete hidden state block lifecycle fallback", async () => {
    const cwd = fixture({
      ".planning/generated-plan.md": "# Orphan generated plan\n",
      ".planning/.state/plan.json": "{\"obsolete\":true}\n",
      ".planning/LEARNINGS.md": "legacy residue\n",
    });
    const start = await run("session-start.ts", cwd, { hook_event_name: "SessionStart" });
    expect(JSON.parse(start.stdout).hookSpecificOutput.additionalContext).toContain("Native planning state is blocked");

    const compact = await run("pre-compact.ts", cwd, { hook_event_name: "PreCompact" });
    expect(JSON.parse(compact.stdout).systemMessage).toContain("Planning state is blocked");
    expect(existsSync(join(cwd, ".planning/STATE.md"))).toBe(false);
    expect(readFileSync(join(cwd, ".planning/LEARNINGS.md"), "utf8")).toBe("legacy residue\n");

    const subagent = await run("subagent-start.ts", cwd, { hook_event_name: "SubagentStart" });
    expect(JSON.parse(subagent.stdout).hookSpecificOutput.additionalContext).toContain("PLANNING STATE BLOCKED");
  });

  test("modern residue without a receipt is blocked instead of resumed", async () => {
    const cwd = fixture({
      ".planning/ACTIVE_WORKFLOW.md": "---\nworkflow: work\nphase: verify\nstate: .planning/WORK.md\n---\n",
      ".planning/WORK.md": "---\nworkflow: work\nstatus: implementing\n---\n",
      ".planning/STATE.md": "old state\n",
    });
    const start = await run("session-start.ts", cwd, { hook_event_name: "SessionStart" });
    expect(start.exitCode).toBe(0);
    const startContext = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
    expect(startContext).toContain("Native planning state is blocked");
    expect(startContext).not.toContain("### Approved native plan");

    const compact = await run("pre-compact.ts", cwd, { hook_event_name: "PreCompact" });
    expect(compact.exitCode).toBe(0);
    expect(JSON.parse(compact.stdout).systemMessage).toContain("Planning state is blocked");
    expect(readFileSync(join(cwd, ".planning/STATE.md"), "utf8")).toBe("old state\n");

    const subagent = await run("subagent-start.ts", cwd, { hook_event_name: "SubagentStart" });
    expect(subagent.exitCode).toBe(0);
    expect(JSON.parse(subagent.stdout).hookSpecificOutput.additionalContext).toContain("PLANNING STATE BLOCKED");
  });

  test("invalid modern receipt never revives legacy compaction state", async () => {
    const cwd = fixture({
      ".planning/.state/review.json": "{}\n",
      ".planning/LEARNINGS.md": "# Legacy learnings\n",
      ".planning/STATE.md": "# Legacy state\n",
      ".planning/PLAN.md": "# Retired plan\n",
    });
    const result = await run("pre-compact.ts", cwd, {
      session_id: "session-invalid-receipt",
      hook_event_name: "PreCompact",
      trigger: "auto",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).systemMessage).toContain("Planning state is blocked");
    expect(readFileSync(join(cwd, ".planning/LEARNINGS.md"), "utf8")).toBe("# Legacy learnings\n");
    expect(readFileSync(join(cwd, ".planning/STATE.md"), "utf8")).toBe("# Legacy state\n");
  });

  test("missing, malformed, and stale receipts block all visible state revival", async () => {
    const cases = [
      { name: "missing", files: { ".planning/PLAN.md": "# Retired plan\n", ".planning/HANDOFF.md": "resume this\n" } },
      { name: "malformed", files: { ".planning/.state/review.json": "{}\n", ".planning/PLAN.md": "# Retired plan\n" } },
      { name: "stale", files: {
        ".planning/generated.md": "# changed bytes\n",
        ".planning/.state/review.json": "{\"workflow\":\"ds\",\"plan_file\":\"generated.md\",\"plan_hash\":\"79214b522b348c81c0164382b6791322138eac7dba122f4f03810cece3bfd1ae\",\"approved_session_id\":\"author\",\"approved_at\":\"2026-01-01T00:00:00.000Z\",\"status\":\"APPROVED\",\"reviewer_session_id\":\"reviewer\",\"reviewed_at\":\"2026-01-01T00:01:00.000Z\"}\n",
        ".planning/STATE.md": "old state\n",
      } },
    ];
    for (const entry of cases) {
      const cwd = fixture(entry.files);
      const start = await run("session-start.ts", cwd, { hook_event_name: "SessionStart" });
      expect(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, entry.name).toContain("Native planning state is blocked");
      const compact = await run("pre-compact.ts", cwd, { hook_event_name: "PreCompact" });
      expect(JSON.parse(compact.stdout).systemMessage, entry.name).toContain("Planning state is blocked");
      const subagent = await run("subagent-start.ts", cwd, { hook_event_name: "SubagentStart" });
      expect(JSON.parse(subagent.stdout).hookSpecificOutput.additionalContext, entry.name).toContain("PLANNING STATE BLOCKED");
    }
  });

  test("valid canonical receipt remains the sole modern lifecycle authority", async () => {
    const cwd = fixture({
      ".planning/generated.md": "# Canonical plan\n",
      ".planning/PLAN.md": "# Retired plan\n",
      ".planning/.state/review.json": "{\"workflow\":\"ds\",\"plan_file\":\"generated.md\",\"plan_hash\":\"79214b522b348c81c0164382b6791322138eac7dba122f4f03810cece3bfd1ae\",\"approved_session_id\":\"author\",\"approved_at\":\"2026-01-01T00:00:00.000Z\",\"status\":\"APPROVED\",\"reviewer_session_id\":\"reviewer\",\"reviewed_at\":\"2026-01-01T00:01:00.000Z\"}\n",
    });
    const result = await run("session-start.ts", cwd, { hook_event_name: "SessionStart" });
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain("Approved generated plan: `.planning/generated.md`");
    expect(context).not.toContain("# Retired plan");
  });

  test("hash-valid fixed legacy pair from a modern workflow is conversion input, not dev", async () => {
    const cwd = fixture({
      ".planning/ACTIVE_WORKFLOW.md": "---\nworkflow: writing\nphase: review\n---\n",
      ".planning/PLAN.md": "## Dev Workflow\n",
      ".planning/PLAN_REVIEWED.md": "---\nplan_hash: f96f5dac41ce72c31f51e899a30cf1dded3677c3084639e492f82ecfb910b664\nstatus: APPROVED\nreviewer_session_id: reviewer\nreviewed_at: 2026-01-01T00:01:00.000Z\n---\n\nApproved\n",
    });
    const start = await run("session-start.ts", cwd, { hook_event_name: "SessionStart" });
    const startContext = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
    expect(startContext).toContain("Native planning state is blocked");
    expect(startContext).not.toContain("### Approved native plan");

    const subagent = await run("subagent-start.ts", cwd, { hook_event_name: "SubagentStart" });
    expect(JSON.parse(subagent.stdout).hookSpecificOutput.additionalContext).toContain("PLANNING STATE BLOCKED");
  });

  test("legacy dev state is conversion-only and never creates visible compaction state", async () => {
    const cwd = fixture({
      ".planning/ACTIVE_WORKFLOW.md": "---\nworkflow: dev\nphase: implement\n---\n",
      ".planning/PLAN.md": "# legacy dev\n",
      ".planning/PLAN_REVIEWED.md": "---\nplan_hash: x\nstatus: APPROVED\nreviewer_session_id: reviewer\nreviewed_at: 2026-01-01T00:01:00.000Z\n---\n",
    });
    const compact = await run("pre-compact.ts", cwd, { hook_event_name: "PreCompact" });
    expect(JSON.parse(compact.stdout).systemMessage).toContain("Planning state is blocked");
    expect(existsSync(join(cwd, ".planning/STATE.md"))).toBe(false);
  });

  test("native persistence refuses unbound raw plan text", async () => {
    const result = await run("approved-artifact-persist.ts", ROOT, {
      tool_name: "ExitPlanMode",
      tool_input: { plan: "approved work plan" },
      session_id: "session-work",
    }, ["--workflow", "work"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("transcript lookup identity is required");
  });
});
