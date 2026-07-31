#!/usr/bin/env bun
/**
 * PreToolUse hook: Block code-modifying tools if a required gate artifact is missing.
 *
 * TypeScript port of phase-gate-guard.py. Behavior-identical by construction — see
 * tests/golden/phase-gate-guard.json and `bun scripts/parity.ts phase-gate-guard`.
 *
 * Generic phase-gate enforcer. Each skill that needs a gate passes the required
 * artifact path and a human-readable gate description via environment variables:
 *
 *   GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
 *   GATE_STATUS=APPROVED           (optional: required frontmatter status value)
 *   GATE_REQUIRE_FIELDS=codex_second_pass:enabled|declined|unavailable
 *                                  (optional: frontmatter keys that must be present,
 *                                   optionally constrained to an allowed value set)
 *   GATE_DESCRIPTION=Plan review   (human-readable name for error messages)
 *   GATE_REMEDY=Return to dev-design and run dev-plan-reviewer
 *   GATE_BLOCKED_TOOLS=Write,Edit,Bash,Agent  (optional: default Write|Edit)
 *
 * GATE_REQUIRE_FIELDS syntax: comma-separated entries, each either `name` (key must
 * be present and non-empty) or `name:v1|v2` (must also be one of the listed values).
 * It answers a question GATE_STATUS cannot: "was this decision *recorded*, or
 * silently skipped?" A phase can legitimately end in several dispositions, so
 * pinning one `status:` value is wrong — but leaving the field absent entirely
 * means the phase never ran and nobody noticed.
 *
 * Constraining the value set also catches the copy-paste failure: SKILL.md YAML
 * templates are written as `field: a | b | c`, and an agent that pastes the
 * template verbatim without substituting leaves a literal `a | b | c` that matches
 * no single allowed value — so the gate blocks instead of accepting a placeholder
 * as a real answer.
 *
 * LANDMINE: GATE_REQUIRE_FIELDS values contain `|`, which bash reads as a PIPE. The
 * assignment MUST be quoted in the hook command:
 *
 *     GATE_REQUIRE_FIELDS="codex_second_pass:enabled|declined|unavailable"   # correct
 *     GATE_REQUIRE_FIELDS=codex_second_pass:enabled|declined|unavailable     # BROKEN
 *
 * Unquoted, bash parses it as a pipeline, the env var is never set, this script sees
 * no field requirement, and the gate silently allows everything — a phantom gate that
 * looks wired but never blocks.
 *
 * LANDMINE: the `matcher` alone does NOT block a tool — it only decides which tool calls invoke
 * this script. Blocking is decided here, by GATE_BLOCKED_TOOLS, which DEFAULTS to Write,Edit only.
 * A matcher of "Write|Edit|Agent" with no GATE_BLOCKED_TOOLS=...,Agent fires this script on every
 * Agent call but silently allows it through — a phantom gate. Always list every tool named in
 * `matcher` in GATE_BLOCKED_TOOLS too.
 *
 * FRONTMATTER READING — the reader is hand-rolled and fails closed: absent, nested, duplicated, or
 * non-scalar keys all read as '' and the gate blocks. Dependency-free on purpose: this fires on
 * every tool call, and a hook that must resolve a package before it can answer is a hook that can
 * fail OPEN, which is strictly worse than the residual documented in the .py original.
 */
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Tools that this hook can block (configured per-skill via env var)
const DEFAULT_BLOCKED_TOOLS = new Set(["Write", "Edit"]);

// Files that are always allowed (workflow state, not project code)
const ALWAYS_ALLOWED_DIRS = new Set([".planning", ".claude"]);

/** Python `str.strip()` / `str.rstrip()` equivalents over ASCII+unicode whitespace. */
const strip = (s: string): string => s.trim();
const rstrip = (s: string): string => s.replace(/\s+$/u, "");

