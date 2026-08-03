import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";

const REPO = new URL("..", import.meta.url).pathname;
const HELPER = join(REPO, "scripts", "goal-self-send.ts");
const SESSION = "session-exact";

function executable(path, body) {
  writeFileSync(path, `#!/usr/bin/env bun\n${body}`);
  chmodSync(path, 0o755);
}

function runCase({
  command = "/goal bounded condition", list, get, listStatus = 0, getStatus = 0,
  herdrPrompt = 0, resolve = 1, send = 0, omitHerdr = false, omitAgentMsg = false,
  ownPane = "w1:p2",
}) {
  const cwd = mkdtempSync(join(tmpdir(), "goal-self-send-"));
  const log = join(cwd, "argv.jsonl");
  const bin = join(cwd, "bin");
  mkdirSync(bin, { recursive: true });
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CLAUDE_CODE_SESSION_ID: SESSION,
    // Every Claude Code Bash tool call carries this, top-level session included, so every case
    // here runs with it set. It is not an actor discriminator and must not gate delivery.
    CLAUDE_CODE_CHILD_SESSION: "1",
    // The pane this process occupies. `""` models a Claude launched outside herdr.
    HERDR_PANE_ID: ownPane,
    TEST_LOG: log,
    HERDR_LIST: typeof list === "string" ? list : JSON.stringify(list),
    HERDR_GET: typeof get === "string" ? get : JSON.stringify(get),
    HERDR_LIST_STATUS: String(listStatus),
    HERDR_GET_STATUS: String(getStatus),
    HERDR_PROMPT_STATUS: String(herdrPrompt),
    AGENT_MSG_RESOLVE_STATUS: String(resolve),
    AGENT_MSG_SEND_STATUS: String(send),
  };

  if (!omitHerdr) executable(join(bin, "herdr"), `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_LOG, JSON.stringify(["herdr", ...args]) + "\\n");
if (args[0] === "agent" && args[1] === "list") { console.log(process.env.HERDR_LIST); process.exit(Number(process.env.HERDR_LIST_STATUS)); }
if (args[0] === "agent" && args[1] === "get") { console.log(process.env.HERDR_GET); process.exit(Number(process.env.HERDR_GET_STATUS)); }
if (args[0] === "agent" && args[1] === "prompt") process.exit(Number(process.env.HERDR_PROMPT_STATUS));
process.exit(99);
`);
  if (!omitAgentMsg) executable(join(bin, "agent-msg"), `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_LOG, JSON.stringify(["agent-msg", ...args]) + "\\n");
if (args[0] === "resolve") process.exit(Number(process.env.AGENT_MSG_RESOLVE_STATUS));
if (args[0] === "send") process.exit(Number(process.env.AGENT_MSG_SEND_STATUS));
process.exit(99);
`);

  const result = spawnSync("bun", [HELPER, command], { cwd, env, encoding: "utf8" });
  const calls = (() => { try { return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch { return []; } })();
  rmSync(cwd, { recursive: true, force: true });
  return { ...result, json: JSON.parse(result.stdout), calls };
}

const record = (session = SESSION, pane = "w1:p2") => ({ agent: "claude", agent_session: { kind: "id", value: session }, pane_id: pane });
const listPayload = (...agents) => ({ result: { agents } });
const getPayload = (agent) => ({ result: { agent } });

function expectResult(result, status, json) {
  assert.equal(result.status, status, result.stderr);
  assert.deepEqual(result.json, json);
}

test("Herdr exact match revalidates and preserves the command as one argv", () => {
  const command = "/goal Prove: punctuation — yes?\nThen preserve this line exactly.";
  const result = runCase({ command, list: listPayload(record()), get: getPayload(record()) });
  expectResult(result, 0, { status: "delivered", transport: "herdr" });
  assert.deepEqual(result.calls, [
    ["herdr", "agent", "list"],
    ["herdr", "agent", "get", "w1:p2"],
    ["herdr", "agent", "prompt", "w1:p2", command],
  ]);
});

test("Herdr delivers /goal clear without --wait", () => {
  const result = runCase({ command: "/goal clear", list: listPayload(record()), get: getPayload(record()) });
  expectResult(result, 0, { status: "delivered", transport: "herdr" });
  assert.deepEqual(result.calls.at(-1), ["herdr", "agent", "prompt", "w1:p2", "/goal clear"]);
});

