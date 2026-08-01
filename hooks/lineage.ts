/**
 * MONITORED TELEMETRY, NOT A LINEAGE-SEPARATION CONTROL. READ THIS BEFORE CITING IT.
 *
 * Identity inequality alone leaves one live hole: the reviewer subagent can dispatch a FRESH
 * implementer subagent, which has a different `agent_id` and therefore satisfies
 * `implementer != reviewer` while the reviewer still controls the work end to end.
 *
 * This module observes that hole. It does not close it, and nothing that depends on it may claim
 * lineage separation as an invariant:
 *
 *   - it FAILS OPEN on 41% of real agents (see below), so the ordinary outcome of an unresolvable
 *     case is silence, not a denial;
 *   - it stops at ONE level, so `reviewer -> helper -> implementer` — one extra dispatch, requiring
 *     no privilege and no evasion skill — is invisible to it;
 *   - it reads an undocumented on-disk layout that can vanish in any release, in which case it
 *     silently returns false forever and nothing announces that it stopped working.
 *
 * Its honest value is that it makes the DIRECT, unlaundered form of the arrangement visible and
 * costly. Treat a `true` from it as evidence worth acting on and a `false` as no evidence at all.
 *
 * ============================ THIS DEPENDS ON UNDOCUMENTED ON-DISK LAYOUT ====================
 * Everything below reads Claude Code's internal transcript directory, which is not a public
 * interface and may change or disappear in any release with no warning and no deprecation:
 *
 *     <project transcript dir>/<session_id>.jsonl                       the conversation
 *     <project transcript dir>/<session_id>/subagents/agent-<id>.jsonl  a subagent's transcript
 *     <project transcript dir>/<session_id>/subagents/agent-<id>.meta.json
 *         { agentType, description, toolUseId, spawnDepth }
 *
 * `toolUseId` is the id of the `Agent` tool_use that created the subagent, so it appears in the
 * DISPATCHER's transcript. That is the whole mechanism.
 *
 * IT MUST FAIL OPEN, AND IT DOES.
 *   `toolUseId` is absent from a large fraction of real meta files — measured on this machine,
 *   503 of 1236 (41%) lacked it entirely, concentrated in named team agents recorded at
 *   `spawnDepth: 0`. Failing closed on unresolvable ancestry would therefore deny ordinary work
 *   roughly two times in five. Every unreadable, missing, malformed, oversized, or ambiguous case
 *   below returns `false` — "not proven to be a reviewer dispatch" — never a denial.
 *
 * WHAT IT CATCHES, AND WHAT IT DOES NOT.
 *   CATCHES: the reviewer dispatching the implementer DIRECTLY (one level).
 *   DOES NOT CATCH: a laundered chain, reviewer -> helper -> implementer. Resolving that needs the
 *     intermediate agent's identity, which is only findable by scanning every sibling transcript in
 *     the session — up to 200 files and 75 MB in one directory on this machine. That cost on every
 *     mutation is not acceptable, so the walk stops at one level by design rather than pretending
 *     to a completeness it cannot pay for.
 */
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Agent and session ids are opaque; anything outside this class could escape the directory. */
const ID = /^[A-Za-z0-9_-]+$/;
/** Above this, reading the dispatcher transcript stops being cheap. Oversize => fail open. */
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const ACTOR_SEPARATOR = "#";

/**
 * Does this transcript record an `Agent` tool_use with exactly this id?
 *
 * WHY IT PARSES INSTEAD OF SEARCHING FOR THE STRING
 *   The previous version ran `contents.includes(toolUseId)` over the whole transcript. A tool-use id
 *   is an opaque token that also appears in ordinary CONTENT — a pasted log line, an error message,
 *   a quoted payload — so a coincidental occurrence anywhere in the reviewer's transcript produced a
 *   positive, and a positive here is a DENIAL of legitimate work. For a check whose whole design
 *   principle is "fail open, never deny on a guess", a substring match is the wrong instrument.
 *
 * WHY THE SIZE CHECK USES A FILE DESCRIPTOR
 *   `statSync` then `readFileSync` samples the path twice, so the file that was measured is not
 *   necessarily the file that is read; the bound on work was advisory only. Opening once and calling
 *   `fstatSync` on that descriptor measures and reads the same object.
 */
function transcriptRecordsToolUse(transcript: string, toolUseId: string): boolean {
  const fd = openSync(transcript, "r");
  try {
    if (fstatSync(fd).size > MAX_TRANSCRIPT_BYTES) return false;
    for (const line of readFileSync(fd, "utf8").split("\n")) {
      if (!line.trim() || !line.includes(toolUseId)) continue;   // cheap pre-filter; never a verdict
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== "object") continue;
      const message = (entry as Record<string, unknown>).message;
      const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && typeof block === "object" && !Array.isArray(block)
          && (block as Record<string, unknown>).type === "tool_use"
          && (block as Record<string, unknown>).id === toolUseId) return true;
      }
    }
    return false;
  } finally { closeSync(fd); }
}

/**
 * True ONLY when the on-disk record positively shows the reviewer dispatched this implementer.
 * False means "unproven", which includes every failure to resolve. Never throws.
 */
export function reviewerDispatchedImplementer(payload: unknown, reviewerIdentity: unknown): boolean {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const fields = payload as Record<string, unknown>;
    const session = fields.session_id;
    const implementer = fields.agent_id;
    const transcript = fields.transcript_path;
    if (typeof session !== "string" || typeof implementer !== "string" || typeof transcript !== "string") return false;
    if (typeof reviewerIdentity !== "string") return false;
    // Both become path components below, so `..` and separators must be impossible, not sanitized.
    if (!ID.test(session) || !ID.test(implementer)) return false;

    // The reviewer must be a subagent of THIS session tree; a bare session id names the
    // conversation, which is the dispatcher case the invariant deliberately permits.
    const parts = reviewerIdentity.split(ACTOR_SEPARATOR);
    if (parts.length !== 2) return false;
    const [reviewerSession, reviewerAgent] = parts;
    if (reviewerSession !== session || !ID.test(reviewerAgent)) return false;
    // A reviewer that IS the implementer is already denied by identity equality; nothing to add.
    if (reviewerAgent === implementer) return false;

    const subagents = join(dirname(transcript), session, "subagents");
    const meta = JSON.parse(readFileSync(join(subagents, `agent-${implementer}.meta.json`), "utf8")) as unknown;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
    const toolUseId = (meta as Record<string, unknown>).toolUseId;
    // Absent on ~41% of real meta files. Unresolvable ancestry is an ALLOW, by design.
    if (typeof toolUseId !== "string" || !toolUseId.trim()) return false;

    return transcriptRecordsToolUse(join(subagents, `agent-${reviewerAgent}.jsonl`), toolUseId);
  } catch {
    // Layout absent, renamed, or unparseable: the check simply does not apply.
    return false;
  }
}
