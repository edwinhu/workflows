#!/usr/bin/env bun
/** PostToolUse hook: lint a freshly-written drafts/*.md for cite-fidelity issues.
 *
 * TypeScript port of cite-fidelity-lint.py — behavior-identical, including the odd bits.
 *
 * Fires after Edit|Write|MultiEdit of a markdown file inside the writing project's drafts/
 * directory. Runs Stage 4 lint and surfaces findings as non-blocking additionalContext.
 *
 * Always defaults to approve — never blocks tool calls, never exits non-zero.
 *
 * Skipped when: no file_path, not a .md, not under a `drafts` path component, the bundled lint
 * script is missing, no receipt-selected canonical plan state above the file, or any unexpected error.
 *
 * PATH SEMANTICS: this hook uses pathlib-like `suffix`, `parts`, and `parent` behavior while walking
 * upward from a draft. A project qualifies only when its hidden review receipt selects and
 * authenticates a current approved writing plan.
 */
import { existsSync, realpathSync } from "node:fs";
import { context, readPayload } from "./_gate_common.ts";
import { authenticatedWritingPlan } from "./lib/writing-plan-context.ts";

/** PurePosixPath-alike: just enough of pathlib for this hook. */
class PPath {
  readonly root: string;
  readonly parts: string[];
  constructor(root: string, parts: string[]) {
    this.root = root;
    this.parts = parts;
  }
  static parse(p: string): PPath {
    return new PPath(p.startsWith("/") ? "/" : "", p.split("/").filter((x) => x !== "" && x !== "."));
  }
  /** str(Path(...)): "." for the empty relative path. */
  get str(): string {
    if (this.parts.length === 0) return this.root || ".";
    return this.root + this.parts.join("/");
  }
  /** pathlib's `.parts`: absolute paths carry a leading "/" element. */
  get pathParts(): string[] {
    return this.root ? [this.root, ...this.parts] : [...this.parts];
  }
  get name(): string {
    return this.parts.length ? this.parts[this.parts.length - 1] : "";
  }
  /** pathlib: no suffix for a leading dot (".bashrc") or a trailing one ("a."). */
  get suffix(): string {
    const n = this.name;
    const i = n.lastIndexOf(".");
    return i > 0 && i < n.length - 1 ? n.slice(i) : "";
  }
  get parent(): PPath {
    if (this.parts.length === 0) return this;
    return new PPath(this.root, this.parts.slice(0, -1));
  }
  join(...segs: string[]): string {
    const base = this.str;
    return base === "/" ? "/" + segs.join("/") : base + "/" + segs.join("/");
  }
}

async function main(): Promise<number> {
  let hookInput: Record<string, unknown>;
  try {
    hookInput = await readPayload();
  } catch {
    return 0;
  }

  const toolName = String(hookInput?.tool_name ?? "");
  if (toolName !== "Edit" && toolName !== "Write" && toolName !== "MultiEdit") return 0;

  const toolInput = (hookInput?.tool_input as Record<string, unknown>) || {};
  const filePath = String(toolInput?.file_path ?? "");
  if (!filePath) return 0;

  const fp = PPath.parse(filePath);
  if (fp.suffix !== ".md") return 0;
  if (!fp.pathParts.includes("drafts")) return 0;

  const pluginRoot = PPath.parse(realpathSync(import.meta.path)).parent.parent;
  const lintScript = pluginRoot.join("scripts", "cite-fidelity", "lint_drafts.py");
  if (!existsSync(lintScript)) return 0;

  const plan = authenticatedWritingPlan(fp.parent.str);
  if (!plan) return 0;

  let stdout = "";
  let stderr = "";
  try {
    const result = Bun.spawnSync({
      cmd: ["uv", "run", "python3", lintScript, "--project-root", plan.projectRoot, ...(plan.notebook ? ["--nlm-notebook", plan.notebook] : []), fp.str],
      cwd: plan.projectRoot,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    // subprocess.run(timeout=60) RAISES on timeout, so the Python swallows it and returns 0.
    if ((result as { exitedDueToTimeout?: boolean }).exitedDueToTimeout) return 0;
    stdout = result.stdout ? result.stdout.toString() : "";
    stderr = result.stderr ? result.stderr.toString() : "";
  } catch {
    return 0;
  }

  const out = stdout.trim();
  const err = stderr.trim();
  if (!out && !err) return 0;
  if (out.includes("✓ no issues")) return 0;

  const lines = ["[cite-fidelity-lint] findings on " + fp.name + ":"];
  if (out) lines.push(out);
  if (err) lines.push(err);
  context("PostToolUse", lines.join("\n")); // never returns
}

process.exit(await main());
