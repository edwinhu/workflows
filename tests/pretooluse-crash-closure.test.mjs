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

// THE ONE EXEMPTION, AND WHY IT IS NOT A HOLE.
//
// The rule above is "a throw must not become a SILENT allow" — silence is the defect, not the allow.
// Every gate here refuses something, so a crash that permits the call is unrecoverable and denying is
// the only safe response. `work-implement-observation` is not a gate: it OBSERVES. Denying an
// implementation dispatch because our own git capture threw would deny work the plan authorised, for
// a bug in the observer.
//
// Its crash is not silent, and that is the whole justification: a crash writes no record, and
// `scripts/beat/implement-gate.ts` treats a MISSING record as a refusal of the entire wave. So a
// throw here fails the run loudly one step later instead of permitting it forever. That is a
// different mechanism reaching the same guarantee, not a weaker guarantee.
//
// THIS EXEMPTION WAS UNSAFE UNTIL v5.106.1. The gate did not exist, and the hook was registered
// nowhere at all — expectation files were written and never read. An exemption is only ever as good
// as the thing it defers to, so the coverage is ASSERTED below rather than asserted-by-comment.
const DEFERS_TO_ABSENCE_GATE = { "work-implement-observation": "scripts/beat/implement-gate.ts" };

for (const [hook, gatePath] of Object.entries(DEFERS_TO_ABSENCE_GATE)) {
  const gateSource = readFileSync(join(REPO, gatePath), "utf8");
  assert.match(gateSource, new RegExp(hook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${hook} is exempt from denyOnCrash because ${gatePath} catches its silence — but that gate does not reference it`);
  assert.match(gateSource, /missing-pre|ABSENCE/,
    `${gatePath} must treat a MISSING record as a refusal; without that, exempting ${hook} restores the silent allow`);
  // And the gate's own suite must cover the no-records case, which is the shape a crashed hook leaves.
  const gateTest = readFileSync(join(REPO, "tests/implement-gate.test.mjs"), "utf8");
  assert.match(gateTest, /unobserved wave is REFUSED/,
    `tests/implement-gate.test.mjs must assert an unobserved wave is refused; that assertion is what this exemption rests on`);
}

for (const gate of gates) {
  if (gate in DEFERS_TO_ABSENCE_GATE) continue;
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

// EFFECT, NOT INSTALLATION. Everything above this line is satisfied by a gate that CALLS
// `denyOnCrash` and then defeats it, and fourteen gates did exactly that: `try { JSON.parse(await
// Bun.stdin.text()) } catch { process.exit(0) }`. The handler covers throws that ESCAPE, and a local
// catch means none does. Measured at e225afb — `phase-gate-guard` returned exit 0 with NO OUTPUT on
// `null`, on `[1,2]`, and on unparseable stdin; `writing-mechanical-gate` did the same for arrays
// and strings. That is a silent ALLOW on every malformed payload, from gates whose headers promise
// they fail closed, and this file passed the whole time because it only asserted the exit code.
//
// So the assertion is now the DECISION: a gate that cannot read its payload must emit a deny. Exit 0
// remains asserted alongside it and is not the point — an exit-0 gate that prints nothing is the
// failure mode, not the success one. Empty stdin is included because it is the shape a misconfigured
// wiring actually produces.
//
// Gates that take a `--workflow` argument are given one; passing none would put the two
// `*-outline-executable-guard` gates into their CLI self-check mode, which legitimately exits 1.
// `GATE_ARTIFACT` is set because `phase-gate-guard` short-circuits to allow without it, and a probe
// that never reaches the payload read asserts nothing about the payload read.
for (const gate of gates) {
  const source = readFileSync(join(REPO, "hooks", `${gate}.ts`), "utf8");
  const args = /workflowFromArg|--workflow/.test(source) ? ["--workflow", "dev"] : [];
  const env = { ...process.env, GATE_ARTIFACT: ".planning/phase-gate-probe.md" };
  for (const raw of ["null", '"sess"', "[1,2]", "{not json", ""]) {
    const result = spawnSync("bun", [join(REPO, "hooks", `${gate}.ts`), ...args], { input: raw, encoding: "utf8", cwd: REPO, env });
    // The exit-code half applies to EVERY wired hook without exception, exempt or not: a non-zero
    // PreToolUse exit is a silent allow no matter what the hook is for. Only the DENY half below is
    // exempted, and only for observers whose silence a downstream absence-gate catches.
    assert.equal(result.status, 0, `${gate} exited ${result.status} on payload ${JSON.stringify(raw)}; a non-zero PreToolUse exit is a silent allow. stderr: ${result.stderr}`);
    if (gate in DEFERS_TO_ABSENCE_GATE) continue;
    assert.match(
      result.stdout,
      /"permissionDecision": "deny"/,
      `${gate} did not DENY on the malformed payload ${JSON.stringify(raw)} — it exited 0 with ${result.stdout ? `output ${result.stdout}` : "no output"}, which is a silent allow. A gate that cannot read its payload cannot decide, and a gate that cannot decide denies.`,
    );
  }
}

console.log(`pretooluse-crash-closure tests passed (${gates.length} PreToolUse gates)`);
