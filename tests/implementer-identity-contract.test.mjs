/**
 * The IMPLEMENTING actor must differ from the APPROVING actor — enforced where that identity exists.
 *
 * A PreToolUse payload for the parent conversation's `Agent` dispatch carries NO agent_id, so the
 * dispatching call cannot name the implementer: the implementer subagent does not exist yet. Reading
 * the dispatcher as "the implementer" is what forced the three-way rule to be relaxed, because in
 * single-conversation /dev the approver IS the dispatcher.
 *
 * The implementer's own identity first exists on ITS OWN tool calls, which carry its distinct
 * agent_id (real captured example: "a850db797eebd9" alongside agent_type). Skill-scoped hooks do NOT
 * propagate into dispatched subagents — only plugin/settings-level hooks do — so the check lives in
 * a plugin-wide PreToolUse mutation hook that no-ops outside a governed project.
 *
 * Run: bun test tests/implementer-identity-contract.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;
const GATE = join(REPO, "hooks", "implementer-identity-gate.ts");
const DISPATCH = join(REPO, "hooks", "approved-artifact-gate.ts");

const planFile = "jazzy-leaping-scroll.md";
const plan = "# Exact generated plan\n";
const hash = createHash("sha256").update(plan).digest("hex");

const SESSION = "sess-tree-abc";
const REVIEWER_AGENT = "a850df8db797eebd9";
const IMPLEMENTER_AGENT = "b91ef00dcafe12345";
const REVIEWER_ACTOR = `${SESSION}#${REVIEWER_AGENT}`;

/** Environment as Claude Code actually provides it: CLAUDE_SESSION_ID is absent. */
function productionEnv() {
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CODE_ENTRYPOINT: "cli" };
  delete env.CLAUDE_SESSION_ID;
  return env;
}

function receipt(overrides = {}) {
  return JSON.stringify({
    workflow: "dev",
    plan_file: planFile,
    plan_hash: hash,
    approved_session_id: SESSION,
    approved_at: "2026-01-01T00:00:00.000Z",
    status: "APPROVED",
    reviewer_session_id: REVIEWER_ACTOR,
    reviewed_at: "2026-01-01T00:01:00.000Z",
    ...overrides,
  }, null, 2);
}

/**
 * PRESENCE OF THE KEY IS THE SIGNAL, for every field whose absence is meaningful.
 *
 * `agentId: undefined` CANNOT mean "conversation-level" through a default parameter — JS applies the
 * default to an explicitly-passed undefined, so the original `runGate(cwd, { agentId: undefined })`
 * silently sent the implementer's agent_id and the parent-conversation case was never exercised at
 * all.
 *
 * `command` had no default at all, so any future `{ tool: "Bash" }` case that forgot to pass one
 * produced `tool_input: {}` — a Bash payload with no command. Under the old denylist that classified
 * CLEAN and became a silent ALLOW: a test row that looked like it asserted a denial while asserting
 * nothing. The gate now refuses a command-less Bash payload outright, and this helper makes the
 * omission impossible to write by accident.
 */
function optional(options, key, fallback) {
  return Object.hasOwn(options, key) ? options[key] : fallback;
}

function payloadFor(cwd, options = {}) {
  const { tool = "Write", sessionId = SESSION, omitSession = false, path = join(cwd, "src", "a.ts"), extra = {} } = options;
  const agentId = optional(options, "agentId", IMPLEMENTER_AGENT);
  if (tool === "Bash" && !Object.hasOwn(options, "command")) throw new Error("a Bash case must pass an explicit `command`");
  const command = optional(options, "command", "");
  const stdin = {
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: tool === "Bash" ? { command } : { file_path: path, content: "export const a = 1;\n" },
    tool_use_id: "toolu_9",
    ...extra,
  };
  if (!omitSession) stdin.session_id = sessionId;
  if (agentId !== undefined) { stdin.agent_id = agentId; stdin.agent_type = "workflows:dev-implementer"; }
  return stdin;
}

function runGate(cwd, options = {}) {
  const input = options.rawInput ?? JSON.stringify(payloadFor(cwd, options));
  return spawnSync("bun", [GATE], { cwd, env: productionEnv(), input, encoding: "utf8" });
}

