/**
 * EVERY PreToolUse GATE DENIES ON CRASH. A non-zero exit is a silent allow, not a loud death.
 *
 * Claude Code treats a hook that exits non-zero as NON-BLOCKING: the message goes to stderr and the
 * tool call proceeds. So an unhandled throw in a PreToolUse gate permits exactly the call the gate
 * exists to refuse. Round 9 wired `denyOnCrash` into two gates and left the other sixteen — including
 * `orchestrator-mutation-guard`, the mutation boundary, and `reviewer-verdict-guard` itself — fail-open,
 * on the belief that a parity re-baseline would be needed. It was not: only three goldens pin exit-1
 * crash semantics (`writing-suggest-verify`, `overflow-check`, `ds-post-subagent-guard`) and all three
 * are PostToolUse, where a non-zero exit is not a silent allow. Parity stayed 34/34.
 *
 * THE WIRING IS THE SOURCE OF TRUTH, not a hand-maintained list. A gate added to `hooks/hooks.json`
 * or to a skill's `PreToolUse:` frontmatter without `denyOnCrash` fails here, which is the only way
 * this stays true after the next gate is written.
 *
 * Run: bun test tests/pretooluse-crash-closure.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;

/** Hook scripts wired to a given event, read from the plugin manifest and every skill's frontmatter. */
function wiredHooks(event) {
  const found = new Set();
  const manifest = JSON.parse(readFileSync(join(REPO, "hooks", "hooks.json"), "utf8")).hooks;
  for (const group of manifest[event] ?? []) {
    for (const hook of group.hooks ?? []) {
      const match = /hooks\/([A-Za-z0-9_-]+)\.ts/.exec(hook.command ?? "");
      if (match) found.add(match[1]);
    }
  }
  for (const skill of readdirSync(join(REPO, "skills"), { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    let text;
    try { text = readFileSync(join(REPO, "skills", skill.name, "SKILL.md"), "utf8"); } catch { continue; }
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!frontmatter) continue;
    // Track the two-space-indented event key the following hook lines belong to.
    let current = null;
    for (const line of frontmatter[1].split("\n")) {
      const key = /^ {2}([A-Za-z]+):\s*$/.exec(line);
      if (key) current = key[1];
      const hook = /hooks\/([A-Za-z0-9_-]+)\.ts/.exec(line);
      if (hook && current === event) found.add(hook[1]);
    }
  }
  return [...found].sort();
}

const gates = wiredHooks("PreToolUse");
assert.ok(gates.length >= 18, `expected the full PreToolUse gate set, found ${gates.length}: ${gates}`);
// The two the fix started from and the two the reviewers named as the worst omissions.
for (const required of ["implementer-identity-gate", "approved-artifact-gate", "orchestrator-mutation-guard", "reviewer-verdict-guard"]) {
  assert.ok(gates.includes(required), `${required} must be discovered as a PreToolUse gate`);
}

for (const gate of gates) {
  const source = readFileSync(join(REPO, "hooks", `${gate}.ts`), "utf8");
  assert.match(source, /\bdenyOnCrash\(/, `${gate} is wired to PreToolUse but never calls denyOnCrash, so any throw in it is a silent allow`);

  // ORDER MATTERS. The handler covers only what runs after it, so a gate that reads stdin first
  // leaves its own parse and every check reachable from it uncovered.
  const installed = source.search(/^denyOnCrash\(/m);
  const firstRead = source.search(/readPayload\(\)|parsePayload\(|Bun\.stdin/);
  assert.ok(installed >= 0, `${gate} must call denyOnCrash as a top-level statement`);
  assert.ok(firstRead < 0 || installed < firstRead, `${gate} installs denyOnCrash after it reads stdin, leaving the read uncovered`);
}

// PostToolUse hooks must NOT install it: three goldens pin their exit-1 semantics, and there a
// non-zero exit is not a silent allow. This is the half that makes the flag meaningful.
for (const hook of wiredHooks("PostToolUse")) {
  const source = readFileSync(join(REPO, "hooks", `${hook}.ts`), "utf8");
  assert.doesNotMatch(source, /\bdenyOnCrash\(/, `${hook} is PostToolUse and must keep its exit-code parity semantics`);
}

// BEHAVIOURAL, not just structural: a payload that is valid JSON but not an object must never
// produce a non-zero exit from a PreToolUse gate. `requireObject` used to `process.exit(1)` here
// and the header defended it as "dying loudly" — which, per the paragraph above it, IS the silent
// allow. Gates that take a `--workflow` argument are given one; passing none would put the two
// `*-outline-executable-guard` gates into their CLI self-check mode, which legitimately exits 1.
for (const gate of gates) {
  const source = readFileSync(join(REPO, "hooks", `${gate}.ts`), "utf8");
  const args = /workflowFromArg|--workflow/.test(source) ? ["--workflow", "dev"] : [];
  for (const raw of ["null", '"sess"', "[1,2]"]) {
    const result = spawnSync("bun", [join(REPO, "hooks", `${gate}.ts`), ...args], { input: raw, encoding: "utf8", cwd: REPO });
    assert.equal(result.status, 0, `${gate} exited ${result.status} on payload ${raw}; a non-zero PreToolUse exit is a silent allow. stderr: ${result.stderr}`);
  }
}

console.log(`pretooluse-crash-closure tests passed (${gates.length} PreToolUse gates)`);
