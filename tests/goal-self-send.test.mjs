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
  herdrPrompt = 0, resolve = 1, send = 0, omitHerdr = false, omitAgentMsg = false, child = false,
}) {
  const cwd = mkdtempSync(join(tmpdir(), "goal-self-send-"));
  const log = join(cwd, "argv.jsonl");
  const bin = join(cwd, "bin");
  mkdirSync(bin, { recursive: true });
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    CLAUDE_CODE_SESSION_ID: SESSION,
    CLAUDE_CODE_CHILD_SESSION: child ? "1" : "",
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

test("malformed and ambiguous list identity fail closed without fallback", () => {
  for (const list of [
    "not-json",
    {},
    listPayload(null),
    listPayload("not-an-agent"),
    listPayload({ agent: "claude" }),
    listPayload({ agent: "claude", agent_session: { kind: "id" }, pane_id: "w1:p2" }),
    listPayload(record("other"), { agent: "codex", agent_session: { kind: "id" }, pane_id: "w1:p9" }),
    listPayload(record(), record(SESSION, "w1:p3")),
    listPayload({ agent: "claude", agent_session: { kind: "name", value: SESSION }, pane_id: "w1:p2" }),
    listPayload({ agent: "claude", agent_session: { kind: "id", value: SESSION } }),
  ]) {
    const result = runCase({ list, get: {}, resolve: 0 });
    expectResult(result, 4, { status: "unsafe_identity" });
    assert.ok(!result.calls.some((call) => call[0] === "agent-msg"));
  }
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

test("spawned sessions fail closed before invoking a transport", () => {
  const result = runCase({ child: true, list: listPayload(record()), get: getPayload(record()), resolve: 0 });
  expectResult(result, 4, { status: "unsafe_identity" });
  assert.deepEqual(result.calls, []);
});
