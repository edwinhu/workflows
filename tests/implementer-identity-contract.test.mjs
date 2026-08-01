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
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  // A payload that is valid JSON but not an object must DENY, not exit 1.
  //
  // `requireObject` used to `process.exit(1)` here, defended as "dying loudly, which is better than
  // a silent allow". In a PreToolUse gate those are THE SAME THING: Claude Code treats a non-zero
  // hook exit as non-blocking, prints the stderr, and runs the tool. So the assertion below was
  // pinning the silent allow it was written to prevent. It now pins the deny — and, deliberately,
  // exit 0, because only an exit-0 deny actually blocks. PostToolUse hooks keep the exit-1 parity
  // semantics (`writing-suggest-verify`, `overflow-check`, `ds-post-subagent-guard` pin it), which
  // is why `denyOnCrash` — called only by PreToolUse gates — is what switches the behaviour.
  for (const raw of ["null", '"sess"', "[1,2]"]) {
    denied(runGate(cwd, { rawInput: raw }), `non-object payload ${raw} must deny`, /payload must be an object/i);
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

  // ---------------------------------------------------------------------------------------------
  // A CRASH IS A DENIAL. Claude Code treats a non-zero hook exit as NON-BLOCKING, so every throw in
  // this gate was a silent allow.
  // ---------------------------------------------------------------------------------------------

  // `receipt.workflow` under schema-v2 is an arbitrary WORKFLOW_IDENTITY string, and that regex
  // admits `constructor`. `builtInOrchestratorDirectories` indexed a prototype-bearing object
  // literal with it, returned `Object`'s constructor, and `permitted.some` threw — measured
  // TypeError, EXIT=1, and the approving conversation's Write to arbitrary project code landed
  // ungated under an APPROVED receipt.
  for (const poisoned of ["constructor", "tostring", "valueof"]) {
    write({ workflow: poisoned });
    denied(
      runGate(cwd, { agentId: undefined }),
      `a receipt naming workflow "${poisoned}" must deny, not crash`,
      /may not also implement it/i,
    );
  }
  write();

  // The class, not the one instance: an induced throw of any kind must still emit a schema-valid
  // deny and exit 0.
  for (const argv of [[], ["--reject"]]) {
    const crash = spawnSync("bun", [join(REPO, "tests", "fixtures", "crash-gate.ts"), ...argv], {
      cwd,
      env: productionEnv(),
      input: JSON.stringify(payloadFor(cwd)),
      encoding: "utf8",
    });
    assert.equal(crash.status, 0, `an induced ${argv.length ? "rejection" : "throw"} must exit 0, not ${crash.status}: ${crash.stderr}`);
    assert.match(crash.stdout, /"permissionDecision": "deny"/, `an induced fault must deny: ${crash.stdout}`);
    const parsed = JSON.parse(crash.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
    const schema = spawnSync("python3", ["-c", [
      "import json,sys",
      `sys.path.insert(0, ${JSON.stringify(join(REPO, "scripts", "checks"))})`,
      "from hook_output_schema import validate_payload",
      "print(json.dumps(validate_payload('PreToolUse', json.load(sys.stdin))))",
    ].join("\n")], { input: crash.stdout, encoding: "utf8" });
    assert.equal(schema.status, 0, `schema check failed to run: ${schema.stderr}`);
    assert.equal(schema.stdout.trim(), "[]", `crash deny violates the PreToolUse output schema: ${schema.stdout}`);
  }

  // ---------------------------------------------------------------------------------------------
  // THE FABRICATED RECEIPT. `.planning/.state/` was inside the orchestrator's permitted prefixes,
  // so the gate authorized writing the very receipt every other check reads its authority from.
  //
  // Measured before the fix, end to end: an actor that never approved and never reviewed wrote a
  // receipt naming `approved_session_id: "nobody-approved-this"` and `reviewer_session_id:
  // "nobody-reviewed-this"`, the gate exited 0, and `validateGeneratedPlanArtifact` then ACCEPTED
  // it — no plan approved, no reviewer dispatched. FIVE of the six actor/status combinations below
  // were admitted; the sixth denied incidentally (reviewer == implementer), not by any receipt rule.
  //
  // `orchestrator-mutation-guard` excludes `.planning/.state/` and was assumed to be the backstop.
  // It is skill-scoped: absent from every subagent and from every conversation outside a wired
  // skill. This gate is the only plugin-wide PreToolUse mutation hook, so the rule lives here.
  // ---------------------------------------------------------------------------------------------

  const RECEIPT = join(state, "review.json");
  const forged = JSON.stringify({
    workflow: "dev", plan_file: planFile, plan_hash: hash,
    approved_session_id: "nobody-approved-this", approved_at: "2026-01-01T00:00:00.000Z",
    status: "APPROVED", reviewer_session_id: "nobody-reviewed-this", reviewed_at: "2026-01-01T00:05:00.000Z",
  }, null, 2);
  const forge = (options) => runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, options), tool_input: { file_path: RECEIPT, content: forged } }) });

  const actors = [
    ["an unrelated actor", { sessionId: "sess-unrelated", agentId: "totally-random-actor" }],
    ["the recorded approver", { sessionId: SESSION, agentId: undefined }],
    ["the recorded reviewer", { sessionId: SESSION, agentId: REVIEWER_AGENT }],
  ];
  for (const [status, receiptFields] of [["PENDING", { status: "PENDING", reviewer_session_id: "", reviewed_at: "" }], ["APPROVED", {}]]) {
    write(receiptFields);
    for (const [who, options] of actors) {
      denied(forge(options), `${who} may not fabricate the receipt at ${status}`, /is not part of any orchestrator's write surface/);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // ONE `..` SEGMENT USED TO SKIP ALL NINE CONDITIONS ABOVE.
  //
  // The block was scoped with `projectRelativePath`, which returns `null` for any path carrying a
  // literal `..`. That `null` is a REJECTION, but `relative?.startsWith(...)` reads it as "not the
  // receipt" and falls through — to `if (receipt.status !== "APPROVED") allow()`. Measured with this
  // binary before the fix: the identical forged content ALLOWED at three of the four combinations
  // below (PENDING/conversation-level, PENDING/subagent, APPROVED/subagent; the fourth denied only
  // incidentally, via the permitted-directory check further down).
  //
  // Scope is now derived from where the bytes LAND, so every spelling enters the block. The polarity
  // is the finding, not the spelling: `orchestrator-mutation-guard` treats the same sentinel as deny.
  // ---------------------------------------------------------------------------------------------

  const DOTDOT_RECEIPT = `${cwd}/.planning/.state/../.state/review.json`;
  assert.match(DOTDOT_RECEIPT, /\/\.\.\//, "the traversal spelling must actually contain a `..` segment");
  for (const [status, receiptFields] of [["PENDING", { status: "PENDING", reviewer_session_id: "", reviewed_at: "" }], ["APPROVED", {}]]) {
    write(receiptFields);
    for (const [who, options] of actors) {
      const traversal = runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, options), tool_input: { file_path: DOTDOT_RECEIPT, content: forged } }) });
      denied(traversal, `${who} may not fabricate the receipt through a \`..\` spelling at ${status}`, /is not part of any orchestrator's write surface/);
    }
  }

  // The whole directory, not just the one filename, and every write-capable tool.
  write({ status: "PENDING", reviewer_session_id: "", reviewed_at: "" });
  denied(runGate(cwd, { agentId: REVIEWER_AGENT, path: join(state, "plan.json") }), "no other .state file is writable either", /is not the review receipt/);
  for (const tool of ["Edit", "MultiEdit"]) {
    denied(runGate(cwd, { tool, agentId: REVIEWER_AGENT, path: RECEIPT }), `${tool} of the receipt is not a finalization`, /cannot be a review finalization/);
  }

  // ---------------------------------------------------------------------------------------------
  // ...AND THE LEGITIMATE REVIEWER STILL FINALIZES. This is the load-bearing half: `plan-checker`
  // step 5 writes exactly this path, and `reviewer-verdict-guard` — wired in SKILL FRONTMATTER —
  // never fires for that dispatched subagent. So this gate is what both permits and checks it, and
  // a rule that only denied would break review entirely.
  // ---------------------------------------------------------------------------------------------

  const finalization = (overrides = {}) => JSON.stringify({
    workflow: "dev", plan_file: planFile, plan_hash: hash,
    approved_session_id: SESSION, approved_at: "2026-01-01T00:00:00.000Z",
    status: "APPROVED", reviewer_session_id: REVIEWER_ACTOR, reviewed_at: "2026-01-01T00:05:00.000Z",
    ...overrides,
  }, null, 2);
  const finalize = (content, options = { agentId: REVIEWER_AGENT }) =>
    runGate(cwd, { rawInput: JSON.stringify({ ...payloadFor(cwd, options), tool_input: { file_path: RECEIPT, content } }) });

  allowed(finalize(finalization()), "the dispatched reviewer finalizes its own receipt");
  allowed(finalize(finalization({ status: "ISSUES_FOUND" })), "ISSUES_FOUND is a finalization too");

  // Each field of the rule, one mutation at a time.
  denied(finalize(finalization({ reviewer_session_id: `${SESSION}#someone-else` })), "reviewer_session_id must be the writing actor", /identity/i);
  denied(finalize(finalization({ approved_session_id: "rewritten" })), "approval-owned fields must survive", /reproduce workflow, plan_file/);
  // Chronologically valid on its own — only the comparison against the ON-DISK receipt catches it.
  denied(finalize(finalization({ approved_at: "2025-12-31T00:00:00.000Z" })), "approved_at must survive", /reproduce workflow, plan_file/);
  denied(finalize(finalization({ plan_hash: "0".repeat(64) })), "plan_hash must survive", /reproduce workflow, plan_file/);
  // `plan_file` and `workflow` had NO mutation test, and a surgical deletion of just those two
  // comparisons survived the whole suite (60 passed, 0 failed): three of the five fields were
  // covered, so the rule as a whole looked pinned while two of its conditions were free.
  //
  // They do not behave alike, and the difference is why the gap went unnoticed:
  //   - `plan_file` is reachable. A finalization naming a DIFFERENT generated plan is schema-valid
  //     on its own — `isGeneratedPlanBasename` accepts any plan basename and `parseReviewState` has
  //     nothing to compare it against — so only the on-disk comparison catches it. Without the rule
  //     a reviewer's verdict could be recorded against a plan nobody approved.
  writeFileSync(join(planning, "other-plan.md"), "# a different generated plan\n");
  denied(finalize(finalization({ plan_file: "other-plan.md" })), "plan_file must survive", /reproduce workflow, plan_file/);
  //   - `workflow` is NOT reachable through this path, and that is the honest reason no mutation
  //     test kills it: the gate parses the proposal with `parseReviewState(content, receipt.workflow)`,
  //     which rejects a differing workflow as a schema failure before the comparison is evaluated.
  //     What is asserted here is therefore the real behaviour — the earlier rule fires — so a future
  //     change that drops `expectedWorkflow` from that call fails HERE, which is the only place the
  //     comparison could start mattering.
  denied(finalize(finalization({ workflow: "work" })), "a finalization may not restate the workflow", /the proposed receipt is invalid \(review-schema\)/);
  denied(finalize(finalization(), { agentId: undefined }), "a conversation-level actor may not finalize", /only a dispatched reviewer subagent/);
  // The approver as a SUBAGENT of itself: identity equals `approved_session_id`, so it is self-review.
  write({ status: "PENDING", reviewer_session_id: "", reviewed_at: "", approved_session_id: REVIEWER_ACTOR });
  denied(finalize(finalization({ approved_session_id: REVIEWER_ACTOR, reviewer_session_id: REVIEWER_ACTOR })), "the approver may not review its own plan", /approved the plan and may not also review/);
  // Already final: the window is open only while the receipt is PENDING.
  write();
  denied(finalize(finalization({ reviewed_at: "2026-01-01T00:09:00.000Z" })), "an APPROVED receipt is closed to further finalization", /already APPROVED/);
  write({ status: "PENDING", reviewer_session_id: "", reviewed_at: "" });

  // The denial is also the identity DELIVERY channel: a subagent cannot read its own agent_id, and
  // `reviewer-verdict-guard`'s additionalContext does not reach it (same skill-scope reason).
  denied(finalize(finalization({ reviewer_session_id: "guessed" })), "a denial names the actor identity verbatim", new RegExp(`This actor's identity is \\\\"${REVIEWER_ACTOR}\\\\"`));

  // ---------------------------------------------------------------------------------------------
  // TWO RULES THAT WORKED BUT WERE PINNED BY NOTHING.
  //
  // Re-running the receipt-block mutations under a harness that does not truncate showed both
  // deletions SURVIVING the whole suite. A rule no test kills is a rule the next refactor removes.
  // ---------------------------------------------------------------------------------------------

  // (1) `proposed.status === "PENDING"`. A "finalization" that leaves the receipt PENDING is not a
  // verdict. The content has to be a SCHEMA-VALID pending state to reach the rule at all — a PENDING
  // status carrying reviewer fields is rejected earlier by `parseReviewState` — which is exactly why
  // the mutation survived: the obvious probe never gets there. What the rule owns is the DIAGNOSIS:
  // delete it and the same call is still denied, but as an identity failure ("record your agent_id
  // verbatim"), advice that cannot fix a write whose real defect is that it decides nothing.
  denied(finalize(finalization({ status: "PENDING", reviewer_session_id: "", reviewed_at: "" })),
    "a finalization may not leave the receipt PENDING", /must set a final status/);

  // (2) `safeExactTarget` on the canonical receipt path. The spelling check one line above compares
  // the RESOLVED project-relative path, and a hard link cannot change that: `ln .planning/.state/
  // review.json src/mirror.json` leaves the receptacle presenting as the canonical receipt under its
  // own real name, with `realpath` and containment both clean. Only the structural link-count
  // rejection sees the second name — and it matters because the receipt is the one file whose bytes
  // every other gate trusts, so a second writable name for it is a second way to author authority.
  // (3) `actor === null`. Re-running the matrix found two survivors the review had not named, both
  // of the same shape as (1): the call is still denied, by a LATER rule, with a message that
  // misdescribes it. Here an identity-less subagent write falls through to the reviewer_session_id
  // comparison and is told to "record its identity verbatim" — advice it cannot act on, because the
  // payload has no identity to record. The nearby `/identity/i` assertions match both messages, so
  // nothing distinguished them.
  denied(finalize(finalization(), { agentId: REVIEWER_AGENT, omitSession: true }),
    "a receipt write with no resolvable actor identity", /no usable actor identity/);

  // (4) `"code" in proposed`. Content that is not a review state at all reports as an invalid
  // PROPOSAL; without the rule the undefined fields fall through to the identity comparison and the
  // reviewer is told its agent_id is wrong when the real defect is that it wrote unparseable bytes.
  denied(finalize("not json at all"), "unparseable receipt content", /the proposed receipt is invalid/);
  denied(finalize(JSON.stringify({ workflow: "dev" })), "structurally incomplete receipt content", /the proposed receipt is invalid/);

  const MIRROR = join(cwd, "src", "mirror.json");
  linkSync(RECEIPT, MIRROR);
  denied(finalize(finalization()), "a hard-linked receipt is not the canonical receipt path", /is not the canonical receipt path/);
  rmSync(MIRROR, { force: true });
  allowed(finalize(finalization()), "...and the same finalization is admitted once the second name is gone");

  write();

  // ---------------------------------------------------------------------------------------------
  // A BLOCKED LIFECYCLE IS MORE SUSPICION, NOT LESS.
  //
  // The gate opened with `if (lifecycle.kind !== "canonical") allow()`, so any state the classifier
  // could not resolve was a blanket permit. Replacing `.planning/.state` with a SYMLINK to a sibling
  // directory holding byte-identical receipt content classifies as `blocked/artifact-type` — and
  // measured before the fix, the recorded approver's `Write src/a.js` and `Bash rm -rf src` were both
  // ALLOWED, at APPROVED and at PENDING. Every rule in the file was off for as long as the link
  // existed, and creating it costs one `ln -s` during PENDING, when Bash is unrestricted anyway.
  //
  // The classification itself is correct and predates this work (`rejectSymlinkComponents`, on main);
  // the inversion was the call site reading a "something is wrong here" sentinel as permission.
  // ---------------------------------------------------------------------------------------------

  // `build(root, body)` receives the receipt bytes for the status under test, so each shape decides
  // for itself where (or whether) a readable receipt survives behind the broken surface. Writing it
  // into `.state` unconditionally would repair the malformed case back to canonical and assert
  // nothing — measured while writing this.
  const blocked = (build, status) => {
    const root = mkdtempSync(join(tmpdir(), "implementer-identity-blocked-"));
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, ".planning", ".state"), { recursive: true });
    writeFileSync(join(root, ".planning", planFile), plan);
    build(root, status === "APPROVED" ? receipt() : receipt({ status: "PENDING", reviewer_session_id: "", reviewed_at: "" }));
    return root;
  };
  const inProject = (root, options = {}) => runGate(root, { rawInput: JSON.stringify(payloadFor(root, options)) });

  // The third element names where receipt bytes are still READABLE behind the broken surface, or
  // null when nothing parseable survives. The untrusted read is asserted BOTH ways from it — it must
  // tighten where bytes exist, and its absence must not silently turn the whole case vacuous.
  for (const [name, build, readable] of [
    // The measured blocker: byte-identical receipt content behind a symlinked governance directory.
    ["a symlinked .state directory", (root, body) => {
      rmSync(join(root, ".planning", ".state"), { recursive: true });
      mkdirSync(join(root, ".planning", "shadow"), { recursive: true });
      writeFileSync(join(root, ".planning", "shadow", "review.json"), body);
      symlinkSync("shadow", join(root, ".planning", ".state"));
    }, join(".planning", "shadow", "review.json")],
    // A DANGLING link classifies as `conversion-required`, not `artifact-type` — nothing exists at
    // the receipt path — so keying the disposition on the reason string would have re-admitted it.
    ["a dangling .state symlink", root => {
      rmSync(join(root, ".planning", ".state"), { recursive: true });
      symlinkSync("nowhere", join(root, ".planning", ".state"));
    }],
    ["a regular file where .state belongs", root => {
      rmSync(join(root, ".planning", ".state"), { recursive: true });
      writeFileSync(join(root, ".planning", ".state"), "not a directory");
    }],
    ["a malformed receipt", root => writeFileSync(join(root, ".planning", ".state", "review.json"), "{ not json")],
    ["a receipt that no longer authenticates its plan", (root, body) => {
      writeFileSync(join(root, ".planning", ".state", "review.json"), body);
      writeFileSync(join(root, ".planning", planFile), "# these bytes are not the approved ones\n");
    }, join(".planning", ".state", "review.json")],
  ]) {
    for (const status of ["APPROVED", "PENDING"]) {
      const root = blocked(build, status);
      try {
        denied(inProject(root, { agentId: undefined }), `${name} at ${status}: the conversation may not write project code`, /planning state blocked/);
        denied(inProject(root, { tool: "Bash", command: "rm -rf src", agentId: undefined }), `${name} at ${status}: the conversation gets no Bash`, /planning state blocked/);
        // An actor the (untrusted) receipt does not name is still restricted: with the receipt
        // unreadable, nothing CLEARS an actor, so the denial cannot depend on recognising one. The
        // read-only command is the point — there is no allowlist here to widen.
        denied(inProject(root, { tool: "Bash", command: "git status", sessionId: "sess-unrelated", agentId: undefined }), `${name} at ${status}: not an allowlist with a gap`, /NO Bash/);
        // ...and the state stays repairable from the conversation that hit the denial.
        allowed(inProject(root, { agentId: undefined, path: join(root, ".planning", "notes.md") }), `${name} at ${status}: .planning stays writable`);
        // Delegation has to remain true advice, so a dispatched subagent is not restricted here.
        allowed(inProject(root, { agentId: IMPLEMENTER_AGENT }), `${name} at ${status}: a dispatched implementer still works`);
        // The untrusted receipt may only TIGHTEN. Where bytes are still readable, an actor they name
        // as the approver is refused even as a subagent; where none are, there is nothing to
        // recognise and the subagent stays admitted. The same bytes buy the writer nothing else —
        // every assertion above already held with the receipt naming a different actor.
        if (readable) writeFileSync(join(root, readable), receipt({ approved_session_id: `${SESSION}#${IMPLEMENTER_AGENT}` }));
        const shadowed = inProject(root, { agentId: IMPLEMENTER_AGENT });
        if (readable) denied(shadowed, `${name} at ${status}: a subagent the surviving bytes name as approver`, /may not also implement/);
        else allowed(shadowed, `${name} at ${status}: no readable bytes means no identity to recognise`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }

  // THE INERTNESS THAT IS LOAD-BEARING SURVIVES. A `blocked` project with NO receipt surface is an
  // ordinary legacy or mid-planning `.planning`, nothing was ever approved in it, and this
  // plugin-wide hook must stay out of its way. Breaking this would restrict every user with a
  // pre-receipt `.planning` directory.
  for (const [name, build] of [
    ["a legacy .planning with no .state at all", root => {
      rmSync(join(root, ".planning", ".state"), { recursive: true });
      writeFileSync(join(root, ".planning", "PLAN.md"), "# legacy\n");
    }],
    // The PLAN phase: drafts on disk, `.state` created but still empty, no approval anywhere.
    ["plan drafts and an empty .state", root => {
      writeFileSync(join(root, ".planning", "DEV_CLARIFIED.json"), JSON.stringify({ status: "clarified", sessionId: SESSION }));
    }],
  ]) {
    const root = blocked(build);
    try {
      allowed(inProject(root, { agentId: undefined }), `${name}: the conversation still writes project code`);
      allowed(inProject(root, { tool: "Bash", command: "rm -rf src", agentId: undefined }), `${name}: the conversation still runs commands`);
      allowed(inProject(root, { agentId: IMPLEMENTER_AGENT }), `${name}: a subagent is unaffected`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // `resolve()` COLLAPSES `..` LEXICALLY; THE KERNEL RESOLVES THE SYMLINK FIRST.
  //
  // The header of `safeProjectPath` claims "a path is judged by where it points, not by how it is
  // spelled". That claim was FALSE for any function that accepted a `..`: with
  // `.planning/statelink -> ../src`, the spelling `.planning/statelink/../.state/review.json`
  // computed as the canonical receipt — `safeExactTarget` returned true for it — while a write
  // through it lands in `<root>/.state/review.json`. `safeProjectPath` and `projectRelativePath`
  // were immune only because they REJECT `..` first, which makes that rejection a correctness
  // precondition for their `resolve()`, not spelling hygiene.
  // ---------------------------------------------------------------------------------------------

  const { resolvedProjectRelativePath, safeExactTarget } = await import(join(REPO, "hooks", "_path_safety.ts"));
  const spellingRoot = realpathSync(mkdtempSync(join(tmpdir(), "implementer-identity-spelling-")));
  try {
    mkdirSync(join(spellingRoot, ".planning", ".state"), { recursive: true });
    mkdirSync(join(spellingRoot, "src"), { recursive: true });
    writeFileSync(join(spellingRoot, ".planning", ".state", "review.json"), receipt());
    symlinkSync("../src", join(spellingRoot, ".planning", "statelink"));
    // Built by concatenation, NOT `join`: `path.join` normalizes the `..` away lexically, which is
    // the very collapse under test — a fixture that used it would assert nothing.
    const spelled = `${spellingRoot}/.planning/statelink/../.state/review.json`;
    assert.match(spelled, /\/\.\.\//, "the fixture must actually carry a `..` segment");
    assert.equal(
      resolvedProjectRelativePath(spellingRoot, spelled), ".state/review.json",
      "scope must be the kernel's landing, not the lexical collapse onto the receipt",
    );
    assert.equal(
      safeExactTarget(spellingRoot, spelled, join(spellingRoot, ".planning", ".state", "review.json")), false,
      "an exact-target check must refuse a `..` spelling rather than compare the lexical form",
    );
    // ...and the honest spelling of the same file is still the same file.
    assert.equal(resolvedProjectRelativePath(spellingRoot, join(spellingRoot, ".planning", ".state", "review.json")), ".planning/.state/review.json");
    assert.equal(safeExactTarget(spellingRoot, join(spellingRoot, ".planning", ".state", "review.json"), join(spellingRoot, ".planning", ".state", "review.json")), true);
  } finally {
    rmSync(spellingRoot, { recursive: true, force: true });
  }

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
