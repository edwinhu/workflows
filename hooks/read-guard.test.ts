import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const hookPath = resolve(import.meta.dir, "read-guard.ts");
const largeFile = resolve(import.meta.dir, "large-test-file.txt");

beforeAll(() => {
  // Generate 3MB file
  const chunk = "a".repeat(1024);
  const data = chunk.repeat(3000);
  writeFileSync(largeFile, data);
});

afterAll(() => {
  try {
    unlinkSync(largeFile);
  } catch {}
});

function runHook(payload: any, env?: any) {
  const result = spawnSync("bun", [hookPath], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

describe("READ GUARD PreToolUse Hook", () => {
  test("Allows Read with offset", () => {
    const payload = {
      tool_name: "Read",
      tool_input: {
        file_path: largeFile,
        offset: 0
      }
    };
    const { status, stdout } = runHook(payload);
    expect(status).toBe(0);
    expect(stdout).not.toContain("exceeds READ_GUARD_BYTES");
  });

  test("Allows Read with limit", () => {
    const payload = {
      tool_name: "Read",
      tool_input: {
        file_path: largeFile,
        limit: 100
      }
    };
    const { status, stdout } = runHook(payload);
    expect(status).toBe(0);
  });

  test("Denies Read without offset/limit on large file", () => {
    const payload = {
      tool_name: "Read",
      tool_input: {
        file_path: largeFile
      }
    };
    const { status, stdout } = runHook(payload);
    expect(stdout).toContain("exceeds READ_GUARD_BYTES");
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("exceeds READ_GUARD_BYTES");
  });

  test("Allows Read on small file without offset/limit", () => {
    const payload = {
      tool_name: "Read",
      tool_input: {
        file_path: hookPath // this file is small
      }
    };
    const { status, stdout } = runHook(payload);
    expect(status).toBe(0);
    if (stdout.trim() !== "") {
        expect(stdout).not.toContain("exceeds READ_GUARD_BYTES");
    }
  });

  test("Allows Read on large file if READ_GUARD_BYTES=0", () => {
    const payload = {
      tool_name: "Read",
      tool_input: {
        file_path: largeFile
      }
    };
    const { status, stdout } = runHook(payload, { READ_GUARD_BYTES: "0" });
    expect(status).toBe(0);
    if (stdout.trim() !== "") {
        expect(stdout).not.toContain("deny");
    }
  });

  test("Denies Bash cat of large file", () => {
    const payload = {
      tool_name: "Bash",
      tool_input: {
        command: `cat ${largeFile}`
      }
    };
    const { stdout } = runHook(payload);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain("exceeds READ_GUARD_BYTES");
  });

  test("Allows Bash cat of small file", () => {
    const payload = {
      tool_name: "Bash",
      tool_input: {
        command: `cat ${hookPath}`
      }
    };
    const { status, stdout } = runHook(payload);
    expect(status).toBe(0);
  });

  test("Allows Bash bounded command on large file", () => {
    const payload = {
      tool_name: "Bash",
      tool_input: {
        command: `head -n 100 ${largeFile}`
      }
    };
    const { status, stdout } = runHook(payload);
    expect(status).toBe(0);
  });

  test("Allows Bash rg command on large file", () => {
    const payload = {
      tool_name: "Bash",
      tool_input: {
        command: `rg foo ${largeFile}`
      }
    };
    const { status } = runHook(payload);
    expect(status).toBe(0);
  });
});
