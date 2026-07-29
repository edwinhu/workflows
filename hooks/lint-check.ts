#!/usr/bin/env bun
/**
 * PostToolUse hook: Run appropriate linter after file edits. TypeScript port of lint-check.py.
 *
 * Supports:
 * - Python (marimo): marimo check
 * - Python (regular): ruff check
 * - TypeScript/JavaScript: eslint (project-local or npx)
 * - R: lintr
 * - Stata: stata-linter
 * - SAS: sasjs lint
 *
 * Non-blocking: reports linter output as messages (PostToolUse additionalContext).
 * Silently skips if linter not installed.
 *
 * PORTING NOTES (behavior preserved exactly, oddities included):
 * - `run_command` collapses "binary missing" to returncode -1, timeout to -2, anything else to -3.
 *   Every checker treats ONLY -1 as "linter not installed" and returns silence; a -3 (e.g. a
 *   non-executable candidate eslint) falls through to the `code != 0` branch instead.
 * - The `'.R'` key in the linters map is dead code — the suffix is lowercased before lookup — and is
 *   kept here for the same reason it exists there: this is a port, not a refactor.
 * - Python's `Path.suffix` returns "" for a dotfile with no other dot ('.bashrc') and for a trailing
 *   dot ('x.'); `pySuffix` reproduces that rule rather than a naive lastIndexOf.
 * - Output is serialized with `pyJson`, not `JSON.stringify`, so the bytes match `json.dumps`.
 */
import { context, readPayload } from "./_gate_common.ts";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type CmdResult = { code: number; stdout: string; stderr: string };

/** Run a command, mapping failures onto Python's sentinel return codes (-1/-2/-3). */
function runCommand(cmd: string[], timeout = 30): CmdResult {
  try {
    const proc = Bun.spawnSync(cmd, {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: timeout * 1000,
    });
    const dec = new TextDecoder();
    const stdout = dec.decode(proc.stdout ?? new Uint8Array());
    const stderr = dec.decode(proc.stderr ?? new Uint8Array());
    // Bun surfaces a timeout kill as signalCode SIGTERM/SIGKILL with the deadline exceeded;
    // Python raises TimeoutExpired -> -2.
    if (proc.signalCode && (proc.signalCode === "SIGTERM" || proc.signalCode === "SIGKILL")) {
      return { code: -2, stdout: "", stderr: "timeout" };
    }
    return { code: proc.exitCode ?? -3, stdout, stderr };
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    const code = (e as { code?: string })?.code;
    // FileNotFoundError -> -1; every other exception -> -3.
    if (code === "ENOENT" || /ENOENT|No such file or directory|Executable not found/i.test(msg)) {
      return { code: -1, stdout: "", stderr: "command not found" };
    }
    return { code: -3, stdout: "", stderr: msg };
  }
}

/** Python's `Path.suffix`: last dot-part of the basename, unless leading or trailing. */
function pySuffix(filePath: string): string {
  const name = basename(filePath.replace(/\/+$/, ""));
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

function isMarimoNotebook(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf8").slice(0, 2000);
    return content.includes("import marimo") || content.includes("@app.cell");
  } catch {
    return false;
  }
}

function checkPython(filePath: string): string | null {
  if (isMarimoNotebook(filePath)) {
    const { code, stdout, stderr } = runCommand(["marimo", "check", filePath]);
    if (code === -1) return null; // marimo not installed
    if (code !== 0) {
      const output = (stdout + stderr).trim();
      return output ? `marimo check:\n${output}` : null;
    }
  } else {
    const { code, stdout } = runCommand(["ruff", "check", "--no-fix", filePath]);
    if (code === -1) return null; // ruff not installed
    if (code !== 0) {
      const output = stdout.trim();
      return output ? `ruff:\n${output}` : null;
    }
  }
  return null;
}

function checkR(filePath: string): string | null {
  const cmd = ["Rscript", "-e", `cat(lintr::lint('${filePath}'))`];
  const { code, stdout, stderr } = runCommand(cmd);
  if (code === -1) return null; // R/lintr not installed
  const output = stdout.trim();
  if (output && !stderr.includes("Error")) return `lintr:\n${output}`;
  return null;
}

function checkStata(filePath: string): string | null {
  const { code, stdout } = runCommand(["stata-linter", filePath]);
  if (code === -1) return null; // stata-linter not installed
  if (code !== 0 || stdout.trim()) {
    const output = stdout.trim();
    return output ? `stata-linter:\n${output}` : null;
  }
  return null;
}

function checkSas(filePath: string): string | null {
  const { code, stdout } = runCommand(["sasjs", "lint", filePath]);
  if (code === -1) return null; // sasjs not installed
  if (code !== 0 || stdout.trim()) {
    const output = stdout.trim();
    return output ? `sasjs lint:\n${output}` : null;
  }
  return null;
}

/** Walk up from the file to find node_modules/.bin/eslint (max 10 levels). */
function findLocalEslint(filePath: string): string | null {
  let current = dirname(resolve(filePath));
  for (let i = 0; i < 10; i++) {
    const candidate = join(current, "node_modules", ".bin", "eslint");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function checkJsTs(filePath: string): string | null {
  const localEslint = findLocalEslint(filePath);
  const cmd = localEslint
    ? [localEslint, "--no-fix", filePath]
    : ["npx", "--no-install", "eslint", "--no-fix", filePath];

  const { code, stdout } = runCommand(cmd);
  if (code === -1) return null; // eslint not available
  if (code !== 0) {
    const output = stdout.trim();
    return output ? `eslint:\n${output}` : null;
  }
  return null;
}

const LINTERS: Record<string, (p: string) => string | null> = {
  ".py": checkPython,
  ".r": checkR,
  ".R": checkR, // dead in Python too (suffix is lowercased first) — kept for fidelity
  ".do": checkStata,
  ".ado": checkStata,
  ".sas": checkSas,
  ".ts": checkJsTs,
  ".tsx": checkJsTs,
  ".js": checkJsTs,
  ".jsx": checkJsTs,
  ".mjs": checkJsTs,
  ".mts": checkJsTs,
};

let hookInput: Record<string, unknown>;
try {
  hookInput = await readPayload();
} catch {
  process.exit(0);
}

// Python does `hook_input.get(...)` unguarded: a non-dict payload (`null`, `[]`) raises
// AttributeError -> traceback on stderr, exit 1. Reproduced rather than smoothed over.
if (hookInput === null || typeof hookInput !== "object" || Array.isArray(hookInput)) {
  console.error("AttributeError: object has no attribute 'get'");
  process.exit(1);
}

const toolName = String(hookInput.tool_name ?? "");
const toolInput = (hookInput.tool_input ?? {}) as Record<string, unknown>;

if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

const filePath = String(toolInput.file_path ?? "");
if (!filePath) process.exit(0);

const linter = LINTERS[pySuffix(filePath).toLowerCase()];
if (!linter) process.exit(0);

const output = linter(filePath);
if (!output) process.exit(0);

context("PostToolUse", `Linter output:\n${output}`);
