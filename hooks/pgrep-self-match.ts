#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Monitor), WARN-ONLY: flag `pgrep -f` / `pkill -f` whose pattern can match the
 * invoking shell's own command line.
 *
 * `-f` matches the FULL command line, and the shell running the pgrep is itself in the process
 * table with that pattern in its argv. So `while pgrep -f myjob; do sleep 5; done` finds itself,
 * every time, and never exits -- measured 2026-09-27, a wait loop that never terminated. The same
 * shape makes `pkill -f` kill its own subshell and makes any `pgrep -f | wc -l` count one too many.
 *
 * NEVER DENIES. This is advisory: the trap has legitimate exceptions (a pattern the shell provably
 * cannot carry, an interactive one-shot), and a gate that blocks them would be worked around rather
 * than read. It emits additionalContext and nothing else, and ANY failure exits 0 silently --
 * `denyOnCrash` is deliberately NOT used here, since a crash turning into a deny is exactly the
 * outcome a warn-only hook must not produce.
 */
import { context } from "./_gate_common.ts";

// A crash must be a non-event, not a decision. Registered before anything that can throw.
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

/** Short options that consume a value (pgrep/pkill: -d delim, -u/-U uid, -P ppid, ...). */
const VALUE_SHORT = "dgGPstuUF";
/** Long options that consume a following token. */
const VALUE_LONG = new Set([
  "--delimiter", "--pgroup", "--group", "--parent", "--session", "--terminal",
  "--euid", "--uid", "--ns", "--nslist", "--signal", "--pidfile",
]);

interface Word {
  text: string;
  /** True when every character came from inside quotes -- `echo "pgrep -f x"` must not count. */
  quoted: boolean;
}

/**
 * Split a command into pipeline segments of words, quote-aware.
 *
 * Segment boundaries are the unquoted shell separators. This is what makes `echo "pgrep -f x"` a
 * single `echo` segment (the pgrep text is one quoted WORD, never a command position) while
 * `while pgrep -f worker.py; do ...` is a segment whose command word is pgrep.
 */
function segments(command: string): { words: Word[]; piped: boolean }[] {
  const out: { words: Word[]; piped: boolean }[] = [];
  let words: Word[] = [];
  let cur = "";
  let curQuoted = false;
  let curStarted = false;
  let quote: '"' | "'" | null = null;
  let pipedInto = false;

  const endWord = () => {
    if (curStarted) words.push({ text: cur, quoted: curQuoted && cur.length > 0 });
    cur = "";
    curQuoted = false;
    curStarted = false;
  };
  const endSegment = (nextPiped: boolean) => {
    endWord();
    if (words.length) out.push({ words, piped: pipedInto });
    words = [];
    pipedInto = nextPiped;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        cur += command[++i];
        curStarted = true;
      } else {
        cur += ch;
        curStarted = true;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch as '"' | "'";
      curStarted = true;
      if (cur.length === 0) curQuoted = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      cur += command[++i];
      curStarted = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      endWord();
      continue;
    }
    if (ch === "|") {
      const isOr = command[i + 1] === "|";
      endSegment(!isOr);
      if (isOr) i++;
      continue;
    }
    if (ch === ";" || ch === "&" || ch === "\n" || ch === "(" || ch === ")" || ch === "`" || ch === "{" || ch === "}") {
      if (ch === "&" && command[i + 1] === "&") i++;
      endSegment(false);
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      endSegment(false);
      i++;
      continue;
    }
    cur += ch;
    curStarted = true;
  }
  endSegment(false);
  return out;
}

/** Shell keywords and wrappers that sit in front of the real command word. */
const PREFIXES = new Set(["while", "until", "if", "elif", "then", "do", "done", "!", "sudo", "time", "command", "exec", "nohup", "env"]);

