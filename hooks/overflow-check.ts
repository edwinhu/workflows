#!/usr/bin/env bun
/**
 * PostToolUse hook: Run overflow detection after typst compile.
 *
 * Fires on Bash tool calls that contain 'typst compile' (or 'tinymist compile') and a .typ file.
 * Runs check-overflow.sh and reports results as additional context.
 *
 * Non-blocking: reports overflow as messages so the agent can fix it.
 *
 * PORT NOTE — the crash contract is load-bearing.
 *   The Python original wraps ONLY `json.load(sys.stdin)` in try/except. A payload that parses but
 *   is not a dict (a bare JSON string, a list, a number) sails past the except and then dies on
 *   `hook_input.get(...)` with an AttributeError — exit 1, empty stdout. A defensive port that
 *   returns 0 there would be "nicer" and WRONG; tests/golden/overflow-check.json pins exit 1.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pyJson } from "./_gate_common.ts";

/** Join/normalize like PurePosixPath: drop "." and empty segments, keep ".." and the root. */
function pathStr(p: string): string {
  const abs = p.startsWith("/");
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const joined = parts.join("/");
  if (abs) return "/" + joined;
  return joined === "" ? "." : joined;
}

/** Python's `Path(a) / b`: an absolute b REPLACES a. */
function pathJoin(a: string, b: string): string {
  if (b.startsWith("/")) return pathStr(b);
  return pathStr(a === "" ? b : `${a}/${b}`);
}

/** Python's Path.expanduser: only a leading "~" (bare or "~/") is expanded here. */
function expandUser(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

/** Python's PurePath.parent. */
function pathParent(p: string): string {
  const s = pathStr(p);
  if (s === "/" || s === ".") return s;
  const idx = s.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return s.slice(0, idx);
}

/** Python's PurePath.stem. */
function pathStem(p: string): string {
  const s = pathStr(p);
  const name = s.slice(s.lastIndexOf("/") + 1);
  const idx = name.lastIndexOf(".");
  if (idx > 0 && idx < name.length - 1) return name.slice(0, idx);
  return name;
}

/** Find the workflows plugin root. */
function findPluginRoot(): string | null {
  // Try relative to this hook file
  const hookDir = import.meta.dir;
  const candidate = pathParent(hookDir);
  if (existsSync(pathJoin(pathJoin(candidate, ".claude-plugin"), "plugin.json"))) return candidate;
  return null;
}

const TRIGGER_RE = /\b(?:typst|tinymist)\s+compile\b/;

/**
 * Return the .typ compile target in `command`, or null if this isn't a typst/tinymist compile.
 *
 * Triggers on both `typst compile` and `tinymist compile`. Tolerates flags between "compile" and
 * the target by taking the LAST `*.typ` token in the ;/&/|-delimited segment that contains the
 * trigger, rather than requiring the target to be the first token after "compile".
 */
export function resolveTypTarget(command: string): string | null {
  for (const seg of command.split(/[;&|]+/)) {
    if (TRIGGER_RE.test(seg)) {
      const tokens = [...seg.matchAll(/([^\s]+\.typ)\b/g)].map((m) => m[1]);
      if (tokens.length) return tokens[tokens.length - 1];
    }
  }
  return null;
}

function main(hookInput: Record<string, unknown>): never {
  // Mirrors Python's AttributeError on a non-dict payload: crash, exit 1, empty stdout.
  if (hookInput === null || typeof hookInput !== "object" || Array.isArray(hookInput)) {
    throw new TypeError("hook_input has no attribute 'get'");
  }

  const toolName = hookInput.tool_name ?? "";
  const rawInput = hookInput.tool_input ?? {};
  const toolInput =
    rawInput !== null && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};

  if (toolName !== "Bash") process.exit(0);

  const command = String(toolInput.command ?? "");

  const typFile = resolveTypTarget(command);
  if (!typFile) process.exit(0);

  // Only check slides files (not notes.typ or other .typ files)
  if (!pathStem(typFile).includes("slides")) process.exit(0);

  // Find the check script
  const pluginRoot = findPluginRoot();
  if (!pluginRoot) process.exit(0);

  const checkScript = pathJoin(pathJoin(pluginRoot, "scripts"), pathJoin("checks", "check-overflow.sh"));
  if (!existsSync(checkScript)) process.exit(0);

  // Determine the working directory from the command — look for a cd before typst compile
  const cwdMatch = command.match(/cd\s+([^\s;&]+)/);
  const cwd = cwdMatch ? cwdMatch[1] : ".";

  // Resolve the slides path
  let slidesPath = pathJoin(expandUser(cwd), typFile);
  if (!existsSync(slidesPath)) {
    // Try without cd prefix
    slidesPath = pathStr(expandUser(typFile));
    if (!existsSync(slidesPath)) process.exit(0);
  }

  let rc: number;
  let stdout: string;
  try {
    const proc = Bun.spawnSync(["bash", checkScript, slidesPath], {
      cwd: pathParent(slidesPath),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    rc = proc.exitCode ?? 0;
    stdout = new TextDecoder().decode(proc.stdout);
  } catch {
    process.exit(0);
  }

  if (rc === 1 && stdout) {
    console.log(
      pyJson({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `OVERFLOW DETECTED in ${typFile}:\n${stdout.trim()}\n\nFix: cut content, split slides, or use columns. Then recompile.`,
        },
      }),
    );
  }

  process.exit(0);
}

// GUARDED, SO THE FILE CAN BE IMPORTED. Unguarded, module scope read stdin and called
// `process.exit(0)` on import — so a test that imported `resolveTypTarget` exited silently before
// its first assertion and reported success by printing nothing. That is the same silent-zero shape
// `scripts/check-tests.sh` was written to prevent, arriving through the import path instead of the
// runner. A hook has to be loadable to be testable.
if (import.meta.main) {
  let payload: unknown;
  try {
    payload = JSON.parse(await Bun.stdin.text());
  } catch {
    process.exit(0);
  }
  main(payload as Record<string, unknown>);
}
