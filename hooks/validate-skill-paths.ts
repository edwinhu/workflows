#!/usr/bin/env bun
/**
 * PostToolUse hook: Validate path references in skill files after edits.
 *
 * Checks that ${CLAUDE_SKILL_DIR} and ${CLAUDE_PLUGIN_ROOT} references
 * in the edited file point to files that actually exist on disk.
 *
 * Skips:
 * - User-project paths (.planning/, .claude/, outlines/, drafts/)
 * - Template/placeholder paths ({VAR}, other-skill, scripts/script.py)
 * - Files outside a plugin directory
 *
 * Non-blocking: reports broken paths as messages.
 *
 * PORT NOTES (behavior-preserving, not a refactor):
 *   - Every path value here is a pathlib.PurePosixPath in the original, and the hook PRINTS
 *     path-derived strings, so the port reimplements pathlib's *string* semantics rather than
 *     using node:path. The difference is observable: the plugin root resolves to Path(".") when
 *     the plugin.json sits at cwd, `str(Path("."))` is ".", and the report therefore contains
 *     "./scripts/gone.py". `path.join`/`normalize` would collapse that to "scripts/gone.py" and
 *     silently break parity.
 *   - `resolve_ref` uses `str.replace`, which replaces ALL occurrences — `replaceAll`, not
 *     `replace`.
 *   - The `!`cat a.md b.md`` line yields THREE refs in this order: the whole argument string
 *     first (from the bang-cat regex), then each individual ${...} path (from the env-var regex,
 *     deduped by exact string). The order is part of the output; preserve it.
 *   - `in_fence` inside extract_and_check is computed and never read in the original. Kept as a
 *     no-op comment rather than "fixed"; the fence logic that matters lives in
 *     find_fenced_bang_backticks.
 *   - Any failure to read the edited file (missing, unreadable, undecodable) is a silent exit 0.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { context } from "./_gate_common.ts";

// Paths that exist in user projects, not the plugin
const USER_PROJECT_PREFIXES = [
  ".planning/",
  ".claude/",
  "outlines/",
  "drafts/",
  "data/",
  "tests/",
  "src/",
  "logs/",
];

// Template/placeholder substrings — skip these
const TEMPLATE_MARKERS = [
  "{SECTION",
  "{DRAFT",
  "{PLUGIN_ROOT}",
  "{STYLE}",
  "{OUTLINE",
  "SKILL-NAME",
  "SKILL/scripts",
  "other-skill",
  "TARGET/",
  "my-hook.py",
  "[Section]",
  "[phase_name]",
  "constraints.md",
  "scripts/script.py",
  "references/file.md",
];

// ---------------------------------------------------------------------------
// Minimal PurePosixPath: the string semantics pathlib gives the original.
// ---------------------------------------------------------------------------

type Parsed = { root: string; parts: string[] };

function parse(p: string): Parsed {
  const root = p.startsWith("/") ? "/" : "";
  const parts = p.split("/").filter((x) => x !== "" && x !== ".");
  return { root, parts };
}

/** `str(PurePosixPath(p))` — drops "." components and duplicate slashes; "" and "." become ".". */
function pathStr(p: string): string {
  const { root, parts } = parse(p);
  if (parts.length === 0) return root === "/" ? "/" : ".";
  return root + parts.join("/");
}

/** `PurePosixPath(p).name` */
function pathName(p: string): string {
  const { parts } = parse(p);
  return parts.length ? parts[parts.length - 1] : "";
}

/** `PurePosixPath(p).suffix` */
function pathSuffix(p: string): string {
  const name = pathName(p);
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i);
}

/** `PurePosixPath(p).parent` */
function pathParent(p: string): string {
  const { root, parts } = parse(p);
  if (parts.length === 0) return pathStr(p);
  const rest = parts.slice(0, -1);
  if (rest.length === 0) return root === "/" ? "/" : ".";
  return root + rest.join("/");
}