/** Python `str.splitlines()` — final trailing newline does NOT yield an extra empty line. */
function splitLines(text: string): string[] {
  const out = text.split(/\r\n|\r|\n/);
  if (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

function readArtifactSnapshot(artifactPath: string, beforeOpen?: () => void): string | null {
  let fd: number | null = null;
  try {
    const original = lstatSync(artifactPath);
    if (!original.isFile() || original.isSymbolicLink()) return null;
    beforeOpen?.();
    if (constants.O_NOFOLLOW === undefined) return null;
    fd = openSync(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== original.dev || opened.ino !== original.ino) return null;
    return readFileSync(fd, "utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Return the artifact's YAML frontmatter block, or '' if there isn't one.
 *
 * A delimiter is a LINE that is exactly `---`, not any `---` substring: the latter truncates
 * scalars that merely contain the sequence, so `status: APPROVED---nope` would be cut down to a
 * passing `APPROVED` when YAML says the value is `APPROVED---nope`.
 */
function parseFrontmatter(text: string): string {
  // rstrip, not strip: trailing whitespace after `---` is still a delimiter, but an INDENTED
  // `  ---` is a plain-scalar continuation line — YAML reads `status: APPROVED` + `  ---` as the
  // single value `APPROVED ---`, so treating it as the closing delimiter would pass a gate on a
  // value the document doesn't contain.
  const lines = splitLines(text);
  if (!lines.length || rstrip(lines[0]) !== "---") return "";
  for (let i = 1; i < lines.length; i++) {
    if (rstrip(lines[i]) === "---") return lines.slice(1, i).join("\n");
  }
  return ""; // unterminated frontmatter — no readable evidence
}

function readFrontmatter(artifactPath: string): string {
  try {
    return parseFrontmatter(readFileSync(artifactPath, "utf8"));
  } catch {
    return "";
  }
}

/** Extract the scalar from a YAML `key:` right-hand side. Anything unsupported returns ''. */
function yamlScalar(rawIn: string): string {
  const raw = strip(rawIn);
  if (!raw) return "";

  // Quoted scalar: the value is what's between the quotes. A '#' inside is literal text, NOT a
  // comment. YAML escapes a quote by doubling it ('' inside '...') or with a backslash (\" inside
  // "..."), so `'APPROVED'' # invalid'` is the single value `APPROVED' # invalid` — reading it as
  // `APPROVED` would pass a gate the artifact does not actually satisfy.
  if (raw[0] === '"' || raw[0] === "'") {
    const quote = raw[0];
    const chars: string[] = [];
    let i = 1;
    while (i < raw.length) {
      const ch = raw[i];
      if (quote === "'" && ch === "'" && raw.slice(i + 1, i + 2) === "'") {
        chars.push("'"); // '' -> literal '
        i += 2;
        continue;
      }
      if (quote === '"' && ch === "\\") {
        // Gate values are short enums that never legitimately need an escape, and decoding YAML's
        // escape table by hand is a way to be subtly wrong ("decli\ned" is NOT `declined`).
        return "";
      }
      if (ch === quote) {
        // Closing quote: only whitespace and an optional comment may follow.
        if (!restIsClean(raw.slice(i + 1))) return "";
        return chars.join("");
      }
      chars.push(ch);
      i += 1;
    }
    return ""; // unterminated quote
  }

  // Bare scalar: YAML only starts a comment at a '#' preceded by whitespace, so `enabled#1` is a
  // value while `enabled # note` is a value + comment.
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "#" && (i === 0 || raw[i - 1] === " " || raw[i - 1] === "\t")) {
      return strip(raw.slice(0, i));
    }
  }
  return raw;
}

/** (closed, raw_text_after_closing_quote) for a quoted scalar. Remainder is UNSTRIPPED. */
function quoteScan(value: string): [boolean, string] {
  const quote = value[0];
  let i = 1;
  while (i < value.length) {
    if (quote === "'" && value[i] === "'" && value.slice(i + 1, i + 2) === "'") {
      i += 2; // '' escape
      continue;
    }
    if (quote === '"' && value[i] === "\\") {
      i += 2; // \x escape
      continue;
    }
    if (value[i] === quote) return [true, value.slice(i + 1)];
    i += 1;
  }
  return [false, ""];
}

/** May this text follow a closing quote — i.e. nothing, or a real comment? */
function restIsClean(rest: string): boolean {
  if (rest === "") return true;
  const head = rest.slice(0, 1);
  if (head !== " " && head !== "\t") return false;
  const tail = strip(rest);
  return tail === "" || tail.startsWith("#");
}

// A gate artifact's top-level line is `key: scalar`. Anything outside that subset is refused.
const KEY_RE = /^[A-Za-z0-9_.\-]+$/;
const BLOCK_HEADER_RE = /^[|>][+-]?\d*\s*(#.*)?$/;
// Indicators that start something other than a plain scalar.
const NOT_PLAIN = new Set("!&*[]{}?%@`,>|".split(""));

/** Is this column-0 line inside the narrow `key: scalar` subset we support? An ALLOWLIST. */
function supportedLine(line: string): boolean {
  const idx = line.indexOf(":");
  if (idx === -1) return false; // not a mapping entry at all
  const key = line.slice(0, idx);
  const value = line.slice(idx + 1);
  if (!KEY_RE.test(key)) return false; // exotic key, or a `%TAG ...` directive
  if (value && value.slice(0, 1) !== " " && value.slice(0, 1) !== "\t") return false; // `key:value`

  const v = strip(value);
  if (!v || v.startsWith("#")) return true; // empty value, or value-less + comment
  if (BLOCK_HEADER_RE.test(v)) return true; // `|`, `>-`: content is indented, safe

  if (v[0] === '"' || v[0] === "'") {
    const [closed, rest] = quoteScan(v);
    if (!closed) return false; // captures the lines below
    if (v[0] === '"' && v.includes("\\")) return false; // escapes we deliberately don't decode
    return restIsClean(rest); // no trailing tokens, no `'x'#unspaced`
  }

  if (NOT_PLAIN.has(v[0])) return false;
  const cut = v.indexOf(" #");
  const plain = rstrip(cut === -1 ? v : v.slice(0, cut)); // drop a trailing comment
  if (plain.includes(": ") || plain.endsWith(":")) return false; // `foo: bar` as a value
  return true;
}

/** Is this frontmatter a flat mapping of scalars — i.e. safe to read line by line? */
function frontmatterIsFlat(frontmatter: string): boolean {
  for (const line of splitLines(frontmatter)) {
    if (!strip(line) || line.replace(/^\s+/u, "").startsWith("#")) continue;
    const head = line.slice(0, 1);
    if (head === " " || head === "\t") continue; // indented: belongs to a parent key
    if (!supportedLine(line)) return false;
  }
  return true;
}

/** Return the top-level scalar for `key`, or '' when absent or ambiguous. Fails closed. */
function frontmatterValue(frontmatter: string, key: string): string {
  if (!frontmatterIsFlat(frontmatter)) return "";

  const lines = splitLines(frontmatter);
  const matches: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Top-level keys only — an indented `codex_second_pass:` belongs to some nested mapping.
    if (!strip(line.slice(0, 1))) continue;
    if (line.replace(/^\s+/u, "").startsWith("#")) continue;
    if (!line.startsWith(`${key}:`)) continue;

    // A block mapping needs whitespace (or EOL) after the colon: `status:X` is NOT a key/value
    // pair, it's the plain scalar "status:X", so the document has no `status` key at all.
    const after = line.slice(key.length + 1);
    if (after && after.slice(0, 1) !== " " && after.slice(0, 1) !== "\t") continue;

    // A YAML plain scalar continues onto indented following lines, so
    //     status: APPROVED
    //       nope
    // is the single value `APPROVED nope`. Any indented continuation: fail closed.
    const nxt = i + 1 < lines.length ? lines[i + 1] : "";
    if (strip(nxt) && (nxt.slice(0, 1) === " " || nxt.slice(0, 1) === "\t")) return "";

    matches.push(yamlScalar(line.slice(line.indexOf(":") + 1)));
  }

  // Duplicate keys are ambiguous (real YAML rejects them) — block, don't guess.
  if (matches.length !== 1) return "";
  return matches[0];
}

function checkArtifactStatus(frontmatter: string, requiredStatus: string): boolean {
  const value = frontmatterValue(frontmatter, "status");
  return Boolean(value) && value.toUpperCase() === requiredStatus.toUpperCase();
}

/** Parse GATE_REQUIRE_FIELDS into [(key, allowedValuesOrNull), ...]. */
function parseRequiredFields(spec: string): Array<[string, Set<string> | null]> {
  const requirements: Array<[string, Set<string> | null]> = [];
  for (const rawEntry of spec.split(",")) {
    const entry = strip(rawEntry);
    if (!entry) continue;
    const idx = entry.indexOf(":");
    if (idx !== -1) {
      const key = entry.slice(0, idx);
      const values = entry.slice(idx + 1);
      const allowed = new Set(
        values
          .split("|")
          .map((v) => strip(v))
          .filter((v) => v)
          .map((v) => v.toLowerCase()),
      );
      requirements.push([strip(key), allowed.size ? allowed : null]);
    } else {
      requirements.push([entry, null]);
    }
  }
  return requirements;
}

/** Return human-readable problems for each unmet field requirement. */
function checkRequiredFields(frontmatter: string, spec: string): string[] {
  const problems: string[] = [];
  for (const [key, allowed] of parseRequiredFields(spec)) {
    const value = frontmatter ? frontmatterValue(frontmatter, key) : "";
    if (!value) {
      problems.push(`\`${key}\` is missing or empty`);
    } else if (allowed && !allowed.has(value.toLowerCase())) {
      const expected = [...allowed].sort().join(" | ");
      problems.push(`\`${key}: ${value}\` is not one of: ${expected}`);
    }
  }
  return problems;
}

/** Is the target file in an always-allowed directory? Mirrors Python's `Path(...).parts`. */
function isAllowedPath(filePath: string): boolean {
  const parts: string[] = [];
  if (filePath.startsWith("/")) parts.push("/");
  for (const p of filePath.split("/")) {
    if (p === "" || p === ".") continue;
    parts.push(p);
  }
  return parts.some((p) => ALWAYS_ALLOWED_DIRS.has(p));
}

export interface PhaseGateConfig {
  artifactPath: string;
  requiredStatus?: string;
  requiredFields?: string;
  gateDescription?: string;
  gateRemedy?: string;
  blockedTools?: readonly string[];
  alwaysAllowedDirectories?: readonly string[];
  readArtifactSnapshot?: (artifactPath: string) => string | null;
  beforeArtifactOpen?: () => void;
}

export interface PhaseGatePayload {
  tool_name?: unknown;
  tool_input?: unknown;
}

export type PhaseGateDecision = { kind: "allow" } | { kind: "deny"; reason: string };

function denyDecision(reason: string): PhaseGateDecision {
  return { kind: "deny", reason };
}

function realpathWithMissingLeaf(path: string): string {
  let existing = path;
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(basename(existing));
    existing = parent;
  }
  return missing.reduce((current, part) => join(current, part), realpathSync(existing));
}

function canonicalProjectPath(projectRoot: string, candidate: string): string | null {
  const root = realpathWithMissingLeaf(resolve(projectRoot));
  const lexicalTarget = resolve(root, candidate);
  const lexicalRelative = relative(root, lexicalTarget);
  if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)) {
    return null;
  }

  const target = realpathWithMissingLeaf(lexicalTarget);
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return target;
  return null;
}

