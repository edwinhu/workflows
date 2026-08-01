/**
 * NO PRODUCTION CODE READS process.env.CLAUDE_SESSION_ID.
 *
 * WHY A TEXTUAL SCAN IS THE RIGHT INSTRUMENT HERE, AND NOT A CONFESSION OF LAZINESS
 *
 * (The scan is performed in-process with readFileSync and the patterns below — it does not shell out
 * to an external search tool, which `references/constraints/real-test-enforcement.py` forbids as a
 * test assertion. The distinction that matters is not the mechanism but the claim: this file asserts
 * the ABSENCE of a construct across the tree, which no behavioural test can do.)
 *   Claude Code never sets CLAUDE_SESSION_ID. Reading it yields `undefined`, and every use in this
 *   repo was a COMPARISON against an identity — so the comparison failed, the gate denied, and the
 *   denial looked exactly like a legitimate one. Nothing crashed and nothing logged. The behavioural
 *   tests that should have caught it did not, because each one INJECTED the variable into the child
 *   environment and therefore tested a world production does not have.
 *
 *   The defect is textual and it RECURRED: two independent sessions, months apart, wrote
 *   `process.env.CLAUDE_SESSION_ID` into four separate call sites (reviewer-verdict-guard,
 *   approved-artifact-gate, beat-implement, and the three DS flag hooks), and the second session
 *   reintroduced it into brand-new code paths (`validateGeneratedPlanArtifact`) while the first
 *   session's fix was still unmerged. A behavioural test can only prove that the sites it knows
 *   about behave; only a textual check can prove that no NEW site was added. Both are needed, and
 *   the behavioural ones live in tests/reviewer-identity-contract.test.mjs,
 *   tests/implementer-identity-contract.test.mjs, and tests/workflow-policy-contract.test.ts.
 *
 * WHAT IS ALLOWED, EXPLICITLY
 *   - Comments and documentation NAMING the variable to explain why it must not be read. Forbidding
 *     the string outright would delete the explanations that stop the next reintroduction.
 *   - Tests that DELETE it from a child environment to reproduce production's actual conditions.
 *   - `${CLAUDE_SESSION_ID}` inside SKILL.md bodies: that is Claude Code's own skill-content
 *     substitution, performed by the harness before the body is ever read, and is unrelated to the
 *     process environment of a hook. See .claude/CLAUDE.md.
 *
 *   What is forbidden is exactly one thing: production code READING it at runtime.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import assert from "node:assert";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Directories that ship as the plugin's runtime. `tests/` is deliberately absent. */
const PRODUCTION_DIRECTORIES = ["hooks", "workflows", "scripts", "bin", "agents", "skills", "references", "policy", "commands"];
const CODE = /\.(ts|js|mjs|cjs|py|sh)$/;

/**
 * A READ of the variable, not a mention of it.
 *
 * `process.env.CLAUDE_SESSION_ID`, `process.env["CLAUDE_SESSION_ID"]`, `os.environ[...]`,
 * `os.environ.get(...)`, `getenv(...)`, and shell `$CLAUDE_SESSION_ID` / `${CLAUDE_SESSION_ID}`
 * expansion. CLAUDE_CODE_SESSION_ID is a DIFFERENT, real variable and must not match: the trailing
 * `(?!_)`-equivalent is handled by anchoring on the exact name with a boundary on both sides.
 */
const READ_PATTERNS = [
  /process\s*\.\s*env\s*\.\s*CLAUDE_SESSION_ID\b/,
  /process\s*\.\s*env\s*\[\s*["'`]CLAUDE_SESSION_ID["'`]\s*\]/,
  /os\s*\.\s*environ\s*(?:\[\s*["']CLAUDE_SESSION_ID["']\s*\]|\.\s*get\s*\(\s*["']CLAUDE_SESSION_ID["'])/,
  /\bgetenv\s*\(\s*["']CLAUDE_SESSION_ID["']/,
];

/** Shell expansion. Excluded in Markdown, where `${CLAUDE_SESSION_ID}` is skill-content substitution. */
const SHELL_EXPANSION = /\$\{?CLAUDE_SESSION_ID\}?/;

function* codeFiles(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      yield* codeFiles(path);
    } else if (entry.isFile() && CODE.test(entry.name) && statSync(path).size < 4 * 1024 * 1024) {
      yield path;
    }
  }
}

const offenders = [];
for (const directory of PRODUCTION_DIRECTORIES) {
  for (const path of codeFiles(join(REPO, directory))) {
    const text = readFileSync(path, "utf8");
    if (!text.includes("CLAUDE_SESSION_ID")) continue;
    text.split("\n").forEach((line, index) => {
      // A line that only NAMES the variable in prose is the documentation this check depends on.
      const stripped = line.replace(/^\s*(?:\/\/|\/?\*+|#)\s?.*$/, "");
      const candidate = stripped || line;
      const isComment = stripped === "" && line.trim() !== "";
      if (isComment) return;
      const matched = READ_PATTERNS.some(pattern => pattern.test(candidate))
        || (path.endsWith(".sh") && SHELL_EXPANSION.test(candidate));
      if (matched) offenders.push(`${relative(REPO, path)}:${index + 1}: ${line.trim()}`);
    });
  }
}

assert.deepEqual(
  offenders,
  [],
  `Production code must never read process.env.CLAUDE_SESSION_ID — Claude Code does not set it, so `
  + `every read is \`undefined\` and every comparison against it denies silently. Derive identity from `
  + `the PreToolUse stdin payload via hookActorIdentity(), or from CLAUDE_CODE_SESSION_ID when a `
  + `session-TREE-wide id is what is actually wanted (a dispatcher, never a reviewer or `
  + `implementer). Offending reads:\n  ${offenders.join("\n  ")}`,
);

/**
 * The check must be able to FAIL. A pattern list that matches nothing is indistinguishable from a
 * clean tree, and that is precisely how the original defect survived its own test suite.
 */
for (const sample of [
  `const s = process.env.CLAUDE_SESSION_ID ?? "x";`,
  `const s = process.env["CLAUDE_SESSION_ID"];`,
  `s = os.environ["CLAUDE_SESSION_ID"]`,
  `s = os.environ.get("CLAUDE_SESSION_ID", "")`,
  `char *s = getenv("CLAUDE_SESSION_ID");`,
]) {
  assert.ok(READ_PATTERNS.some(pattern => pattern.test(sample)), `pattern list fails to detect a real read: ${sample}`);
}

/** The real variable must NOT trip it, or the check would forbid the correct replacement. */
for (const sample of [
  `const s = process.env.CLAUDE_CODE_SESSION_ID;`,
  `const s = process.env["CLAUDE_CODE_SESSION_ID"];`,
  `s = os.environ.get("CLAUDE_CODE_SESSION_ID")`,
]) {
  assert.ok(!READ_PATTERNS.some(pattern => pattern.test(sample)), `pattern list wrongly flags the real variable: ${sample}`);
}

console.log("dead-session-variable tests passed");
