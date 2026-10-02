/**
 * The plugin requires Claude Code >= 2.1.287: its tool-call guards and bulk-guard run only as a mod.
 * plugin.json has no field that declares a minimum Claude Code version, so session-start warns
 * instead — the model through additionalContext, the user through systemMessage.
 *
 * Run: bun test tests/session-start-min-version.test.ts
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVersionSection, MIN_CLAUDE_CODE } from "../hooks/session-start.ts";

const HOOK = join(import.meta.dir, "..", "hooks", "session-start.ts");
const TMP = mkdtempSync(join(tmpdir(), "min-version-test-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("buildVersionSection", () => {
  test("the floor is 2.1.287", () => {
    expect(MIN_CLAUDE_CODE).toBe("2.1.287");
  });

  test("below the floor names the version, the floor and the inactive guards", () => {
    for (const v of ["2.1.286 (Claude Code)", "2.0.999", "1.9.300"]) {
      const out = buildVersionSection(v);
      expect(out).toContain("GUARDS INACTIVE");
      expect(out).toContain(">= 2.1.287");
      expect(out).toContain("bulk-guard");
    }
  });

  test("at or above the floor, or unreadable, says nothing", () => {
    for (const v of ["2.1.287 (Claude Code)", "2.1.300", "2.2.0", "3.0.0", "", "garbage"]) {
      expect(buildVersionSection(v)).toBe("");
    }
  });
});

/** Run the hook with CLAUDE_CODE_EXECPATH pointing at a stub that reports `version`. */
function runHook(version: string): { systemMessage?: string; hookSpecificOutput: { additionalContext: string } } {
  const stub = join(TMP, `claude-${version}`);
  writeFileSync(stub, `#!/bin/sh\necho "${version} (Claude Code)"\n`);
  chmodSync(stub, 0o755);
  const r = Bun.spawnSync(["bun", HOOK], {
    cwd: TMP,
    stdin: new TextEncoder().encode(JSON.stringify({ session_id: "t", hook_event_name: "SessionStart" })),
    env: { ...process.env, CLAUDE_CODE_EXECPATH: stub },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(r.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(r.stdout));
}

describe("session-start hook", () => {
  test("on 2.1.280 it warns the user and leads the model's context with the warning", () => {
    const out = runHook("2.1.280");
    expect(out.systemMessage).toContain("requires Claude Code >= 2.1.287");
    expect(out.hookSpecificOutput.additionalContext.startsWith("## ⚠ WORKFLOWS GUARDS INACTIVE")).toBe(true);
  });

  test("on 2.1.287 it adds nothing", () => {
    const out = runHook("2.1.287");
    expect(out.systemMessage).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).not.toContain("GUARDS INACTIVE");
  });
});
