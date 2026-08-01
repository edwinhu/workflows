#!/usr/bin/env bun
/**
 * Shared helpers for the PreToolUse gate hooks — TypeScript port of _gate_common.py.
 *
 * Ported first and alone: 12 hooks import it, and it defines the output contract they all share, so
 * getting it wrong breaks 12 hooks identically and silently.
 *
 * THE BYTE-COMPATIBILITY TRAP
 *   Python's `json.dumps` defaults to separators `", "` / `": "` and `ensure_ascii=True`.
 *   `JSON.stringify` uses no spaces and emits non-ASCII literally. So the same object serializes to
 *   different bytes in the two languages:
 *
 *     python  json.dumps({"a": "🛑"})  ->  {"a": "🛑"}
 *     js      JSON.stringify(...)      ->  {"a":"🛑"}
 *
 *   Every deny message in this repo starts with 🛑, so a naive port changes the bytes of every
 *   blocked tool call. `pyJson` reproduces Python's format exactly; use it for anything a hook
 *   prints, never `JSON.stringify`.
 */

import { createHash } from "node:crypto";

/** Serialize exactly as Python's `json.dumps` does by default: `", "` / `": "`, ensure_ascii. */
export function pyJson(value: unknown): string {
  const esc = (s: string): string => {
    let out = '"';
    // Iterate code UNITS, not code points. Python's ensure_ascii escapes each UTF-16 unit, so an
    // astral char emits a surrogate PAIR (🛑 -> 🛑). Iterating code points emits only
    // \ud83d and silently truncates the character — caught by the parity harness on its first run.
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const code = s.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
      // ensure_ascii: every non-ASCII code UNIT becomes \uXXXX, so astral chars
      // emit a surrogate pair exactly as Python does (🛑 -> 🛑).
      else if (code > 0x7e) out += "\\u" + code.toString(16).padStart(4, "0");
      else out += ch;
    }
    return out + '"';
  };

  const enc = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
    if (typeof v === "string") return esc(v);
    if (Array.isArray(v)) return "[" + v.map(enc).join(", ") + "]";
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      return "{" + entries.map(([k, x]) => `${esc(k)}: ${enc(x)}`).join(", ") + "}";
    }
    return "null";
  };
  return enc(value);
}

