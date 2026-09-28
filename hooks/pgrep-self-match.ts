#!/usr/bin/env bun
/**
 * PreToolUse (Bash|Monitor) BLOCKING GATE: stop a `pgrep -f` / `pkill -f` whose pattern will match
 * the invoking shell's own command line.
 *
 * `-f` matches the FULL command line, and the shell running the pgrep is itself in the process table
 * carrying that pattern in its argv. So `while pgrep -f myjob; do sleep 5; done` finds itself every
 * time and never exits, and `pkill -f myjob` kills its own subshell.
 *
 * WHY THE BRACKET HEURISTIC IS GONE. The previous revision treated '[m]yproc' and an absolute path
 * as "guarded" and only ever warned. Measured 2026-09-28:
 *
 *     pkill -f '[f]arm.sh --tasks .*tasks11.json'; ...; pgrep -f '[t]asks11.json' | xargs -r kill
 *
 * killed the invoking shell (exit 144). Both patterns are bracketed, so the old rule stayed silent —
 * but `[t]asks11.json` matches the literal text `tasks11.json` sitting EARLIER ON THE SAME COMMAND
 * LINE, inside the first pkill's pattern. Bracketing only stops a pattern matching its own spelling;
 * it says nothing about the rest of the argv. So the heuristic is replaced by the thing it was
 * approximating: compile the pattern and TEST IT against the command string the tool will run. That
 * test subsumes both old exemptions — '[m]yproc' does not match its own text and passes, an absolute
 * path does match its own text and is a real self-match.
 *
 * ONE LAYER, DETERMINISTIC. A model layer that judged over-breadth was built and measured, and
 * dropped: it scored the incident and a harmless tail alike.
 *
 * CRASH POLICY. `denyOnCrash`, matching every other blocking gate here (image-read-guard,
 * cron-delete-guard, find-slide-page-inject): a non-zero exit is treated as NON-BLOCKING by Claude
 * Code, i.e. a silent allow.
 */
import { allow, deny, denyOnCrash, parsePayload } from "./_gate_common.ts";

// FIRST STATEMENT WITH AN EFFECT: a throw below becomes a schema-valid deny rather than an exit-1,
// which Claude Code treats as non-blocking — a silent allow in a PreToolUse gate.
denyOnCrash("PGREP GUARD");

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
 * `while pgrep -f worker.py; do ...` is a segment whose command word is pgrep. Splitting on `$(`
 * and backtick is what makes `kill $(pgrep -f x)` read as a kill segment plus a pgrep segment.
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

interface Invocation {
  tool: "pgrep" | "pkill";
  pattern: string | null;
}

export interface Analysis {
  /** Invocations whose pattern MATCHES the command string itself — certain, no model needed. */
  selfMatches: Invocation[];
}

/**
 * Compile a pgrep pattern the way pgrep does — as an extended regex.
 *
 * JS RegExp is ERE plus extensions, which is the right direction for a guard: it accepts everything
 * pgrep accepts except POSIX character classes (`[[:alpha:]]`), which fail to compile here.
 */
function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Parse one pgrep/pkill segment. Returns null when the segment is not one, or uses -x. */
function parseInvocation(seg: { words: Word[] }): { inv: Invocation; full: boolean } | null {
  const ci = commandWordIndex(seg.words);
  if (ci < 0) return null;
  const word = seg.words[ci];
  if (word.quoted) return null; // came out of quotes; not a command position
  const name = word.text.split("/").pop();
  if (name !== "pgrep" && name !== "pkill") return null;

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

  if (exact) return null; // -x is a whole-name match; it cannot pick up a pattern from an argv
  return { inv: { tool: name, pattern }, full };
}

/**
 * Classify every pgrep/pkill in one Bash command string.
 *
 * The deterministic test is the whole point: each `-f` pattern is compiled and matched against
 * `command`, which is what the shell's own argv will carry. A hit means the process will find
 * itself, and that is certain rather than judged. Anything the text cannot settle — no `-f`, a
 * pattern from a variable, a pattern that will not compile — is allowed silently: an uncompilable
 * `-f` pattern is an error pgrep itself will report, and this gate exists only for the certain case.
 */
export function analyze(command: string): Analysis {
  const segs = segments(command);
  if (excludesSelf(segs)) return { selfMatches: [] };
  const selfMatches: Invocation[] = [];

  for (const seg of segs) {
    const parsed = parseInvocation(seg);
    if (!parsed) continue;
    const { inv, full } = parsed;
    if (!full || inv.pattern === null) continue; // a name-only match cannot pick the pattern out of an argv
    const re = compilePattern(inv.pattern);
    if (re && re.test(command)) selfMatches.push(inv);
  }
  return { selfMatches };
}

/** Truncate an untrusted pattern before echoing it back into the model's context. */
function show(pattern: string | null): string {
  if (pattern === null) return "<pattern from a variable>";
  const p = pattern.length > 60 ? pattern.slice(0, 57) + "..." : pattern;
  return p.replace(/[\n\r]/g, " ");
}

/** The one-line fix, named in every message this gate emits. */
const FIX =
  "Fix: bracket the pattern ('[m]yproc') AND make sure that literal text appears nowhere " +
  "else in the command — or better, signal exact pids, use `pgrep -x <name>` without -f, or a pidfile.";

// ── GATE ────────────────────────────────────────────────────────────────────────────────────────

// A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ — a local `catch { exit 0 }` here would be
// the silent allow `denyOnCrash` exists to prevent.
const payload = parsePayload(await Bun.stdin.text());

const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
const command = typeof toolInput.command === "string" ? toolInput.command : "";
if (!command) allow();

const { selfMatches } = analyze(command);

// Any self-match denies: a self-matching kill takes out its own shell, and a self-matching wait loop
// never exits.
if (selfMatches.length) {
  deny(
    "🛑 " +
      selfMatches
        .map(
          f =>
            `\`${f.tool} -f '${show(f.pattern)}'\` matches THIS command's own text, so it will find the ` +
            `shell running it${f.tool === "pkill" ? " and kill it" : " (a wait loop on it never exits)"}.`,
        )
        .join("\n") +
      "\n" + FIX,
  );
}

allow();