/** Strip leading keywords and `VAR=value` assignments; return the index of the command word. */
function commandWordIndex(words: Word[]): number {
  let i = 0;
  while (i < words.length) {
    const w = words[i].text;
    if (PREFIXES.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

interface Finding {
  tool: string;
  pattern: string;
}

/** A pattern is guarded when the shell's own argv provably cannot match it. */
function guardedPattern(pattern: string): boolean {
  if (/\[[^\]]+\]/.test(pattern)) return true; // bracket class: '[m]yproc'
  if (pattern.startsWith("/")) return true; // anchored to an absolute path
  return false;
}

/** `... | grep -v $$` (in any flag spelling) excludes the invoking shell. */
function excludesSelf(segs: { words: Word[]; piped: boolean }[]): boolean {
  for (const seg of segs) {
    if (!seg.piped) continue;
    const ci = commandWordIndex(seg.words);
    if (ci < 0) continue;
    const name = seg.words[ci].text.split("/").pop();
    if (name !== "grep" && name !== "rg") continue;
    const rest = seg.words.slice(ci + 1);
    const hasV = rest.some(w => /^--invert-match$/.test(w.text) || (/^-[A-Za-z]+$/.test(w.text) && w.text.includes("v")));
    const hasSelf = rest.some(w => w.text.includes("$$"));
    if (hasV && hasSelf) return true;
  }
  return false;
}

/** Scan one Bash command string; return every unguarded `-f` invocation it contains. */
export function scan(command: string): Finding[] {
  const segs = segments(command);
  const selfExcluded = excludesSelf(segs);
  const findings: Finding[] = [];

  for (const seg of segs) {
    const ci = commandWordIndex(seg.words);
    if (ci < 0) continue;
    const word = seg.words[ci];
    if (word.quoted) continue; // came out of quotes; not a command position
    const name = word.text.split("/").pop();
    if (name !== "pgrep" && name !== "pkill") continue;

    let full = false;
    let exact = false;
    let pattern: string | null = null;

    const args = seg.words.slice(ci + 1);
    for (let i = 0; i < args.length; i++) {
      const t = args[i].text;
      if (t === "--") continue;
      if (t.startsWith("--")) {
        const long = t.split("=")[0];
        if (long === "--full") full = true;
        if (long === "--exact") exact = true;
        if (VALUE_LONG.has(long) && !t.includes("=")) i++;
        continue;
      }
      if (t.length > 1 && t.startsWith("-")) {
        if (/^-\d+$/.test(t) || /^-[A-Z]+[0-9]*$/.test(t)) continue; // pkill signal: -9, -TERM
        const chars = t.slice(1);
        for (let c = 0; c < chars.length; c++) {
          const ch = chars[c];
          if (ch === "f") full = true;
          else if (ch === "x") exact = true;
          else if (VALUE_SHORT.includes(ch)) {
            if (c === chars.length - 1) i++; // value is the next word
            break; // rest of this token is the value
          }
        }
        continue;
      }
      pattern = t;
      break;
    }

    if (!full || exact || selfExcluded) continue;
    if (pattern === null) continue; // no pattern word (a variable-only form is not decidable here)
    if (guardedPattern(pattern)) continue;
    findings.push({ tool: name, pattern });
  }
  return findings;
}

/** Truncate an untrusted pattern before echoing it back into the model's context. */
function show(pattern: string): string {
  const p = pattern.length > 60 ? pattern.slice(0, 57) + "..." : pattern;
  return p.replace(/[\n\r]/g, " ");
}

const raw = await Bun.stdin.text();
let parsed: unknown = null;
try {
  parsed = JSON.parse(raw);
} catch {
  process.exit(0); // advisory: unreadable input is a non-event, never a decision
}
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) process.exit(0);
const payload = parsed as Record<string, unknown>;

const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
const command = typeof toolInput.command === "string" ? toolInput.command : "";
if (!command) process.exit(0);

const findings = scan(command);
if (!findings.length) process.exit(0);

const event = typeof payload.hook_event_name === "string" && payload.hook_event_name
  ? payload.hook_event_name
  : "PreToolUse";

const lines = findings.map(
  f => `${f.tool} -f '${show(f.pattern)}' also matches this shell's own command line, so it finds itself (a wait loop on it never exits).`,
);
context(
  event,
  lines.join("\n") +
    "\nUse the bracket form '[x]yz', or pgrep -x <name> without -f, or exclude $$ with `| grep -v $$`.",
);
