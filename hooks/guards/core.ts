// The plugin's tool-call guards, written once for two hosts: the settings-hook scripts in hooks/
// (bun, node fs, stdin/stdout) and the mod (hooks/guards/mod.ts, $.fs/$.env). A hooks module runs
// with no Node, so nothing under hooks/guards/ may import node:* except node-io.ts, which only the
// scripts load. Every guard is `(payload, io) => Promise<Outcome>` over the settings-hook payload.

/** The settings-hook stdin payload, as Claude Code sends it (PreToolUse / PostToolUse). */
export type Payload = Record<string, unknown>

/** A guard's answer. Neither field: no opinion. There is no allow — silence is the pass. */
export interface Outcome {
  deny?: string
  context?: string
}

export interface FileStat {
  kind: 'file' | 'dir' | 'other'
  size: number
  mtimeMs: number
}

/** The guard's whole view of the world. Relative paths resolve against `cwd`. */
export interface GuardIO {
  env: (name: EnvName) => string | undefined
  cwd: string
  pluginRoot: string
  /** node's os.tmpdir(): TMPDIR, TMP, TEMP, then /tmp. */
  osTmpdir: string
  /** The script's process.ppid; the mod's session id. Only a last-resort counter key. */
  fallbackKey: string
  nowMs: () => number
  stat: (p: string) => Promise<FileStat | null>
  read: (p: string) => Promise<string | null>
  list: (p: string) => Promise<string[] | null>
  write: (p: string, text: string) => Promise<void>
  append: (p: string, text: string) => Promise<void>
}

/** Every variable a guard reads. The mod reads each by literal name (validate requires it). */
export const ENV_NAMES = [
  'LOOK_AT_NESTED',
  'READ_GUARD_BYTES',
  'COMPACT_THRESHOLD',
  'COMPACT_INTERVAL',
  'CLAUDE_CODE_SESSION_ID',
  'TMPDIR',
  'TEMP',
  'TMP',
  'WORK_ALLOW_CRON_DELETE',
] as const
export type EnvName = (typeof ENV_NAMES)[number]

export type Guard = (payload: Payload, io: GuardIO) => Promise<Outcome>

/** `path.join(a, b)` for the shapes guards build: collapses duplicate slashes. */
export function joinPath(...parts: string[]): string {
  return parts.filter(p => p !== '').join('/').replace(/\/{2,}/g, '/')
}

/** Absolute form of `p` against `cwd`, the way the scripts' relative fs calls resolve. */
export function absolute(cwd: string, p: string): string {
  return p.startsWith('/') ? p : joinPath(cwd, p)
}

/** The deny a PreToolUse gate gives when it throws: the same text `denyOnCrash` prints. */
export function crashDeny(gate: string, kind: string, error: unknown): string {
  let detail: string
  try {
    detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  } catch {
    detail = 'an unrepresentable value was thrown'
  }
  return (
    `${gate}: this gate crashed (${kind}: ${detail}) and could not decide. A gate that cannot ` +
    `resolve identity or policy denies; a non-zero exit would have been treated as non-blocking ` +
    `and silently permitted this call. Re-run after fixing the underlying fault.`
  )
}