function runDispatch(cwd, { workflow = "dev", sessionId = SESSION, agentId = undefined } = {}) {
  const stdin = { session_id: sessionId, transcript_path: join(cwd, "transcript.jsonl"), cwd, permission_mode: "default", hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "workflows:dev-implementer" }, tool_use_id: "toolu_2" };
  if (agentId !== undefined) { stdin.agent_id = agentId; stdin.agent_type = "workflows:dev-implementer"; }
  return spawnSync("bun", [DISPATCH, "--workflow", workflow], { cwd, env: productionEnv(), input: JSON.stringify(stdin), encoding: "utf8" });
}

function allowed(result, message) {
  assert.equal(result.status, 0, `${message}: exit ${result.status} ${result.stderr}`);
  assert.doesNotMatch(result.stdout, /"permissionDecision": "deny"/, `${message}: ${result.stdout}`);
}
function denied(result, message, pattern) {
  assert.equal(result.status, 0, `${message}: exit ${result.status} ${result.stderr}`);
  assert.match(result.stdout, /"permissionDecision": "deny"/, `${message}: ${result.stdout}`);
  if (pattern) assert.match(result.stdout, pattern, `${message}: ${result.stdout}`);
}

const cwd = mkdtempSync(join(tmpdir(), "implementer-identity-"));
try {
  const planning = join(cwd, ".planning");
  const state = join(planning, ".state");
  mkdirSync(state, { recursive: true });
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(planning, planFile), plan);
  const write = (overrides = {}) => writeFileSync(join(state, "review.json"), receipt(overrides));
  write();

  // ---------------------------------------------------------------------------------------------
  // THE RESTORED INVARIANT: approver != implementer.
  // ---------------------------------------------------------------------------------------------

  // A distinct implementer subagent is the normal case and must be admitted, so the invariant is
  // satisfiable in single-conversation /dev: approver "S", reviewer "S#R", implementer "S#I".
  allowed(runGate(cwd), "a distinct implementer subagent may mutate under an APPROVED receipt");

  // The approving actor may not also be the implementing actor. When approval was taken inside a
  // subagent, that same subagent is the approver and is refused.
  write({ approved_session_id: `${SESSION}#${IMPLEMENTER_AGENT}` });
  denied(runGate(cwd), "the approving actor may not implement", /approval and implementation actors must differ/i);
  write();

  // The reviewing actor may not also be the implementing actor.
  denied(runGate(cwd, { agentId: REVIEWER_AGENT }), "the reviewing actor may not implement", /review and implementation actors must differ/i);

  // ---------------------------------------------------------------------------------------------
  // ABSENT agent_id: the parent-conversation case, and the bypass it used to open.
  //
  // Deferring entirely to `orchestrator-mutation-guard` here was a hole, not a delegation: that
  // guard is skill-scoped, so it is absent the moment the conversation leaves the skill and was
  // never wired for `work` at all. The APPROVING conversation could therefore write arbitrary
  // project code with no gate firing anywhere.
  // ---------------------------------------------------------------------------------------------

  // The approving conversation may NOT write project code, whatever tool it reaches for.
  denied(runGate(cwd, { agentId: undefined }), "the approving conversation may not write project code", /approved .* and may not also implement/i);
  // ...but it keeps the orchestrator's own narrow write surface, or planning deadlocks.
  allowed(runGate(cwd, { agentId: undefined, path: join(cwd, ".planning", "notes.md") }), "the approving conversation may still write .planning");
  allowed(runGate(cwd, { agentId: undefined, path: join(cwd, ".claude", "settings.json") }), "the approving conversation may still write .claude");
  // A conversation-level actor that neither approved nor reviewed is an ordinary third party.
  allowed(runGate(cwd, { sessionId: "sess-unrelated", agentId: undefined }), "an unrelated conversation is not gated");

  // ---------------------------------------------------------------------------------------------
  // EVERY WRITE-CAPABLE TOOL, NOT JUST THE THREE THAT WERE LISTED.
  //
  // `MultiEdit` was absent from FILE_TOOLS and from the hooks.json matcher. Per the hooks
  // reference, a matcher of only letters/digits/`_`/`-`/spaces/`,`/`|` is an EXACT string list, NOT
  // a regex, so `Edit|Write|NotebookEdit|Bash` never matched `MultiEdit` and the hook was NEVER
  // INVOKED for it — not "invoked and fell through to allow()", which is what an earlier version of
  // this comment claimed. Measured: MultiEdit of `src/a.ts` from the approving conversation landed
  // with no gate decision recorded at all, while the identical Edit was denied. Both the tool set
  // below and the matcher have to name the tool; neither alone is sufficient.
  // ---------------------------------------------------------------------------------------------

  for (const tool of ["Write", "Edit", "MultiEdit"]) {
    denied(runGate(cwd, { tool, agentId: undefined }), `the approving conversation may not ${tool}`, /may not also implement/i);
    allowed(runGate(cwd, { tool, agentId: undefined, path: join(cwd, ".planning", "notes.md") }), `${tool} to .planning is still permitted`);
  }
  // NotebookEdit names its target `notebook_path`, so reading `file_path` for it authorizes nothing.
  denied(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, { tool: "NotebookEdit", agentId: undefined }), tool_input: { notebook_path: join(cwd, "src", "a.ipynb") } }) }), "NotebookEdit of project code", /may not also implement/i);
  allowed(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, { tool: "NotebookEdit", agentId: undefined }), tool_input: { notebook_path: join(cwd, ".planning", "a.ipynb") } }) }), "NotebookEdit under .planning is still permitted");

  // ---------------------------------------------------------------------------------------------
  // HARD LINK: an alias `realpath` cannot see.
  //
  // `ln src/a.ts .planning/alias.ts` produces a permitted, fully canonical, containment-passing
  // project-relative path whose Write truncates the SHARED inode — so the bytes land in `src/a.ts`
  // while the prefix check reads `.planning/`. Canonicalization closed the symlink version of this
  // and cannot close this one, because there is no canonical form that distinguishes the two names.
  // ---------------------------------------------------------------------------------------------

  writeFileSync(join(cwd, "src", "linked.ts"), "export const a = 1;\n");
  linkSync(join(cwd, "src", "linked.ts"), join(planning, "alias.ts"));
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "alias.ts") }), "hard link from .planning into src", /may not also implement/i);
  // The denial must SAY it is the aliasing rule. It previously rendered as "the orchestrator may
  // only write .planning, .claude" for a file already inside `.planning` — a message whose obvious
  // reading is "the permitted list is wrong", and whose obvious fix reopens the escape.
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "alias.ts") }), "hard link denial is self-diagnosing", /HARD LINK/);
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "alias.ts") }), "hard link denial disclaims the permitted list", /not a permitted-directory problem/);

  // ---------------------------------------------------------------------------------------------
  // BASH: matching only Write|Edit|NotebookEdit left `echo payload > src/a.js` completely ungated.
  //
  // ROUND 8 CHANGED THE SHAPE OF THIS SECTION, and the change is the point. It used to assert two
  // things: mutating commands deny, read-only commands ALLOW. That second assertion is gone —
  // deliberately, not by neglect — because a restricted actor now gets no Bash whatsoever. Three
  // rounds of trying to draw the line between those two sets produced three rounds of live RCE, so
  // the line is no longer drawn. `tests/restricted-actor-bash.test.mjs` carries the full corpus and
  // the UX bill; what stays HERE is the identity contract: which ACTOR, not which command.
  // ---------------------------------------------------------------------------------------------

  for (const command of [
    // Mutating, as before.
    'echo "payload" > src/a.js',
    "cp /etc/hostname src/a.js",
    "sed -i 's/a/b/' src/a.js",
    "rm src/a.js",
    `python3 -c "open('src/a.js','w').write('x')"`,
    "perl -pi -e 's/a/b/' src/a.js",
    "git checkout -- src/a.js",
    // ...and the read-only commands that used to be asserted as ALLOWED right below. They are in
    // the SAME loop now because the gate cannot tell them apart and no longer tries.
    "git status", "bun test tests/x.test.ts", "rg foo -n", "ls -la", "cat src/a.js",
    "npm test > /dev/null",
  ]) {
    denied(runGate(cwd, { tool: "Bash", command, agentId: undefined }), `approving conversation via Bash: ${command}`, /may not execute commands under it/i);
    denied(runGate(cwd, { tool: "Bash", command, agentId: REVIEWER_AGENT }), `reviewing subagent via Bash: ${command}`, /may not execute commands under it/i);
  }
  // A distinct implementer subagent is UNAFFECTED — both the mutating and the read-only forms. This
  // is what keeps the denial above honest: "dispatch a separate agent" is only sound advice if the
  // dispatched agent can actually run the command.
  for (const command of ["cp /etc/hostname src/a.js", "git status", "bun test tests/x.test.ts"]) {
    allowed(runGate(cwd, { tool: "Bash", command }), `a distinct implementer subagent may run: ${command}`);
    allowed(runGate(cwd, { tool: "Bash", command, sessionId: "sess-unrelated", agentId: undefined }), `an unrelated conversation may run: ${command}`);
  }

  // The dispatch gate admits the parent whose session approved the plan: the implementer it is
  // about to create is a fresh subagent, not the parent. Without this the whole flow deadlocks.
  allowed(runDispatch(cwd), "the approving conversation may dispatch implementation");
  // A subagent that IS the approver may not dispatch implementation-capable work for itself.
  write({ approved_session_id: `${SESSION}#${IMPLEMENTER_AGENT}` });
  denied(runDispatch(cwd, { agentId: IMPLEMENTER_AGENT }), "an approving subagent may not dispatch as implementer", /approval and implementation actors must differ/i);
  write();

  // null agent_id is a conversation-level call, NOT a malformed one — it must behave exactly like
  // an absent key rather than resolving to some third identity.
  allowed(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, { agentId: undefined, path: join(cwd, ".planning", "notes.md") }), agent_id: null }) }), "null agent_id equals an absent agent_id");
  denied(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, { agentId: undefined }), agent_id: null }) }), "null agent_id gets the conversation-level rule, not a third identity", /may not also implement/i);

  // ---------------------------------------------------------------------------------------------
  // SYMLINK ESCAPE FROM A PERMITTED DIRECTORY.
  //
  // The permitted-directory check compared the project-relative PREFIX of a path that had only been
  // checked for a literal `..`. So the approving conversation could create `.planning/out -> ../src`
  // and write `.planning/out/a.ts`: the prefix read `.planning/`, the gate allowed, and the bytes
  // landed in `src/a.ts`. `.claude` is permitted by every workflow and gave the same escape, with
  // the extra step of then running what was written as an opaque executable.
  // ---------------------------------------------------------------------------------------------

  symlinkSync("../src", join(planning, "escape"));
  symlinkSync("../..", join(planning, "up"));
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  symlinkSync("../src", join(cwd, ".claude", "escape"));
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "escape", "a.ts") }), "symlinked .planning subdirectory pointing at src", /may not also implement/i);
  denied(runGate(cwd, { agentId: undefined, path: join(cwd, ".claude", "escape", "a.ts") }), "symlinked .claude subdirectory pointing at src", /may not also implement/i);
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "escape", "nested", "a.ts") }), "escape through a symlinked ancestor", /may not also implement/i);
  // Escaping the project entirely fails containment outright.
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "up", "outside.ts") }), "symlink out of the project", /may not also implement/i);
  // A leaf symlink is judged by where it points, not by the name used to reach it.
  symlinkSync(join(cwd, "src", "a.ts"), join(planning, "leaf.md"));
  denied(runGate(cwd, { agentId: undefined, path: join(planning, "leaf.md") }), "leaf symlink into src", /may not also implement/i);
  // ...and ordinary, honest paths under the permitted directories still work, including new files.
  allowed(runGate(cwd, { agentId: undefined, path: join(planning, "real", "notes.md") }), "a genuine new .planning subdirectory is still writable");

  // ---------------------------------------------------------------------------------------------
  // IDENTITY IS RESOLVED BEFORE THE COMMAND IS CLASSIFIED.
  //
  // The gate used to classify the Bash command FIRST and allow on a clean classification, ahead of
  // the identity check entirely. Any miss in the classifier — a denylist over an undecidable
  // question — was therefore a full bypass, and a payload with NO identity at all was admitted so
  // long as its command happened to look clean.
  // ---------------------------------------------------------------------------------------------

  // `make install` is unclassifiable: `make` is opaque, and `install` is only an argument to it.
  denied(runGate(cwd, { tool: "Bash", command: "make install", omitSession: true, agentId: undefined }), "identity-less payload running an unclassified command", /identity/i);
  denied(runGate(cwd, { tool: "Bash", command: "git status", omitSession: true, agentId: undefined }), "identity-less payload running a read-only command", /identity/i);
  // ...but a non-mutating TOOL is still not this hook's business, identity or no identity.
  allowed(runGate(cwd, { tool: "Read", omitSession: true, agentId: undefined }), "identity-less payload using a non-mutating tool");

  // ---------------------------------------------------------------------------------------------
  // DELIMITER INJECTION: no actor may spell another actor's composite identity.
  // ---------------------------------------------------------------------------------------------

  // A subagent whose agent_id contains the separator could otherwise compose a string equal to a
  // different (session, agent) pair. The identity must be refused outright, not normalized.
  denied(runGate(cwd, { agentId: `${REVIEWER_AGENT}#x` }), "agent_id containing the separator", /identity/i);
  denied(runGate(cwd, { sessionId: `${SESSION}#${REVIEWER_AGENT}`, agentId: undefined }), "session_id containing the separator", /identity/i);
  // The classic forgery: session "a" + agent "b#c" vs session "a#b" + agent "c" must never collide.
  denied(runGate(cwd, { sessionId: SESSION, agentId: `${REVIEWER_AGENT}#tail` }), "composite forgery via agent_id", /identity/i);

  // ---------------------------------------------------------------------------------------------
  // MALFORMED / PARTIAL PAYLOADS fail CLOSED inside a governed project.
  // ---------------------------------------------------------------------------------------------

  denied(runGate(cwd, { omitSession: true }), "payload with no session_id", /identity/i);
  denied(runGate(cwd, { sessionId: "" }), "payload with an empty session_id", /identity/i);
  denied(runGate(cwd, { sessionId: "   " }), "payload with a blank session_id", /identity/i);
  denied(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd), session_id: 17 }) }), "non-string session_id", /identity/i);
  denied(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd), agent_id: 17 }) }), "non-string agent_id", /identity/i);
  denied(runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd), agent_id: "  " }) }), "blank agent_id", /identity/i);

  // A payload that is valid JSON but not an object must die loudly, never allow silently.
  for (const raw of ["null", '"sess"', "[1,2]"]) {
    const result = runGate(cwd, { rawInput: raw });
    assert.notEqual(result.status, 0, `non-object payload must not exit 0: ${raw} -> ${result.stdout}`);
  }

  // ---------------------------------------------------------------------------------------------
  // GLOBAL NO-OP: this hook is plugin-wide, so it must be inert outside a governed project.
  // ---------------------------------------------------------------------------------------------

  // Not a mutation.
  allowed(runGate(cwd, { tool: "Read" }), "non-mutating tools are not gated");
  // Receipt is not APPROVED: pre-approval subagents (the reviewer itself) still mutate legitimately.
  write({ status: "PENDING", reviewer_session_id: "", reviewed_at: "" });
  allowed(runGate(cwd, { agentId: REVIEWER_AGENT }), "a PENDING receipt does not gate the reviewer");
  write();

  const plainProject = mkdtempSync(join(tmpdir(), "implementer-identity-plain-"));
  try {
    mkdirSync(join(plainProject, "src"), { recursive: true });
    allowed(runGate(plainProject, { rawInput: JSON.stringify(payloadFor(plainProject)) }), "a project with no planning state is not gated");
    // Even a malformed payload is not this hook's business outside a governed project.
    allowed(runGate(plainProject, { rawInput: JSON.stringify(payloadFor(plainProject, { omitSession: true })) }), "no governed receipt means no identity requirement");
  } finally {
    rmSync(plainProject, { recursive: true, force: true });
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log("implementer-identity-contract tests passed");
