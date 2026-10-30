/**
 * PreToolUse (Bash) BLOCKING GATE over Bash command TEXT: `farm.sh --tasks` run with
 * `run_in_background` and without `--detach`.
 *
 * Tasks mode blocks until its rows finish. Backgrounded, Claude Code reports the command's end AND the
 * watcher mod wakes on the run's DONE line: two wakes for one run. 2026-10-29: 6 of 6 watcher wakes
 * repeated an event already handled. `--detach` returns at once and leaves the one wake to the watcher.
 *
 * Denied only when `tool_input.run_in_background === true` and a segment in command position runs
 * farm.sh, directly or as `bash …/farm.sh` (also under timeout/nice/ionice/stdbuf, or `bash -c '…'`),
 * with `--tasks` and without `--detach`. Everything else passes: a foreground call, `--workflow`,
 * work-dispatch.sh, and farm.sh written as echo or heredoc text. Never rewritten, never approved.
 */
import type { Guard } from './core.ts'
import { commandWordIndex, segments, type Word } from './pgrep.ts'

const SHELLS = new Set(['bash', 'sh'])

/** Commands that run their arguments as a command, after their own options (as guards/bun-test.ts). */
const WRAPPERS = new Set(['timeout', 'nice', 'ionice', 'stdbuf'])

/** A wrapper's own option or operand: `-k 10`, `600`, `1.5m`, `KILL`, `VAR=x`. */
const wrapperArg = (t: string): boolean =>
  t.startsWith('-') || /^[\d.]+[smhd]?$/.test(t) || /^[A-Z][A-Z0-9]*$/.test(t) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)

const basename = (t: string): string => t.split('/').pop() ?? t

/** Drop heredoc bodies: a farm.sh line inside `cat <<EOF` is text being written, not run. */
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

/** Does this segment run a blocking `farm.sh --tasks` (no `--detach`)? */
function blockingTasks(words: Word[]): boolean {
  let i = commandWordIndex(words)
  if (i < 0) return false
  while (i < words.length && !words[i]!.quoted && WRAPPERS.has(basename(words[i]!.text))) {
    i++
    while (i < words.length && wrapperArg(words[i]!.text)) i++
  }
  const head = words[i]
  if (!head) return false
  if (!head.quoted && SHELLS.has(basename(head.text))) {
    i++
    for (; i < words.length && words[i]!.text.startsWith('-'); i++) {
      // `bash -c '<string>'` / `bash -lc '…'`: the operand is itself a command line.
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(words[i]!.text)) {
        const body = words[i + 1]
        return body !== undefined && blockingFarmTasks(body.text)
      }
    }
  }
  const script = words[i]
  if (!script || basename(script.text) !== 'farm.sh') return false
  const args = words.slice(i + 1).map(w => w.text)
  const tasks = args.some(a => a === '--tasks' || a.startsWith('--tasks='))
  return tasks && !args.includes('--detach')
}

/** True when some segment of `command` runs `farm.sh --tasks` without `--detach`. */
export function blockingFarmTasks(command: string): boolean {
  return segments(stripHeredocs(command)).some(seg => blockingTasks(seg.words))
}

export const DENY =
  '🛑 farm.sh --tasks with run_in_background and no --detach wakes this session twice: Claude Code ' +
  "reports the command's end and the watcher wakes on the run's DONE. Add --detach (it returns at once " +
  'and the watcher wakes once, with the outcome), or run it in the foreground to wait for it.'

export const farmDetachGuard: Guard = async payload => {
  if (payload.tool_name !== 'Bash') return {}
  const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>
  if (toolInput.run_in_background !== true) return {}
  const command = typeof toolInput.command === 'string' ? toolInput.command : ''
  if (!command || !blockingFarmTasks(command)) return {}
  return { deny: DENY }
}
