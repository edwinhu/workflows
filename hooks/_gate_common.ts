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

/** Read the whole hook payload from stdin. */
export async function readPayload(): Promise<Record<string, unknown>> {
  return JSON.parse(await Bun.stdin.text());
}