/** `list(PurePosixPath(p).parents)` */
function pathParents(p: string): string[] {
  const out: string[] = [];
  let cur = pathStr(p);
  for (;;) {
    const par = pathParent(cur);
    if (par === cur) break;
    out.push(par);
    cur = par;
  }
  return out;
}

/** `PurePosixPath(a) / b` */
function pathJoin(a: string, b: string): string {
  if (b.startsWith("/")) return pathStr(b);
  const base = pathStr(a);
  return base === "." ? pathStr(b) : pathStr(base + "/" + b);
}

/** `PurePosixPath(p).relative_to(other)`; throws (like ValueError) when not a prefix. */
function pathRelativeTo(p: string, other: string): string {
  const a = parse(pathStr(p));
  const b = parse(pathStr(other));
  if (a.root !== b.root || b.parts.some((seg, i) => a.parts[i] !== seg)) {
    throw new Error(`ValueError: '${pathStr(p)}' is not in the subpath of '${pathStr(other)}'`);
  }
  const rest = a.parts.slice(b.parts.length);
  return rest.length === 0 ? "." : rest.join("/");
}

/** `Path(p).exists()` — false on any OS error, exactly like pathlib. */
function pathExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/** `Path(p).is_file()` */
function pathIsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Python's `str.strip(chars)`: strip every leading/trailing char in the set. */
function pyStrip(s: string, chars?: string): string {
  const isStrip = (ch: string) => (chars === undefined ? /\s/.test(ch) : chars.includes(ch));
  let start = 0;
  let end = s.length;
  while (start < end && isStrip(s[start])) start++;
  while (end > start && isStrip(s[end - 1])) end--;
  return s.slice(start, end);
}

/** Python's `str.rstrip(chars)`. */
function pyRstrip(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

// ---------------------------------------------------------------------------

function findPluginRoot(filePath: string): string | null {
  let current = pathIsFile(filePath) ? pathParent(filePath) : pathStr(filePath);
  for (let i = 0; i < 15; i++) {
    if (pathExists(pathJoin(pathJoin(current, ".claude-plugin"), "plugin.json"))) {
      return current;
    }
    const parent = pathParent(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function getSkillDir(filepath: string, pluginRoot: string): string {
  if (pathName(filepath) === "SKILL.md") {
    return pathParent(filepath);
  }
  for (const parent of pathParents(filepath)) {
    if (pathExists(pathJoin(parent, "SKILL.md"))) return parent;
    if (parent === pathStr(pluginRoot)) break;
  }
  return pathParent(filepath);
}

function isSkippable(pathStrIn: string): boolean {
  const clean = pyStrip(pyStrip(pyStrip(pyStrip(pathStrIn), '"'), "'"), "`");
  for (const p of USER_PROJECT_PREFIXES) {
    if (clean.startsWith(p) || clean.includes("/" + p)) return true;
  }
  for (const m of TEMPLATE_MARKERS) {
    if (clean.includes(m)) return true;
  }
  return false;
}

/** Resolve a path reference. Returns resolved path string or null if skip. */
function resolveRef(raw: string, filepath: string, pluginRoot: string): string | null {
  const clean = pyStrip(pyStrip(pyStrip(pyStrip(raw), '"'), "'"), "`");
  if (isSkippable(clean)) return null;

  let resolved: string;
  if (clean.includes("${CLAUDE_SKILL_DIR}")) {
    const skillDir = getSkillDir(filepath, pluginRoot);
    resolved = clean.replaceAll("${CLAUDE_SKILL_DIR}", pathStr(skillDir));
  } else if (clean.includes("${CLAUDE_PLUGIN_ROOT}")) {
    resolved = clean.replaceAll("${CLAUDE_PLUGIN_ROOT}", pathStr(pluginRoot));
  } else {
    return null; // No env var reference to validate
  }

  if (resolved.includes("${") || resolved.includes("{")) return null;

  return resolved;
}

const BANG_CAT_RE = /!`cat\s+([^`]+)`/g;
const ENVVAR_RE = /(\$\{CLAUDE_(?:SKILL_DIR|PLUGIN_ROOT)\}\/[^\s"`'\)>]+)/g;

/** Return list of [line_num, raw_ref, resolved_path] for broken refs. */
function extractAndCheck(
  filepath: string,
  content: string,
  pluginRoot: string,
): [number, string, string][] {
  const broken: [number, string, string][] = [];
  const lines = content.split("\n");
  // NOTE: the original tracks `in_fence` here and never reads it. No-op, preserved as a comment.

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const i = idx + 1;
    const refsToCheck: string[] = [];

    // ! injection: !`cat ${...}/path`
    for (const m of line.matchAll(BANG_CAT_RE)) {
      refsToCheck.push(pyStrip(m[1]));
    }

    // Any ${CLAUDE_SKILL_DIR} or ${CLAUDE_PLUGIN_ROOT} path
    for (const m of line.matchAll(ENVVAR_RE)) {
      const pathStrRef = pyRstrip(m[1], ")");
      if (!refsToCheck.includes(pathStrRef)) refsToCheck.push(pathStrRef);
    }

    for (const raw of refsToCheck) {
      const resolved = resolveRef(raw, filepath, pluginRoot);
      // Python truthiness: an empty resolved string is falsy too.
      if (resolved && !pathExists(resolved)) broken.push([i, raw, resolved]);
    }
  }

  // Check for bang-backtick inside fenced code blocks (parser ignores fences)
  for (const [lineNum, raw] of findFencedBangBackticks(lines)) {
    broken.push([lineNum, raw, "FENCED_BANG_BACKTICK"]);
  }

  return broken;
}

/**
 * Find !`cat ...` patterns inside fenced code blocks.
 *
 * Claude Code's ! injection parser does NOT respect markdown fences —
 * it executes any !`...` it finds. Examples inside ``` blocks will be
 * executed, causing errors if the path doesn't exist or unintended
 * file injection if it does.
 */
function findFencedBangBackticks(lines: string[]): [number, string][] {
  const results: [number, string][] = [];
  let inFence = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const i = idx + 1;
    if (pyStrip(line).startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      for (const m of line.matchAll(BANG_CAT_RE)) {
        results.push([i, m[0]]);
      }
    }
  }
  return results;
}

