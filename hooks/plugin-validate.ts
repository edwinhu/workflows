#!/usr/bin/env bun
/**
 * PostToolUse hook: Validate plugin manifests and component frontmatter after edits.
 *
 * TypeScript port of plugin-validate.py — behavior-identical, including exit codes and byte-level
 * stdout.
 *
 * Triggers on:
 * - plugin.json / marketplace.json — runs `claude plugin validate <file>`
 * - SKILL.md, agent .md, command .md — runs `claude plugin validate <plugin-dir>`
 * - hooks.json inside a plugin — runs `claude plugin validate <plugin-dir>`
 *
 * Non-blocking: reports validation output as messages.
 * Silently skips if not inside a plugin directory or if claude CLI not found.
 *
 * PORTING NOTES
 *   - Output goes through `pyJson`, never `JSON.stringify`: Python's json.dumps uses `", "` / `": "`
 *     separators and ensure_ascii, so the ⚠ that `claude plugin validate` prints in its warnings
 *     would serialize to different bytes under JSON.stringify.
 *   - `PyPath` reproduces pathlib's PurePosixPath semantics that this hook depends on: "." segments
 *     dropped (so `Path(".") / "x"` is `"x"`, not `"./x"`), no `..` resolution, `.name` / `.parent` /
 *     `.relative_to` as in Python.
 *   - subprocess(text=True) does universal-newline translation; `decodeText` mirrors it.
 */
import { pyJson } from "./_gate_common.ts";
import { statSync } from "node:fs";

/** Minimal PurePosixPath clone covering the operations this hook uses. */
class PyPath {
  root: string;
  parts: string[];

  constructor(raw: string | { root: string; parts: string[] }) {
    if (typeof raw !== "string") {
      this.root = raw.root;
      this.parts = raw.parts;
      return;
    }
    // pathlib: a leading "//" (exactly two) is its own root, but that nicety never matters here.
    this.root = raw.startsWith("/") ? "/" : "";
    this.parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  }

  get name(): string {
    return this.parts.length ? this.parts[this.parts.length - 1] : "";
  }

  get parent(): PyPath {
    if (!this.parts.length) return this;
    return new PyPath({ root: this.root, parts: this.parts.slice(0, -1) });
  }

  join(...segs: string[]): PyPath {
    let p: PyPath = this;
    for (const s of segs) {
      if (s.startsWith("/")) {
        p = new PyPath(s);
      } else {
        p = new PyPath({ root: p.root, parts: [...p.parts, ...s.split("/").filter((x) => x !== "" && x !== ".")] });
      }
    }
    return p;
  }

  isRelativeTo(other: PyPath): boolean {
    if (this.root !== other.root) return false;
    if (other.parts.length > this.parts.length) return false;
    return other.parts.every((p, i) => this.parts[i] === p);
  }

  relativeTo(other: PyPath): PyPath {
    return new PyPath({ root: "", parts: this.parts.slice(other.parts.length) });
  }

  toString(): string {
    const joined = this.parts.join("/");
    if (this.root) return this.root + joined;
    return joined === "" ? "." : joined;
  }

  exists(): boolean {
    try {
      statSync(this.toString());
      return true;
    } catch {
      return false;
    }
  }

  isFile(): boolean {
    try {
      return statSync(this.toString()).isFile();
    } catch {
      return false;
    }
  }
}

/** Walk up from file to find nearest directory containing .claude-plugin/plugin.json. */
function findPluginRoot(filePath: PyPath): PyPath | null {
  let current = filePath.isFile() ? filePath.parent : filePath;
  for (let i = 0; i < 15; i++) {
    const candidate = current.join(".claude-plugin", "plugin.json");
    if (candidate.exists()) return current;
    const parent = current.parent;
    if (parent.toString() === current.toString()) break;
    current = parent;
  }
  return null;
}

/** subprocess(text=True): decode utf-8 and translate \r\n and lone \r to \n. */
function decodeText(buf: Uint8Array): string {
  return new TextDecoder().decode(buf).replace(/\r\n?/g, "\n");
}

