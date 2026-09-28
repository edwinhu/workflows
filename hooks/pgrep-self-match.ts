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
 * TWO LAYERS.
 *   1. DETERMINISTIC (certain, no model): pattern-vs-command-string. A match denies, whether the
 *      result feeds a kill or only a read — a self-matching wait loop never exits either.
 *   2. JEV (for what text cannot settle): no self-match, but the command still uses `-f` or pipes
 *      pgrep into kill. One `noul` question about whether the pattern will hit a process other than
 *      the intended one — a parent agent session, a farmed child whose prompt carries the pattern
 *      text, another session's job. Over threshold: DENY when a kill is involved, warn when it is a
 *      read. Jev unavailable is never a deny — the guard must not inherit the endpoint's uptime.
 *
 * CRASH POLICY. `denyOnCrash`, matching every other blocking gate here (image-read-guard,
 * cron-delete-guard, find-slide-page-inject): a non-zero exit is treated as NON-BLOCKING by Claude
 * Code, i.e. a silent allow. The Jev phase is exempt by construction — it sits inside its own
 * try/catch and every failure becomes "unavailable", so the model leg can never produce a denial.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allow, context, deny, denyOnCrash, parsePayload, sessionFlagKey } from "./_gate_common.ts";

/**
 * The question, asked of Jev as a `noul` (return the probability that this is true).
 * Exported so a test can assert the wording the threshold was chosen against.
 */
export const OVERBROAD_QUESTION =
  "Running this command will signal or match a process other than the one the author intends — " +
  "e.g. this shell, a parent agent session, a farmed child whose prompt or arguments contain the " +
  "pattern text, or another session's job — because the pattern is broad or matches text that " +
  "appears in other processes' command lines.";

// ── CHILD MODE: the Jev ask ─────────────────────────────────────────────────────────────────────
// Isolated in a subprocess so the PARENT can time-box it. `decisionsCall` spends up to 60s inside
// curl, which is fine for a Stop hook and far too long for a gate standing in front of every Bash
// call; a subprocess is the only way to bound a synchronous spawnSync from outside.
// NOTE: registered BEFORE denyOnCrash — the child must never emit a permission decision.
if (process.argv.includes("--jev-ask")) {
  let out = '{"unavailable": "ask child produced nothing"}';
  try {
    const req = JSON.parse(await Bun.stdin.text()) as {
      state: string;
      questions: Record<string, { type: string; instructions: string }>;
    };
    // Dynamic: only the child pays hound's import cost, and the path is spelled once.
    const { decisionsCall } = await import("./hound.ts");
    const r = decisionsCall(req.state, req.questions);
    out = JSON.stringify(r.stdout === null ? { unavailable: r.unavailable } : { stdout: r.stdout });
  } catch (e) {
    out = JSON.stringify({ unavailable: `ask child failed: ${String(e)}` });
  }
  console.log(out);
  process.exit(0);
}

// FIRST STATEMENT WITH AN EFFECT in gate mode: a throw below becomes a schema-valid deny rather than
// an exit-1, which Claude Code treats as non-blocking — a silent allow in a PreToolUse gate.
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

/**
 * Would a pid this command finds be SIGNALLED?
 *
 * Deliberately coarse: any `kill`/`pkill` command word anywhere in the command, including as an
 * `xargs` argument. It covers `pgrep | xargs kill`, `kill $(pgrep ...)`, `kill \`pgrep ...\`` and a
 * loop body that kills, and it errs towards "yes", which is the direction that costs a warning
 * rather than an unnoticed dead shell.
 */
function killsSomething(segs: { words: Word[]; piped: boolean }[]): boolean {
  const isKill = (t: string) => {
    const n = t.split("/").pop();
    return n === "kill" || n === "pkill";
  };
  for (const seg of segs) {
    const ci = commandWordIndex(seg.words);
    if (ci < 0) continue;
    const w = seg.words[ci];
    if (w.quoted) continue;
    if (isKill(w.text)) return true;
    if (w.text.split("/").pop() === "xargs" && seg.words.slice(ci + 1).some(a => isKill(a.text))) return true;
  }
  return false;
}

