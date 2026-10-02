/**
 * PreToolUse (Bash|Monitor) BLOCKING GATE over Bash command TEXT. Two rules, each one a command
 * whose failure mode is a hang or a suicide rather than an error:
 *
 *   1. `pgrep -f` / `pkill -f` whose pattern matches the invoking shell's own command line.
 *   2. `rg` / `rga` with no path argument, in a segment nothing pipes into.
 *
 * The file keeps its original name: rule 1 is the one with the incident history below, and the
 * hook path is wired in hooks.json and referenced by the test.
 *
 * ── RULE 2: `rg` WITH NO PATH ───────────────────────────────────────────────────────────────────
 *
 * ripgrep searches STDIN when it is given no path and stdin is not a terminal. Under the Bash tool
 * stdin is never a terminal, so a path-less `rg` reads a pipe that no one will ever close. Measured
 * 2026-09-28 on ripgrep 15.2.0, stdin a fifo held open by a sleeping writer:
 *
 *     rg foo                          -> blocked until killed   (timeout, exit 124)
 *     rg foo .                        -> exit 0, immediate
 *     rg -e foo                       -> blocked
 *     rg -e foo .                     -> exit 0
 *     rg -f patterns                  -> blocked  (-f gives the pattern; there is still no path)
 *     rg --files / --type-list        -> exit 0   (no-pattern modes never read stdin)
 *     rg (no pattern at all)          -> exit 2   (usage error; rg never gets as far as stdin)
 *
 * The incident: a farmed agent ran
 *     rg -n -i craft --hidden -g '!.git' -g '!CHANGELOG.md' -c | sort
 * with no path. It hung for 34 minutes until killed. Note the pipe is on the WRONG SIDE — the
 * segment pipes OUT to sort and nothing pipes IN, so rg's stdin was still the tool's own.
 *
 * Parsing rg's flags is the whole difficulty, because a value-taking flag's operand is not a path:
 * in `-g '!.git' foo` the only positional is the pattern. So the value-taking flags are enumerated
 * from `rg -h` rather than guessed, and `-e`/`-f` are tracked separately because they supply the
 * pattern, which makes the FIRST positional already a path.
 *
 * ── RULE 1: pgrep/pkill SELF-MATCH ──────────────────────────────────────────────────────────────
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
 * CRASH POLICY. A crash DENIES in both hosts: the script through `denyOnCrash`, the mod through its
 * catch (hooks/guards/mod.ts). A non-zero exit is treated as NON-BLOCKING by Claude Code, i.e. a
 * silent allow.
 */
import type { Guard } from './core.ts'

/** Short options that consume a value (pgrep/pkill: -d delim, -u/-U uid, -P ppid, ...). */
const VALUE_SHORT = "dgGPstuUF";
/** Long options that consume a following token. */
const VALUE_LONG = new Set([
  "--delimiter", "--pgroup", "--group", "--parent", "--session", "--terminal",
  "--euid", "--uid", "--ns", "--nslist", "--signal", "--pidfile",
]);

