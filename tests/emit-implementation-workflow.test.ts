// The generator's contract: what it emits must actually RUN under the Workflow runtime's rules.
//
// This is the test the original beat-implement.js never had. That script was checked by suites that
// loaded it as an ES module in Node, where `import()` exists — so it stayed green for months while
// being unable to execute in production even once. Here the emitted source is driven through a shim
// with `process`, `Buffer` and `require` shadowed to undefined, and asserted to dispatch real
// agents in dependency order. A generator whose output only type-checks is the same trap.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitImplementationWorkflow, renderWorkflow, resolveWorkflowDir } from "../scripts/beat/emit-implementation-workflow.ts";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const request = (projectDir: string) => ({
  projectDir, planFile: ".planning/p.md", planHash: "a".repeat(64), domain: "ds",
  phases: ["Implement"],
  tasks: [
    { id: "t1", name: "First", prompt: "Do the first thing." },
    { id: "t2", name: "Second", prompt: "Do the second thing.", dependsOn: ["t1"] },
  ],
});
const project = () => mkdtempSync(join(tmpdir(), "emit-workflow-"));

/** Runs the emitted script the way the runtime would: no import, no process, no Buffer. */
async function run(source: string, onAgent: (label: string) => unknown) {
  const labels: string[] = [];
  const fn = new AsyncFunction("agent", "parallel", "pipeline", "log", "phase", "args", "budget",
    "process", "Buffer", "require", source.replace(/^export const meta/m, "const meta"));
  const result = await fn(
    async (_prompt: string, options: { label: string }) => { labels.push(options.label); return onAgent(options.label); },
    async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map(thunk => thunk())),
    async () => {}, () => {}, () => {}, {}, {}, undefined, undefined, undefined);
  return { labels, result: result as Record<string, unknown> };
}

describe("generated implementation workflow", () => {
  test("lands in the project's official reviewable location", () => {
    const dir = project();
    const { path } = emitImplementationWorkflow(request(dir));
    expect(path.endsWith("/.claude/workflows/ds-implement.js")).toBe(true);
  });

  test("is pure control flow — the constraint that killed the hand-written runner", () => {
    const source = renderWorkflow(request("/tmp")).replace(/^\s*\/\/.*$/gm, "");
    for (const construct of ["import(", "import.meta", "process.", "Buffer"]) {
      expect(source, `generated script must not contain ${construct}`).not.toContain(construct);
    }
  });

  test("executes and dispatches every task in dependency order", async () => {
    const { source } = emitImplementationWorkflow(request(project()));
    const { labels, result } = await run(source, label => ({ taskId: label, status: "implemented", summary: "ok", changedFiles: [] }));
    expect(labels).toEqual(["t1", "t2"]);
    expect(labels.indexOf("t1")).toBeLessThan(labels.indexOf("t2"));
    expect(result.overallPass).toBe(true);
  });

  test("binds results to the DISPATCHED task, not the id the agent echoes back", async () => {
    const { source } = emitImplementationWorkflow(request(project()));
    // t1's agent claims to be t2. A swapped echo must not rebind one task's result onto another.
    const { result } = await run(source, label => ({ taskId: label === "t1" ? "t2" : label, status: "implemented", summary: "ok", changedFiles: [] }));
    const results = result.results as { taskId: string; status: string }[];
    expect(results.find(r => r.taskId === "t1")?.status).toBe("failed");
    expect(result.overallPass).toBe(false);
  });

  test("declares its own report as non-evidence", async () => {
    const { source } = emitImplementationWorkflow(request(project()));
    const { result } = await run(source, label => ({ taskId: label, status: "implemented", summary: "ok", changedFiles: ["x"] }));
    // A workflow script has no filesystem access, so it cannot observe what an agent wrote. Saying
    // so in the return value stops a caller reading changedFiles as an observation.
    expect(result.reportedOnly).toBe(true);
  });

  test("carries the plan identity it was generated from", () => {
    const source = renderWorkflow(request("/tmp"));
    expect(source).toContain(".planning/p.md");
    expect(source).toContain("a".repeat(64));
  });

  test("refuses to write through a symlinked .claude", () => {
    const dir = project();
    symlinkSync(mkdtempSync(join(tmpdir(), "outside-")), join(dir, ".claude"));
    // Mirrors Claude Code's own refusal for the project save location: following the link would
    // place the generated workflow outside the project it was generated for.
    expect(() => resolveWorkflowDir(dir, "ds-implement")).toThrow(/symlink/);
  });
});