interface Invocation {
  tool: "pgrep" | "pkill";
  pattern: string | null;
  /** The pattern would not compile as a regex, so self-match cannot be decided from text. */
  uncompilable: boolean;
}

export interface Analysis {
  /** Invocations whose pattern MATCHES the command string itself — certain, no model needed. */
  selfMatches: Invocation[];
  /** `-f` invocations with no deterministic verdict, plus kill-fed pgreps: the Jev layer's input. */
  candidates: Invocation[];
  /** True when a matched pid would be signalled. */
  killShaped: boolean;
}

/**
 * Compile a pgrep pattern the way pgrep does — as an extended regex.
 *
 * JS RegExp is ERE plus extensions, which is the right direction for a guard: it accepts everything
 * pgrep accepts except POSIX character classes (`[[:alpha:]]`), which land in `uncompilable` and are
 * handed to the Jev layer rather than waved through.
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
  return {
    inv: { tool: name, pattern, uncompilable: pattern !== null && compilePattern(pattern) === null },
    full,
  };
}

/**
 * Classify every pgrep/pkill in one Bash command string.
 *
 * The deterministic test is the whole point: each pattern is compiled and matched against
 * `command`, which is what the shell's own argv will carry. A hit means the process will find
 * itself, and that is certain rather than judged.
 */
export function analyze(command: string): Analysis {
  const segs = segments(command);
  const selfExcluded = excludesSelf(segs);
  const killShaped = killsSomething(segs);
  const selfMatches: Invocation[] = [];
  const candidates: Invocation[] = [];

  for (const seg of segs) {
    const parsed = parseInvocation(seg);
    if (!parsed) continue;
    const { inv, full } = parsed;
    // A pgrep with neither -f nor a kill downstream reads process NAMES only: out of scope.
    if (!full && !killShaped) continue;

    if (full && inv.pattern !== null && !inv.uncompilable && !selfExcluded) {
      const re = compilePattern(inv.pattern)!;
      if (re.test(command)) {
        selfMatches.push(inv);
        continue;
      }
    }
    candidates.push(inv);
  }
  return { selfMatches, candidates, killShaped };
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

// ── THE JEV LAYER ───────────────────────────────────────────────────────────────────────────────

/**
 * Ask Jev one question about the command. NEVER throws, NEVER denies; returns a probability or a
 * reason it is unavailable.
 *
 * `PGREP_GUARD_JEV_REPLY` is a TEST SEAM: the raw Decisions reply to use instead of calling out
 * (the literal `UNAVAILABLE` simulates an unreachable endpoint). It cannot weaken the deterministic
 * layer, which is the part that carries the incident, and anyone able to set it could equally set
 * `PGREP_GUARD_JEV_THRESHOLD=2` — the model layer is advisory reinforcement, not the lock.
 */
export function askJev(state: string): { p: number | null; unavailable: string | null } {
  let body: string | null = null;
  const stub = process.env.PGREP_GUARD_JEV_REPLY;
  if (stub !== undefined) {
    if (stub === "UNAVAILABLE") return { p: null, unavailable: "stubbed unavailable" };
    body = stub;
  } else {
    const r = spawnSync("bun", [import.meta.path, "--jev-ask"], {
      input: JSON.stringify({
        state,
        questions: { overbroad: { type: "noul", instructions: OVERBROAD_QUESTION } },
      }),
      encoding: "utf8",
      timeout: Number(process.env.PGREP_GUARD_JEV_TIMEOUT_MS || 3000),
    });
    if (r.error || r.status !== 0 || !r.stdout) {
      return { p: null, unavailable: "the ask subprocess failed or timed out" };
    }
    try {
      const o = JSON.parse(r.stdout) as { stdout?: string; unavailable?: string };
      if (o.unavailable) return { p: null, unavailable: o.unavailable };
      body = String(o.stdout ?? "");
    } catch {
      return { p: null, unavailable: "the ask subprocess reply was not parsable json" };
    }
  }
  try {
    const d = JSON.parse(body as string) as { answers?: Record<string, { noul?: unknown }> };
    const v = d?.answers?.overbroad?.noul;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { p: null, unavailable: "the decision reply carried no noul answer" };
    }
    return { p: v, unavailable: null };
  } catch {
    return { p: null, unavailable: "the decision reply was not parsable json" };
  }
}

