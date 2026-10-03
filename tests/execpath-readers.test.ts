/**
 * CLAUDE_CODE_EXECPATH is correct only in the Bash tool's shell: the binary sets it there from its own
 * process.execPath, while hooks and MCP servers inherit whatever the session was LAUNCHED with — after
 * a resume, a binary that may be uninstalled. `runningClaudeExe` in hooks/session-start.ts asks the
 * parent process instead and keeps the variable only as its last fallback, so it must stay the one
 * reader. Every other script that needs the running claude imports it.
 *
 * Run: bun test tests/execpath-readers.test.ts
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const VAR = "CLAUDE_CODE_EXECPATH";

/** A line that READS the variable in TS/JS, shell or Python — not one that mentions it in a comment. */
export function readsExecPath(line: string): boolean {
  const code = line.trim();
  if (/^(\/\/|\*|\/\*|#)/.test(code)) return false;
  return new RegExp(
    String.raw`\.${VAR}\b|\[\s*['"\x60]${VAR}['"\x60]\s*\]|\$\{?${VAR}\b|getenv\(\s*['"]${VAR}|\.get\(\s*['"]${VAR}`,
  ).test(code);
}

/** Tracked source under hooks/, scripts/ and skills/, minus tests (which set the variable on purpose). */
function sourceFiles(): string[] {
  const r = spawnSync("git", ["ls-files", "hooks", "scripts", "skills"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return r.stdout
    .split("\n")
    .filter((f) => /\.(ts|mts|js|mjs|cjs|sh|bash|py)$/.test(f))
    .filter((f) => !/(\.test\.|_test\.py$|(^|\/)tests?\/|mod-tests\/)/.test(f));
}

describe("CLAUDE_CODE_EXECPATH readers", () => {
  test("the matcher flags a stale-env read in every language and skips comments", () => {
    for (const line of [
      "const exe = process.env.CLAUDE_CODE_EXECPATH || 'claude'",
      "spawnSync(env['CLAUDE_CODE_EXECPATH'], ['--version'])",
      'v=$("$CLAUDE_CODE_EXECPATH" --version)',
      "exe=${CLAUDE_CODE_EXECPATH:-claude}",
      'exe = os.environ.get("CLAUDE_CODE_EXECPATH")',
      'exe = os.getenv("CLAUDE_CODE_EXECPATH")',
      "$.env.get('CLAUDE_CODE_EXECPATH')",
    ])
      expect(readsExecPath(line)).toBe(true);
    for (const line of [
      " * that, `CLAUDE_CODE_EXECPATH`. That variable is only a hint",
      " * `$CLAUDE_CODE_EXECPATH`, which a hook inherits from whatever launched the session).",
      "// process.env.CLAUDE_CODE_EXECPATH is stale after a resume",
      "# $CLAUDE_CODE_EXECPATH names the launch binary",
    ])
      expect(readsExecPath(line)).toBe(false);
  });

  test("runningClaudeExe in hooks/session-start.ts is the only reader", () => {
    const hits: string[] = [];
    for (const f of sourceFiles()) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, f), "utf8");
      } catch {
        continue; // deleted in the working tree
      }
      if (!text.includes(VAR)) continue;
      text.split("\n").forEach((line, i) => {
        if (readsExecPath(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([`hooks/session-start.ts:${fallbackLine()}: return env.${VAR} || "";`]);
  });
});

/** The line of runningClaudeExe's fallback, so the assertion pins the reader to that function. */
function fallbackLine(): number {
  const lines = readFileSync(join(ROOT, "hooks", "session-start.ts"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("export function runningClaudeExe("));
  const end = lines.findIndex((l, i) => i > start && l === "}");
  const at = lines.findIndex((l, i) => i > start && i < end && l.includes(`env.${VAR}`));
  return at + 1;
}
