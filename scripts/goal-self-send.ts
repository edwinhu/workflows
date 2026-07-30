#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

const EXIT = {
  invalidCommand: 2,
  unavailable: 3,
  unsafeIdentity: 4,
  deliveryFailure: 5,
} as const;

type Transport = "herdr" | "agent-msg";
type AgentRecord = {
  agent?: unknown;
  agent_session?: { kind?: unknown; value?: unknown };
  pane_id?: unknown;
};

function finish(result: Record<string, string>, exitCode = 0): never {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(exitCode);
}

function run(executable: string, args: string[]) {
  return spawnSync(executable, args, { encoding: "utf8" });
}

function isValidCommand(command: string | undefined): command is string {
  if (command === "/goal clear") return true;
  return typeof command === "string"
    && command.startsWith("/goal ")
    && /\S/.test(command.slice("/goal ".length))
    && !command.includes("\0");
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function agentsFrom(payload: unknown): AgentRecord[] | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const agents = (result as { agents?: unknown }).agents;
  return Array.isArray(agents) ? agents : undefined;
}

function agentFrom(payload: unknown): AgentRecord | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const agent = (result as { agent?: unknown }).agent;
  return typeof agent === "object" && agent !== null ? agent as AgentRecord : undefined;
}

function hasWellFormedIdentity(agent: unknown): agent is AgentRecord {
  return typeof agent === "object"
    && agent !== null
    && typeof (agent as AgentRecord).agent === "string"
    && typeof (agent as AgentRecord).agent_session === "object"
    && (agent as AgentRecord).agent_session !== null
    && typeof (agent as AgentRecord).agent_session?.kind === "string"
    && typeof (agent as AgentRecord).agent_session?.value === "string"
    && typeof (agent as AgentRecord).pane_id === "string"
    && ((agent as AgentRecord).pane_id as string).length > 0;
}

function hasExactIdentity(agent: AgentRecord, sessionId: string, paneId?: string): boolean {
  return agent.agent === "claude"
    && agent.agent_session?.kind === "id"
    && agent.agent_session.value === sessionId
    && typeof agent.pane_id === "string"
    && agent.pane_id.length > 0
    && (paneId === undefined || agent.pane_id === paneId);
}

function deliverFailure(transport: Transport): never {
  return finish({ status: "delivery_failure", transport }, EXIT.deliveryFailure);
}

const args = process.argv.slice(2);
const command = args.length === 1 ? args[0] : undefined;
if (!isValidCommand(command)) finish({ status: "invalid_command" }, EXIT.invalidCommand);

if (process.env.CLAUDE_CODE_CHILD_SESSION) {
  finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);
}

const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
if (!sessionId) finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);

const list = run("herdr", ["agent", "list"]);
if (list.error && (list.error as NodeJS.ErrnoException).code !== "ENOENT") deliverFailure("herdr");
if (!list.error) {
  if (list.status !== 0) deliverFailure("herdr");
  const agents = agentsFrom(parseJson(list.stdout));
  if (!agents || agents.some((agent) => !hasWellFormedIdentity(agent))) {
    finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);
  }

  // Any Claude record claiming this session value participates in uniqueness.
  // A matching value with a malformed kind or pane is unsafe, not "no match".
  const identityClaims = agents.filter((agent) =>
    typeof agent === "object"
    && agent !== null
    && agent.agent === "claude"
    && agent.agent_session?.value === sessionId
  );
  if (identityClaims.length > 1 || (identityClaims.length === 1 && !hasExactIdentity(identityClaims[0], sessionId))) {
    finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);
  }

  if (identityClaims.length === 1) {
    const paneId = identityClaims[0].pane_id as string;
    const get = run("herdr", ["agent", "get", paneId]);
    if (get.error || get.status !== 0) deliverFailure("herdr");
    const current = agentFrom(parseJson(get.stdout));
    if (!current || !hasExactIdentity(current, sessionId, paneId)) {
      finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);
    }
    const prompt = run("herdr", ["agent", "prompt", paneId, command]);
    if (prompt.error || prompt.status !== 0) deliverFailure("herdr");
    finish({ status: "delivered", transport: "herdr" });
  }
}

const resolve = run("agent-msg", ["resolve", sessionId]);
if (resolve.error && (resolve.error as NodeJS.ErrnoException).code === "ENOENT") {
  finish({ status: "unavailable" }, EXIT.unavailable);
}
if (resolve.error || resolve.status !== 0) finish({ status: "unavailable" }, EXIT.unavailable);

const send = run("agent-msg", ["send", sessionId, command]);
if (send.error || send.status !== 0) deliverFailure("agent-msg");
finish({ status: "delivered", transport: "agent-msg" });