function isCanonicalAllowedPath(
  projectRoot: string,
  filePath: string,
  allowedDirectories: readonly string[],
): boolean {
  const target = canonicalProjectPath(projectRoot, filePath);
  if (!target) return false;
  const root = resolve(projectRoot);
  return allowedDirectories.some((directory) => {
    const allowed = canonicalProjectPath(root, directory);
    return allowed !== null && (target === allowed || target.startsWith(`${allowed}${sep}`));
  });
}

export function evaluatePhaseGate(
  projectRoot: string,
  config: PhaseGateConfig,
  hookInput: PhaseGatePayload,
): PhaseGateDecision {
  const artifactPath = config.artifactPath && !isAbsolute(config.artifactPath)
    ? canonicalProjectPath(projectRoot, config.artifactPath)
    : null;
  const requiredStatus = config.requiredStatus ?? "";
  const requiredFields = config.requiredFields ?? "";
  const gateDescription = config.gateDescription ?? "Phase gate";
  const gateRemedy = config.gateRemedy ?? "Complete the previous phase first";
  const blockedTools = new Set(config.blockedTools ?? [...DEFAULT_BLOCKED_TOOLS]);
  const allowedDirectories = config.alwaysAllowedDirectories ?? [...ALWAYS_ALLOWED_DIRS];

  if (!config.artifactPath) return { kind: "allow" };
  const toolName = String(hookInput.tool_name ?? "");
  const toolInput = hookInput.tool_input && typeof hookInput.tool_input === "object" && !Array.isArray(hookInput.tool_input)
    ? hookInput.tool_input as Record<string, unknown>
    : {};
  if (!blockedTools.has(toolName)) return { kind: "allow" };

  const filePath = String(toolInput.file_path ?? "");
  if (filePath && isCanonicalAllowedPath(projectRoot, filePath, allowedDirectories)) {
    return { kind: "allow" };
  }

  if (isAbsolute(config.artifactPath) || artifactPath === null) {
    return denyDecision(
      `GATE BLOCKED: ${gateDescription} artifact path is not a canonical project-relative path.\n\n` +
        `Required: \`${config.artifactPath}\` must remain inside the canonical project root.\n\n` +
        `**Remedy:** ${gateRemedy}`,
    );
  }

  const artifactSnapshot = config.readArtifactSnapshot
    ? config.readArtifactSnapshot(artifactPath)
    : readArtifactSnapshot(artifactPath, config.beforeArtifactOpen);
  if (artifactSnapshot === null) {
    return denyDecision(
      `GATE BLOCKED: ${gateDescription} artifact missing.\n\n` +
        `Required: \`${config.artifactPath}\` — file does not exist.\n\n` +
        `This phase cannot proceed without the gate artifact from the ` +
        `previous phase. The artifact proves the gate actually ran — ` +
        `instructional text alone is not enforcement.\n\n` +
        `**Remedy:** ${gateRemedy}`,
    );
  }

  const frontmatter = parseFrontmatter(artifactSnapshot);
  if ((requiredStatus || requiredFields) && !frontmatterIsFlat(frontmatter)) {
    return denyDecision(
      `GATE BLOCKED: ${gateDescription} — artifact is not readable.\n\n` +
        `\`${config.artifactPath}\` does not parse as a flat YAML mapping of simple ` +
        `values: a line opens a flow collection (\`[\`, \`{\`) or leaves a quote ` +
        `unterminated, which captures the lines beneath it. The gate cannot ` +
        `tell what this file actually records, and evidence it cannot read ` +
        `is not evidence.\n\n` +
        `Fix the frontmatter so every top-level line is a plain \`key: value\` ` +
        `pair, then re-run the phase.\n\n` +
        `**Remedy:** ${gateRemedy}`,
    );
  }

  if (requiredStatus && !checkArtifactStatus(frontmatter, requiredStatus)) {
    return denyDecision(
      `GATE BLOCKED: ${gateDescription} — wrong status.\n\n` +
        `Required: \`${config.artifactPath}\` with \`status: ${requiredStatus}\`\n` +
        `The file exists but does not have the required status.\n\n` +
        `**Remedy:** ${gateRemedy}`,
    );
  }

  if (requiredFields) {
    const problems = checkRequiredFields(frontmatter, requiredFields);
    if (problems.length) {
      const detail = problems.map((problem) => `- ${problem}`).join("\n");
      return denyDecision(
        `GATE BLOCKED: ${gateDescription} — required decision not recorded.\n\n` +
          `In \`${config.artifactPath}\`:\n${detail}\n\n` +
          `The status says this phase passed, but a decision it was required ` +
          `to record is missing or unrecognized. A phase that reports success ` +
          `without recording what it decided cannot be audited afterwards — ` +
          `'it probably ran' is not evidence that it ran.\n\n` +
          `**Remedy:** ${gateRemedy}`,
      );
    }
  }

  return { kind: "allow" };
}

export const phaseGateFrontmatter = {
  read: readFrontmatter,
  value: frontmatterValue,
};
