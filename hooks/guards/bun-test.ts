/**
 * PreToolUse (Bash) BLOCKING GATE over Bash command TEXT: a `bun test` over more than one test file
 * — several paths, a directory or name filter, or no path at all (the whole repo) — without
 * `--parallel`.
 *
 * Measured 2026-10-02: this repo's suite took 661-881 s run serially from under ~/.tmp, and 63 s with
 * `bun test --parallel` from /tmp (scripts/test.sh). bun 1.4.0 has no bunfig.toml key or environment
 * variable that makes `--parallel` the default: `[test] parallel = true` is silently ignored, so the
 * flag on the command line is the only switch, and this gate asks for it.
 *
 * Exempt by construction: a single test file, `bun test --help`, a command that already passes
 * `--parallel`, and any harness that runs `bun test` internally (scripts/test.sh included) — the gate
 * sees only the command text, so it judges only a `bun test` in a command position of that text.
 *
 * CONSERVATIVE. Anything the text cannot settle is allowed: a path from a variable or a command
 * substitution, a quoted glob, `xargs bun test`, global bun flags before `test`. Never rewritten,
 * never approved: the answer is a deny or silence.
 */
import type { Guard } from './core.ts'
import { commandWordIndex, segments, type Word } from './pgrep.ts'

/** Flags whose operand is the NEXT token when not spelled `--flag=value`, from `bun test --help`
 *  (bun 1.4.0) plus the runtime flags `bun test` accepts. `--parallel`, `--bail`, `--coverage` and
 *  `--changed` take an optional `=value` and do NOT consume the next token (measured). */
const VALUE_LONG = new Set([
  '--timeout', '--rerun-each', '--retry', '--seed', '--coverage-reporter', '--coverage-dir',
  '--test-name-pattern', '--reporter', '--reporter-outfile', '--max-concurrency',
  '--path-ignore-patterns', '--parallel-delay', '--shard', '--timings',
  '--preload', '--cwd', '--env-file', '--config', '--tsconfig-override', '--define', '--loader', '--conditions',
])
const VALUE_SHORT = new Set(['-t', '-r', '-c', '-d', '-l'])

/** Commands that run their arguments as a command, after their own options. */
const WRAPPERS = new Set(['timeout', 'nice', 'ionice', 'stdbuf'])

/** A wrapper's own option or operand: `-k 10`, `600`, `1.5m`, `KILL`, `VAR=x`. */
const wrapperArg = (t: string): boolean =>
  t.startsWith('-') || /^[\d.]+[smhd]?$/.test(t) || /^[A-Z][A-Z0-9]*$/.test(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)

const SCRIPT_FILE = /\.[cm]?[jt]sx?$/

const basename = (t: string): string => t.split('/').pop() ?? t

/** Drop heredoc bodies: a `bun test` line inside `cat <<EOF` is text being written, not run. */
function stripHeredocs(command: string): string {
  const out: string[] = []
  const pending: string[] = []
  for (const line of command.split('\n')) {
    if (pending.length) {
      if (line.trim() === pending[0]) pending.shift()
      continue
    }
    out.push(line)
    for (const m of line.matchAll(/(^|[^<])<<-?\s*(['"]?)([A-Za-z_][\w.-]*)\2/g)) pending.push(m[3]!)
  }
  return out.join('\n')
}

/**
 * Leave a `$SUBST` word where each command substitution opens. The tokenizer ends a segment at `$(`
 * and at a backtick, so without it `bun test $(git ls-files)` would read as a bare `bun test`; with
 * it the outer segment has a target the text cannot count, and the inner command is still judged.
 */
function markSubstitutions(command: string): string {
  let ticks = 0
  return command.replace(/\$\(|`/g, m => (m === '`' ? (ticks++ % 2 === 0 ? ' $SUBST `' : '`') : ' $SUBST $('))
}

/** The index of the `bun` word of a `bun test` in this segment, or -1. */
function bunTestAt(words: Word[]): number {
  let i = commandWordIndex(words)
  if (i < 0) return -1
  while (i < words.length && !words[i]!.quoted && WRAPPERS.has(basename(words[i]!.text))) {
    i++
    while (i < words.length && wrapperArg(words[i]!.text) && basename(words[i]!.text) !== 'bun') i++
  }
  const bun = words[i]
  const sub = words[i + 1]
  if (!bun || !sub || bun.quoted || sub.quoted || basename(bun.text) !== 'bun' || sub.text !== 'test') return -1
  return i
}

/**
 * Why this segment's `bun test` runs several files serially, or null when it does not (not a
 * `bun test`, `--parallel` or `--help` given, one file, or a target the text cannot settle).
 */
function serialReason(words: Word[]): string | null {
  const at = bunTestAt(words)
  if (at < 0) return null
  const args = words.slice(at + 2)
  const positionals: Word[] = []
  let endOfFlags = false
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!
    const t = w.text
    if (!w.quoted && /^(\d*|&)[<>]/.test(t)) {
      // `2>&1` and `>out` carry their operand; a bare `>` / `2>` / `<` takes the next token.
      if (/^(\d*|&)(<|>>?)$/.test(t)) i++
      continue
    }
    if (!endOfFlags && t === '--') {
      endOfFlags = true
      continue
    }
    if (!endOfFlags && t.startsWith('-') && t.length > 1) {
      const long = t.split('=')[0]!
      if (long === '--parallel' || long === '--help' || t === '-h') return null
      if ((VALUE_LONG.has(long) && !t.includes('=')) || VALUE_SHORT.has(t)) i++
      continue
    }
    positionals.push(w)
  }
  // A path from a variable, a substitution or a quoted glob: the text cannot count the files.
  if (positionals.some(p => /[$`]/.test(p.text) || (p.quoted && /[*?[]/.test(p.text)))) return null
  if (positionals.length === 0) return 'the whole repo'
  if (positionals.length > 1) return `${positionals.length} paths`
  const only = positionals[0]!
  if (/[*?[]/.test(only.text)) return `the glob ${only.text}`
  if (SCRIPT_FILE.test(only.text)) return null
  return `${only.text}, a directory or name filter that can match many files,`
}

/** Truncate an untrusted segment before echoing it back into the model's context. */
function show(s: string): string {
  const t = s.length > 80 ? s.slice(0, 77) + '...' : s
  return t.replace(/[\n\r]/g, ' ')
}

export const FIX =
  'Run multi-file bun suites in parallel: bun test --parallel ... (or scripts/test.sh where the repo ' +
  'has one), with TMPDIR outside ~/.tmp.'

/** Every serial multi-file `bun test` in one Bash command, as `[segment text, reason]`. */
export function serialBunTests(command: string): [string, string][] {
  const found: [string, string][] = []
  for (const seg of segments(markSubstitutions(stripHeredocs(command)))) {
    const why = serialReason(seg.words)
    if (why) found.push([seg.words.map(w => w.text).join(' '), why])
  }
  return found
}

export const bunParallelGuard: Guard = async payload => {
  if (payload.tool_name !== 'Bash') return {}
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  if (!command) return {}
  const found = serialBunTests(command)
  if (!found.length) return {}
  return {
    deny:
      '🛑 ' +
      found.map(([seg, why]) => `\`${show(seg)}\` runs ${why} in one serial process.`).join('\n') +
      '\n' + FIX,
  }
}
