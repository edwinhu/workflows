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

// Does this record assert that it IS our session? Only claims are checked for well-formedness, so
// this predicate must never let a malformed record duck the check by being malformed.
//   - `String(value)` rather than `value === sessionId`: a non-string that spells our session id is
//     a claim, and it will then fail the strict checks. Strict equality alone would wave it past.
//   - An `agent` that is absent, null, or not a string is unattributable, so it counts as a claim.
//     Only a record positively identifying a DIFFERENT agent kind is dismissed — herdr hosts codex
//     alongside claude, and a codex pane is not a claim on our Claude session.
function claimsSession(agent: unknown, sessionId: string): boolean {
  if (typeof agent !== "object" || agent === null) return false;
  const session = (agent as AgentRecord).agent_session;
  if (typeof session !== "object" || session === null) return false;
  if (String((session as { value?: unknown }).value) !== sessionId) return false;
  const kind = (agent as AgentRecord).agent;
  return typeof kind !== "string" || kind === "claude";
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

// `CLAUDE_CODE_CHILD_SESSION` was once checked here as a "spawned agent" guard. It is not one.
// Claude Code's child-env builder (2.1.220, `XRt`) sets CLAUDE_CODE_CHILD_SESSION:"1"
// unconditionally, and BOTH Bash-tool shell-exec sites spread it in, so every Bash tool call
// carries it — the top-level session's included. The guard therefore denied the only caller the
// helper has, making `{"status":"unsafe_identity"}` the sole reachable outcome and the documented
// self-send path dead. No environment variable distinguishes top-level Bash from subagent Bash:
// `CLAUDE_CODE_SESSION_ID`, `AI_AGENT` (source:"agent" is hardcoded at both sites), `CLAUDE_PID`,
// and the herdr pane vars are byte-identical in both. "No subagent may self-send" is an
// actor-role rule and can only be enforced where the actor's identity exists — a hook payload's
// `agent_id`, the same reasoning `hooks/implementer-identity-gate.ts` already documents.
//
// What this script can enforce, and now does, is the destination: delivery only ever reaches the
// pane this process is itself running in.
const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
if (!sessionId) finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);

// Herdr exports the launching pane into every descendant of that pane, this process included.
// When present it is a second, independent identity witness: the pane herdr attributes to our
// session id must be the pane we occupy. A disagreement is unsafe, not "no match" — falling back
// would deliver to the same contested session id by another road.
const ownPane = process.env.HERDR_PANE_ID?.trim() || undefined;

const list = run("herdr", ["agent", "list"]);
if (list.error && (list.error as NodeJS.ErrnoException).code !== "ENOENT") deliverFailure("herdr");
if (!list.error) {
  if (list.status !== 0) deliverFailure("herdr");
  const agents = agentsFrom(parseJson(list.stdout));
  // An unreadable or unshaped payload is still a transport-level failure: we cannot enumerate
  // claims at all, so we cannot establish uniqueness.
  if (!agents) finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);

  // Well-formedness is asked of the records that CLAIM our session, never of the whole list.
  // Herdr's own schema makes `agent` and `agent_session` optional and nullable on AgentInfo
  // (only terminal_id/agent_status/workspace_id/tab_id/pane_id/focused/revision are required), and
  // its integration protocol reports an agent BEFORE its session id — `pane report-agent` and
  // `pane report-agent-session` are separate calls, and `launch_pending` is a published field. So a
  // neighbouring pane mid-launch legitimately appears with no `agent_session`. Sweeping the whole
  // list meant any such neighbour made OUR self-send fail closed, and it failed closed hardest in a
  // busy multi-pane workspace — exactly when this helper is used. Reproduced live: with our own
  // record present, unique and exact, one session-less record on another pane was enough.
  const identityClaims = agents.filter((agent) => claimsSession(agent, sessionId));
  if (identityClaims.length > 1) finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);

  if (identityClaims.length === 1) {
    // A record that claims our session gets the strict treatment it always had: malformed here is
    // unsafe, not "no match", and never a reason to fall back.
    if (!hasWellFormedIdentity(identityClaims[0]) || !hasExactIdentity(identityClaims[0], sessionId)) {
      finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);
    }
    const paneId = identityClaims[0].pane_id as string;
    if (ownPane !== undefined && paneId !== ownPane) {
      finish({ status: "unsafe_identity" }, EXIT.unsafeIdentity);
    }
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