async function main(): Promise<void> {
  let hookInput: Record<string, unknown>;
  try {
    hookInput = JSON.parse(await Bun.stdin.text());
  } catch {
    process.exit(0);
  }

  const toolName = (hookInput as Record<string, unknown>).tool_name ?? "";
  const toolInput = ((hookInput as Record<string, unknown>).tool_input ?? {}) as Record<string, unknown>;

  if (toolName !== "Edit" && toolName !== "Write") process.exit(0);

  const filePath = (toolInput.file_path ?? "") as string;
  if (!filePath) process.exit(0);

  const path = pathStr(String(filePath));

  // Only check markdown files in plugin directories
  if (pathSuffix(path).toLowerCase() !== ".md") process.exit(0);

  const pluginRoot = findPluginRoot(path);
  if (pluginRoot === null) process.exit(0);

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    process.exit(0);
  }

  const broken = extractAndCheck(path, content, pluginRoot);
  if (broken.length === 0) process.exit(0);

  // Format report
  const rel = pathRelativeTo(path, pluginRoot);
  const out = [`Broken path references in ${rel}:`];
  for (const [lineNum, raw, resolved] of broken) {
    if (resolved === "FENCED_BANG_BACKTICK") {
      out.push(`  L${lineNum}: ${raw}`);
      out.push(
        "    -> DANGER: !`cat` inside fenced code block — Claude Code ignores fences and WILL execute this. Rewrite the example to avoid the literal !` pattern.",
      );
    } else {
      out.push(`  L${lineNum}: ${raw}`);
      out.push(`    -> ${resolved} (NOT FOUND)`);
    }
  }

  context("PostToolUse", out.join("\n"));
}

await main();
