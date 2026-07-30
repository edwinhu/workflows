import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  test("session start recognizes WORK.md and resumes /work", async () => {
    const cwd = fixture({
      ".planning/ACTIVE_WORKFLOW.md": "---\nworkflow: work\nphase: verify\nstate: .planning/WORK.md\n---\n",
      ".planning/WORK.md": "---\nworkflow: work\nstatus: implementing\n---\n",
    });
    const result = await run("session-start.ts", cwd, {
      session_id: "session-work",
      hook_event_name: "SessionStart",
      source: "resume",
    });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    const context = payload.hookSpecificOutput.additionalContext;
    expect(context).toContain("Files: WORK.md, ACTIVE_WORKFLOW.md");
    expect(context).toContain("Active workflow: **work**");
    expect(context).toContain("Resume: `/work`");
  });

  test("pre-compact persists a work reload instruction", async () => {
    const cwd = fixture({
      ".planning/ACTIVE_WORKFLOW.md": "---\nworkflow: work\nphase: implement\nstate: .planning/WORK.md\n---\n",
      ".planning/WORK.md": "---\nworkflow: work\nstatus: implementing\n---\n",
    });
    const result = await run("pre-compact.ts", cwd, {
      session_id: "session-work",
      hook_event_name: "PreCompact",
      trigger: "auto",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).systemMessage).toContain("/work active");
    const state = readFileSync(join(cwd, ".planning/STATE.md"), "utf8");
    expect(state).toContain("## Active workflow: /work");
    expect(state).toContain("invoke /work to reload the workflow context");
  });

  test("DS-only plan persistence rejects work", async () => {
    const result = await run("approved-artifact-persist.ts", ROOT, {
      tool_name: "ExitPlanMode",
      tool_input: { plan: "approved work plan" },
      session_id: "session-work",
    }, ["--workflow", "work"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("requires --workflow ds");
  });
});