test("multiple agents select only the exact Claude session", () => {
  const result = runCase({
    list: listPayload(record("other", "w1:p1"), { agent: "codex", agent_session: { kind: "id", value: SESSION }, pane_id: "w1:p9" }, record()),
    get: getPayload(record()),
  });
  expectResult(result, 0, { status: "delivered", transport: "herdr" });
  assert.deepEqual(result.calls.at(-1).slice(0, 4), ["herdr", "agent", "prompt", "w1:p2"]);
});

test("no Herdr match falls back to agent-msg with exact argv", () => {
  const result = runCase({ list: listPayload(record("other")), get: {}, resolve: 0 });
  expectResult(result, 0, { status: "delivered", transport: "agent-msg" });
  assert.deepEqual(result.calls.slice(-2), [
    ["agent-msg", "resolve", SESSION],
    ["agent-msg", "send", SESSION, "/goal bounded condition"],
  ]);
});

test("missing Herdr falls back, while no usable transport is unavailable", () => {
  expectResult(runCase({ omitHerdr: true, list: {}, get: {}, resolve: 0 }), 0, { status: "delivered", transport: "agent-msg" });
  expectResult(runCase({ list: listPayload(), get: {}, resolve: 1 }), 3, { status: "unavailable" });
  expectResult(runCase({ list: listPayload(), get: {}, omitAgentMsg: true }), 3, { status: "unavailable" });
});

test("an unreadable list is unsafe: claims cannot be enumerated at all", () => {
  for (const list of ["not-json", {}]) {
    const result = runCase({ list, get: {}, resolve: 0 });
    expectResult(result, 4, { status: "unsafe_identity" });
    assert.ok(!result.calls.some((call) => call[0] === "agent-msg"));
  }
});

// Malformed records that CLAIM our session id. These are the actual attack — a second record
// asserting it is us — and every one of them must still fail closed with no fallback.
test("malformed records claiming OUR session still fail closed without fallback", () => {
  for (const list of [
    // Two well-formed records claiming the same session: ambiguous, so neither is trustworthy.
    listPayload(record(), record(SESSION, "w1:p3")),
    // Claims our session, but `kind` is not an id reference.
    listPayload({ agent: "claude", agent_session: { kind: "path", value: SESSION }, pane_id: "w1:p2" }),
    // Claims our session with no pane to deliver to, or an empty one.
    listPayload({ agent: "claude", agent_session: { kind: "id", value: SESSION } }),
    listPayload({ agent: "claude", agent_session: { kind: "id", value: SESSION }, pane_id: "" }),
    // Unattributable `agent` — absent, null, or not a string — must NOT duck the check.
    listPayload({ agent_session: { kind: "id", value: SESSION }, pane_id: "w1:p2" }),
    listPayload({ agent: null, agent_session: { kind: "id", value: SESSION }, pane_id: "w1:p2" }),
    listPayload({ agent: 7, agent_session: { kind: "id", value: SESSION }, pane_id: "w1:p2" }),
    // A malformed claim alongside our own genuine record is still two claims.
    listPayload(record(), { agent: null, agent_session: { kind: "id", value: SESSION }, pane_id: "w1:p3" }),
  ]) {
    const result = runCase({ list, get: getPayload(record()), resolve: 0 });
    expectResult(result, 4, { status: "unsafe_identity" });
    assert.ok(!result.calls.some((call) => call[0] === "agent-msg"));
  }
});

// Malformed records that do NOT claim our session are somebody else's business. Herdr's schema
// makes `agent` and `agent_session` optional on AgentInfo and reports an agent before its session
// id, so a neighbouring pane mid-launch appears exactly like this. Sweeping the whole list for
// well-formedness let any such neighbour veto our own delivery.
test("malformed records that do NOT claim our session are irrelevant", () => {
  for (const list of [
    listPayload(null),
    listPayload("not-an-agent"),
    listPayload({ agent: "claude" }),
    listPayload({ agent: "claude", agent_session: { kind: "id" }, pane_id: "w1:p2" }),
    listPayload({ agent: "codex", agent_session: { kind: "id", value: "other" } }),
    listPayload(record("other"), { agent: "codex", agent_session: { kind: "id" }, pane_id: "w1:p9" }),
  ]) {
    const result = runCase({ list, get: {}, resolve: 0 });
    expectResult(result, 0, { status: "delivered", transport: "agent-msg" });
  }
});