/** Run claude plugin validate and return [returncode, stdout, stderr]. */
async function runValidate(target: string, timeout = 15): Promise<[number, string, string]> {
  let proc;
  try {
    proc = Bun.spawn(["claude", "plugin", "validate", target], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    // Python raises FileNotFoundError when the executable is missing.
    const msg = String((e as { message?: string })?.message ?? e);
    if (/ENOENT|not found|No such file/i.test(msg)) return [-1, "", "claude CLI not found"];
    return [-3, "", msg];
  }
  try {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {}
    }, timeout * 1000);
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).bytes(),
      new Response(proc.stderr).bytes(),
      proc.exited,
    ]);
    clearTimeout(timer);
    if (timedOut) return [-2, "", "validation timed out"];
    return [code, decodeText(out), decodeText(err)];
  } catch (e) {
    return [-3, "", String((e as { message?: string })?.message ?? e)];
  }
}

/**
 * Determine what to validate based on the edited file.
 * Returns [target_path, description] or [null, ""] if not a plugin file.
 */
function shouldValidate(filePath: string): [string | null, string] {
  const path = new PyPath(filePath);
  const name = path.name.toLowerCase();

  // Direct manifest files — validate the specific file
  if (name === "plugin.json" && path.parent.name === ".claude-plugin") return [path.toString(), "plugin.json"];
  if (name === "marketplace.json" && path.parent.name === ".claude-plugin") return [path.toString(), "marketplace.json"];

  // Plugin component files — validate the whole plugin directory
  const pluginRoot = findPluginRoot(path);
  if (!pluginRoot) return [null, ""];

  // SKILL.md, agent .md, command .md, hooks.json
  if (name === "skill.md") {
    return [pluginRoot.join(".claude-plugin", "plugin.json").toString(), "plugin (skill changed)"];
  }
  if (name === "hooks.json" && path.parent.toString().includes("hooks")) {
    return [pluginRoot.join(".claude-plugin", "plugin.json").toString(), "plugin (hooks changed)"];
  }
  // Agent or command markdown files
  const rel = path.isRelativeTo(pluginRoot) ? path.relativeTo(pluginRoot) : null;
  if (rel && name.endsWith(".md")) {
    const parts = rel.parts;
    if (parts.length >= 2 && (parts[0] === "agents" || parts[0] === "commands")) {
      return [pluginRoot.join(".claude-plugin", "plugin.json").toString(), `plugin (${parts[0]} changed)`];
    }
  }

  return [null, ""];
}

/** Python str.strip(): whitespace per str.isspace(). Close enough via trim on both ends. */
function pyStrip(s: string): string {
  return s.replace(/^[\s\x1c-\x1f]+/, "").replace(/[\s\x1c-\x1f]+$/, "");
}

let hookInput: unknown;
try {
  hookInput = JSON.parse(await Bun.stdin.text());
} catch {
  process.exit(0);
}

// Python does hook_input.get(...) unguarded: a non-dict payload raises AttributeError -> exit 1.
if (hookInput === null || typeof hookInput !== "object" || Array.isArray(hookInput)) {
  console.error("AttributeError: object has no attribute 'get'");
  process.exit(1);
}
const payload = hookInput as Record<string, unknown>;

const toolName = payload.tool_name ?? "";
const toolInputRaw = payload.tool_input ?? {};

if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

if (toolInputRaw === null || typeof toolInputRaw !== "object" || Array.isArray(toolInputRaw)) {
  console.error("AttributeError: object has no attribute 'get'");
  process.exit(1);
}

const filePath = (toolInputRaw as Record<string, unknown>).file_path ?? "";
if (!filePath) process.exit(0);

const [target, description] = shouldValidate(String(filePath));
if (!target) process.exit(0);

const [code, stdout, stderr] = await runValidate(target);

if (code === -1) process.exit(0); // claude CLI not found, skip silently

// Combine output
const output = pyStrip(stdout + stderr);

if (code !== 0 && output) {
  // Validation failed — report errors
  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `Plugin validation (${description}) FAILED:\n${output}`,
      },
    }),
  );
  process.exit(0);
}

// Check for warnings in passing output (validate exits 0 but may warn)
if (output.toLowerCase().includes("warning") || output.includes("⚠")) {
  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `Plugin validation (${description}) warnings:\n${output}`,
      },
    }),
  );
}

process.exit(0);