/** Block the tool call. PreToolUse gates go through hookSpecificOutput.permissionDecision. */
export function deny(reason: string): never {
  console.log(
    pyJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/**
 * PreToolUse: silence IS the allow.
 *
 * There is no `{"decision": "allow"}` in the hook contract. Emitting one gets the WHOLE payload
 * rejected ("Hook JSON output validation failed"), which is harmless for an allow but means the
 * same code path's *block* is rejected too — the guard silently stops guarding. Print nothing.
 */
export function allow(): never {
  process.exit(0);
}

/**
 * A CRASH IS A DENIAL, NOT A NON-EVENT.
 *
 * Claude Code treats a hook that exits non-zero as NON-BLOCKING: the message goes to stderr and the
 * tool call proceeds. So an unhandled throw in a PreToolUse gate is a silent ALLOW, which is the
 * exact opposite of what a gate whose header promises "it fails CLOSED" is for. Measured: a receipt
 * carrying `workflow: "constructor"` made `builtInOrchestratorDirectories` return `undefined`,
 * `permitted.some` threw, `implementer-identity-gate` exited 1, and the approving conversation's
 * `Write` to arbitrary project code landed ungated under an APPROVED receipt.
 *
 * THE HANDLER MUST NOT ITSELF THROW. It formats one fixed-shape deny with `pyJson` over a string it
 * builds from the error's own text, and everything that could fail — reading `.stack`, a getter on a
 * thrown exotic object — sits inside its own try. If even that fails it still denies, with a
 * generic reason. There is no path through here that reaches `process.exit(1)`.
 *
 * `readPayload`'s deliberate `process.exit(1)` on a non-object payload is UNAFFECTED: it exits
 * rather than throws, precisely so no local catch — and now no global handler — can reinterpret it.
 * That one case keeps its Python-parity crash semantics.
 */
export function denyOnCrash(gate: string): void {
  const denyFromError = (kind: string, error: unknown): void => {
    let detail: string;
    try {
      detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } catch {
      detail = "an unrepresentable value was thrown";
    }
    try {
      // Deliberately NOT `deny()`: keep the emission inline so a future change to deny's shape
      // cannot make the crash path print something the schema rejects.
      console.log(
        pyJson({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              `${gate}: this gate crashed (${kind}: ${detail}) and could not decide. A gate that cannot ` +
              `resolve identity or policy denies; a non-zero exit would have been treated as non-blocking ` +
              `and silently permitted this call. Re-run after fixing the underlying fault.`,
          },
        }),
      );
    } catch {
      console.log('{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "gate crashed and could not decide"}}');
    }
    process.exit(0);
  };
  process.on("uncaughtException", error => denyFromError("uncaughtException", error));
  process.on("unhandledRejection", error => denyFromError("unhandledRejection", error));
}

/**
 * Non-blocking feedback to Claude, on any event that accepts additionalContext.
 *
 * `event` MUST equal the event the hook is wired to: a hookEventName that disagrees with the wiring
 * is rejected exactly like an unsupported field. Read it from the payload's `hook_event_name` rather
 * than hardcoding when a hook is wired to more than one event.
 */
export function context(event: string, text: string): never {
  console.log(pyJson({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
  process.exit(0);
}

/**
 * Resolve the project directory the gate should audit.
 *
 * `args.projectDir` is only ever populated on `Workflow` tool calls — `Agent` calls never carry it.
 * Without a fallback the gate audits the hook process's own cwd, silently no-oping. Falls back to
 * the payload's top-level `cwd` (always set for PreToolUse), then ".".
 */
export function projectFromArgs(toolInput: Record<string, unknown>, hookInput?: Record<string, unknown>): string {
  let args = toolInput?.args as unknown;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  if (args && typeof args === "object" && (args as Record<string, unknown>).projectDir) {
    return String((args as Record<string, unknown>).projectDir);
  }
  if (hookInput?.cwd) return String(hookInput.cwd);
  return ".";
}

/**
 * Enforce the payload-is-an-object precondition by EXITING, not throwing.
 *
 * Throwing was not enough: the hooks mirror Python's shape, where only `json.load` sat inside the
 * try — so they wrap the read in `try { ... } catch { return 0 }`, and that catch swallowed the
 * TypeError, restoring the silent allow this is meant to prevent. In Python the AttributeError from
 * `.get()` on a non-dict is raised OUTSIDE the try and propagates all the way out, exiting 1.
 * Exiting here reproduces that: no local catch can intercept it, which is the entire point.
 */
function requireObject(parsed: unknown): Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const got = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
    console.error(`AttributeError: hook payload must be an object, got ${got}`);
    process.exit(1);
  }
  return parsed as Record<string, unknown>;
}

/** Read the whole hook payload from stdin.
 *
 * THROWS on a payload that parses to a non-object, matching the Python originals.
 *
 * Python wrapped only `json.load` in try/except; the subsequent `hook_input.get(...)` sat OUTSIDE
 * it, so stdin that is valid JSON but not a dict (`null`, `"str"`, `[1,2]`) raised AttributeError
 * and exited 1. The first ports used optional chaining and returned an ALLOW instead — turning a
 * fail-closed crash into a silent permit across 10 hooks, with no golden covering it because the
 * "unparseable-stdin" cases omit the stdin key entirely and both sides then agree on empty input.
 *
 * A guard that exits 0 on garbage it does not understand is worse than one that dies loudly.
 */
export async function readPayload(): Promise<Record<string, unknown>> {
  return requireObject(JSON.parse(await Bun.stdin.text()));
}

/**
 * Parse a hook payload with the same non-object strictness as readPayload, for hooks that read
 * stdin themselves rather than awaiting it.
 */
export function parsePayload(text: string): Record<string, unknown> {
  return requireObject(JSON.parse(text));
}

/**
 * The per-session key for the DS subagent-completion flag file.
 *
 * WHY NOT process.env.CLAUDE_SESSION_ID
 *   Claude Code never sets it. The three DS flag hooks all resolved to the literal "default", so
 *   every concurrent session process-wide shared ONE flag file: a subagent returning in one session
 *   armed the Read/Grep block in every other session, and clearing it in one disarmed all of them.
 *   The variable's absence is invisible — the guard keeps running and keeps exiting 0.
 *
 * The payload's `session_id` is the real per-session identity and is present on every hook event
 * these three are wired to, so all three derive the same key for the same session. The env fallback
 * is the session-tree id Claude Code does set; "default" survives only as the last resort, which is
 * also the only case where the original collision can still occur.
 *
 * The result is a FILENAME component, so anything outside [A-Za-z0-9._-] must not survive: a session
 * id is opaque and must never introduce a path separator or a `..` traversal.
 *
 * WHY DELETING THE UNSAFE CHARACTERS WAS NOT ENOUGH
 *   The first version returned `candidate.replace(/[^A-Za-z0-9._-]/g, "")`. Deletion is not
 *   injective, so DISTINCT sessions collapsed onto ONE key — measured: "sess/one", "sess#one",
 *   "sess one", and "sessone" all produced "sessone", and "a#b" collided with "ab". That is the
 *   very cross-session flag sharing this function was introduced to fix, merely made rarer: two
 *   sessions whose ids differ only in a stripped character share a flag file, so one session's
 *   returning subagent arms the Read block in the other.
 *
 *   The fix appends a digest of the RAW id. The readable prefix is still the sanitized id (so the
 *   files stay diagnosable by eye) but the digest is what separates the keys, and it is computed
 *   before any sanitization, so two ids that differ only in a stripped character no longer collide.
 *   It also removes the `..` hazard structurally: a key derived from an id always ends in
 *   `-<32 hex chars>`, so it can never BE `.` or `..` regardless of the input.
 *
 * THE ONE COLLISION THAT REMAINS, STATED PLAINLY
 *   The mapping is injective over IDS, not over CALLS. When neither the payload nor the environment
 *   supplies an identity there is nothing to hash, and every such call returns the literal
 *   "default" — so all identity-less sessions still share one flag file, which is the original
 *   cross-session sharing bug in its last remaining form. It is bounded rather than fixed: the
 *   environment fallback means it needs BOTH sources absent, and "default" cannot collide with any
 *   real id, since a derived key always carries the `-<32 hex>` suffix.
 */
export function sessionFlagKey(payload?: unknown): string {
  const fromPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).session_id
    : undefined;
  for (const candidate of [fromPayload, process.env.CLAUDE_CODE_SESSION_ID]) {
    if (typeof candidate !== "string" || !candidate) continue;
    const readable = candidate.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
    const digest = createHash("sha256").update(candidate, "utf8").digest("hex").slice(0, 32);
    return readable ? `${readable}-${digest}` : digest;
  }
  return "default";
}