// The live reproduction, as a fixture: our own record is present, unique and exact, and one
// neighbouring pane is mid-launch with no agent_session. Delivery must proceed to our pane.
test("a launch-pending neighbour does not veto our own exact record", () => {
  const result = runCase({
    list: listPayload(
      { agent: "claude", agent_status: "idle", pane_id: "w1:p9", tab_id: "w1:t1" },
      record(),
    ),
    get: getPayload(record()),
  });
  expectResult(result, 0, { status: "delivered", transport: "herdr" });
  assert.deepEqual(result.calls.at(-1).slice(0, 4), ["herdr", "agent", "prompt", "w1:p2"]);
});

// Strict equality alone would wave a non-string that spells our session id straight past the
// claim filter and on to delivery.
test("a non-string value spelling our session id is a claim, not a bystander", () => {
  const result = runCase({
    list: listPayload(record(), { agent: "claude", agent_session: { kind: "id", value: [SESSION] }, pane_id: "w1:p3" }),
    get: getPayload(record()),
    resolve: 0,
  });
  expectResult(result, 4, { status: "unsafe_identity" });
  assert.ok(!result.calls.some((call) => call[0] === "agent-msg"));
});

test("changed or malformed revalidation fails closed without fallback", () => {
  for (const get of [
    "not-json",
    getPayload(record("changed")),
    getPayload(record(SESSION, "w1:p3")),
    getPayload({ ...record(), agent: "codex" }),
  ]) {
    const result = runCase({ list: listPayload(record()), get, resolve: 0 });
    expectResult(result, 4, { status: "unsafe_identity" });
    assert.ok(!result.calls.some((call) => call[0] === "agent-msg"));
  }
});

test("transport execution failures have stable delivery-failure results", () => {
  expectResult(runCase({ list: listPayload(record()), get: getPayload(record()), herdrPrompt: 7 }), 5, { status: "delivery_failure", transport: "herdr" });
  expectResult(runCase({ list: listPayload(), get: {}, resolve: 0, send: 7 }), 5, { status: "delivery_failure", transport: "agent-msg" });
  expectResult(runCase({ list: listPayload(), get: {}, listStatus: 7 }), 5, { status: "delivery_failure", transport: "herdr" });
  expectResult(runCase({ list: listPayload(record()), get: getPayload(record()), getStatus: 7 }), 5, { status: "delivery_failure", transport: "herdr" });
});

test("invalid commands fail before invoking a transport", () => {
  for (const command of ["goal nope", "/goal", "/goal ", "/goal\t", "/goal \t", "/goal \n", "/goal-clear", " /goal clear"]) {
    const result = runCase({ command, list: listPayload(record()), get: getPayload(record()) });
    expectResult(result, 2, { status: "invalid_command" });
    assert.deepEqual(result.calls, []);
    assert.ok(!result.stderr.includes(command));
  }
});

// Claude Code's child-env builder sets CLAUDE_CODE_CHILD_SESSION=1 on EVERY process it spawns,
// so the top-level session's own Bash tool call carries it. Treating it as a "spawned agent"
// marker denied the helper's only caller and made unsafe_identity the sole reachable outcome.
test("the Bash-tool environment is not an unsafe identity", () => {
  const result = runCase({ list: listPayload(record()), get: getPayload(record()) });
  expectResult(result, 0, { status: "delivered", transport: "herdr" });
});

test("a pane that is not our own fails closed without falling back", () => {
  const result = runCase({
    ownPane: "w9:p9", list: listPayload(record()), get: getPayload(record()), resolve: 0,
  });
  expectResult(result, 4, { status: "unsafe_identity" });
  assert.deepEqual(result.calls, [["herdr", "agent", "list"]]);
});

test("no pane in the environment leaves session-exact delivery intact", () => {
  const result = runCase({ ownPane: "", list: listPayload(record()), get: getPayload(record()) });
  expectResult(result, 0, { status: "delivered", transport: "herdr" });
  assert.deepEqual(result.calls.at(-1).slice(0, 4), ["herdr", "agent", "prompt", "w1:p2"]);
});