export interface Word {
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
export function segments(command: string): { words: Word[]; piped: boolean }[] {
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
export function commandWordIndex(words: Word[]): number {
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
  /** `rg`/`rga` segments with no path and no incoming pipe or redirect — they read a live stdin. */
  pathlessRg: string[];
}

// ── rg FLAG TABLE (enumerated from `rg -h`, ripgrep 15.2.0) ─────────────────────────────────────

/** Short flags whose operand is the NEXT token (or the rest of the cluster): -A3, -g '!x', -tpy. */
const RG_VALUE_SHORT = "ABCdeEfgjmMrtT";

/** Long flags whose operand is the next token when not spelled `--flag=value`. */
const RG_VALUE_LONG = new Set([
  "--after-context", "--before-context", "--color", "--colors", "--context",
  "--context-separator", "--dfa-size-limit", "--encoding", "--engine", "--file",
  "--field-context-separator", "--field-match-separator", "--generate", "--glob",
  "--hostname-bin", "--hyperlink-format", "--iglob", "--ignore-file", "--max-columns",
  "--max-count", "--max-depth", "--max-filesize", "--path-separator", "--pre", "--pre-glob",
  "--regexp", "--regex-size-limit", "--replace", "--sort", "--sortr", "--threads", "--type",
  "--type-add", "--type-clear", "--type-not",
]);

/** Flags that supply the PATTERN, which makes the first positional already a PATH. */
const RG_PATTERN_FLAGS = new Set(["-e", "--regexp", "-f", "--file"]);

/** Modes that take no pattern and never read stdin — verified empirically, see the header. */
const RG_NO_PATTERN_MODE = new Set(["--files", "--type-list", "--version", "--help", "--generate"]);

/** An unquoted redirect token: `<`, `<<EOF`, `<<<x`, `2>`, `>out`, `<&3`. */
function redirectKind(w: Word): "in" | "out" | null {
  if (w.quoted) return null;
  if (/^\d*<|^<</.test(w.text)) return "in";
  if (/^\d*>/.test(w.text)) return "out";
  return null;
}

/**
 * Decide whether one segment is an `rg`/`rga` that will read a stdin nobody closes.
 *
 * Returns the offending segment's text, or null. A segment fed by a pipe or by ANY input redirect
 * is fine — stdin is then a real, finite source, which is ripgrep's documented streaming mode.
 */
function pathlessRgSegment(seg: { words: Word[]; piped: boolean }): string | null {
  const ci = commandWordIndex(seg.words);
  if (ci < 0) return null;
  const word = seg.words[ci];
  if (word.quoted) return null; // came out of quotes; not a command position
  const name = word.text.split("/").pop();
  if (name !== "rg" && name !== "rga") return null;
  if (seg.piped) return null; // `cmd | rg foo` — stdin is the pipe, and it ends

  const args = seg.words.slice(ci + 1);
  let positionals = 0;
  let patternFromFlag = false;
  let noPatternMode = false;
  let endOfFlags = false;

  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    const t = w.text;

    if (!endOfFlags) {
      const redir = redirectKind(w);
      if (redir === "in") return null; // `rg foo < file`, heredoc, here-string
      if (redir === "out") {
        // A bare `>` / `2>` carries its operand in the next token; `>out.txt` carries its own.
        if (/^\d*>>?$/.test(t)) i++;
        continue;
      }
      if (t === "--") {
        endOfFlags = true;
        continue;
      }
      if (t.startsWith("--")) {
        const long = t.split("=")[0];
        if (RG_NO_PATTERN_MODE.has(long)) noPatternMode = true;
        if (RG_PATTERN_FLAGS.has(long)) patternFromFlag = true;
        if (RG_VALUE_LONG.has(long) && !t.includes("=")) i++;
        continue;
      }
      if (t.length > 1 && t.startsWith("-")) {
        const chars = t.slice(1);
        for (let c = 0; c < chars.length; c++) {
          const ch = chars[c];
          if (RG_VALUE_SHORT.includes(ch)) {
            if (ch === "e" || ch === "f") patternFromFlag = true;
            if (c === chars.length - 1) i++; // operand is the next word
            break; // rest of this token is the operand
          }
        }
        continue;
      }
      if (t === "-") return null; // `-` is the explicit "read stdin" spelling; deliberate
    }
    positionals++;
  }

  if (noPatternMode) return null; // --files / --type-list / --version: no pattern, no stdin read
  // Without -e/-f the first positional is the PATTERN, so a path needs a SECOND one. With -e/-f the
  // pattern is already in hand, so the first positional is a path.
  const paths = patternFromFlag ? positionals : positionals - 1;
  if (paths > 0) return null;
  // No pattern anywhere: rg exits 2 on a usage error without ever reaching stdin.
  if (!patternFromFlag && positionals === 0) return null;

  return seg.words.map(x => x.text).join(" ");
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
  const pathlessRg: string[] = [];
  for (const seg of segs) {
    const bad = pathlessRgSegment(seg);
    if (bad) pathlessRg.push(bad);
  }

  if (excludesSelf(segs)) return { selfMatches: [], pathlessRg };
  const selfMatches: Invocation[] = [];

  for (const seg of segs) {
    const parsed = parseInvocation(seg);
    if (!parsed) continue;
    const { inv, full } = parsed;
    if (!full || inv.pattern === null) continue; // a name-only match cannot pick the pattern out of an argv
    const re = compilePattern(inv.pattern);
    if (re && re.test(command)) selfMatches.push(inv);
  }
  return { selfMatches, pathlessRg };
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


export const pgrepSelfMatch: Guard = async payload => {
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  if (!command) return {};

  const { selfMatches, pathlessRg } = analyze(command);

  // A path-less rg reads the tool's own stdin, which never closes: the process hangs rather than
  // erroring, so nothing downstream ever reports it.
  if (pathlessRg.length) {
    return {
      deny:
        "🛑 " +
        pathlessRg.map(s => `\`${show(s)}\` has no path argument.`).join("\n") +
        "\nrg reads stdin when given no path and stdin is not a terminal; pass a path, e.g. `rg PATTERN .`",
    };
  }

  // Any self-match denies: a self-matching kill takes out its own shell, and a self-matching wait
  // loop never exits.
  if (selfMatches.length) {
    return {
      deny:
        "🛑 " +
        selfMatches
          .map(
            f =>
              `\`${f.tool} -f '${show(f.pattern)}'\` matches THIS command's own text, so it will find the ` +
              `shell running it${f.tool === "pkill" ? " and kill it" : " (a wait loop on it never exits)"}.`,
          )
          .join("\n") +
        "\n" + FIX,
    };
  }
  return {};
};