/**
 * One JSONL line per Jev decision under $TMPDIR, so the threshold can be audited later.
 *
 * Session-scoped and high-frequency, so it belongs in the temp dir, never in a project state file.
 * The command is recorded as a digest: the log must be safe to read and must not become a second
 * copy of every command the session ran.
 */
function logDecision(session: string, command: string, record: Record<string, unknown>): void {
  try {
    const dir = join(process.env.TMPDIR || tmpdir(), "pgrep-guard");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, `${session}.jsonl`),
      JSON.stringify({
        ts: new Date().toISOString(),
        cmd_sha256: createHash("sha256").update(command, "utf8").digest("hex").slice(0, 16),
        ...record,
      }) + "\n",
    );
  } catch {
    /* the audit trail is not the gate: a log that cannot be written must not change a decision */
  }
}

// ── GATE ────────────────────────────────────────────────────────────────────────────────────────

// A PreToolUse GATE DENIES ON A PAYLOAD IT CANNOT READ — a local `catch { exit 0 }` here would be
// the silent allow `denyOnCrash` exists to prevent.
const payload = parsePayload(await Bun.stdin.text());

const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
const command = typeof toolInput.command === "string" ? toolInput.command : "";
if (!command) allow();

const event = typeof payload.hook_event_name === "string" && payload.hook_event_name
  ? payload.hook_event_name
  : "PreToolUse";

const { selfMatches, candidates, killShaped } = analyze(command);

// LAYER 1 — certain. Any self-match denies: a self-matching kill takes out its own shell, and a
// self-matching wait loop never exits.
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

if (!candidates.length) allow();

// LAYER 2 — judged. A crash in here is an UNAVAILABLE, never a denial.
const threshold = Number(process.env.PGREP_GUARD_JEV_THRESHOLD || 0.6);
const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
const state = `cwd: ${cwd}\ncommand:\n${command}`;
let verdict: { p: number | null; unavailable: string | null };
try {
  verdict = askJev(state);
} catch (e) {
  verdict = { p: null, unavailable: `the jev check crashed: ${String(e)}` };
}

const session = sessionFlagKey(payload);
const over = verdict.p !== null && verdict.p >= threshold;
logDecision(session, command, {
  session,
  p: verdict.p,
  threshold,
  kill_shaped: killShaped,
  unavailable: verdict.unavailable,
  decision: verdict.unavailable ? "allow-unavailable" : over ? (killShaped ? "deny" : "warn") : "allow",
});

if (verdict.unavailable) {
  // Never a deny: the guard must not inherit the endpoint's uptime.
  if (killShaped) {
    context(
      event,
      `This command signals processes matched by pattern, and the Jev over-breadth check did not run ` +
        `(${verdict.unavailable}). Nothing verified that the pattern hits only the intended process.\n${FIX}`,
    );
  }
  allow();
}

if (!over) allow();

const pct = Math.round((verdict.p as number) * 100);
const patterns = candidates.map(c => `${c.tool} -f '${show(c.pattern)}'`).join(", ");
if (killShaped) {
  deny(
    `🛑 ${patterns}: the judge puts it at ${pct}% (threshold ${Math.round(threshold * 100)}%) that this ` +
      `pattern will signal a process other than the intended one — this shell, a parent agent session, ` +
      `a farmed child carrying the pattern text in its argv, or another session's job.\n${FIX}`,
  );
}
context(
  event,
  `${patterns}: the judge puts it at ${pct}% (threshold ${Math.round(threshold * 100)}%) that this pattern ` +
    `matches processes other than the intended one, so the result may include this shell or another ` +
    `session's job. Reading is not fatal; acting on the pids would be.\n${FIX}`,
);
