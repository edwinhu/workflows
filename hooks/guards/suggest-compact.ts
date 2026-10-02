// PreToolUse(Edit|Write): count edits per session and suggest /compact at logical checkpoints.
//
// COMPACT_THRESHOLD (default 50) edits before the first suggestion, then every COMPACT_INTERVAL
// (default 25). The counter lives in the SYSTEM temp dir, resolved as Python's
// tempfile.gettempdir() does, so the Python original and this port share one file.
import { joinPath, type Guard, type GuardIO, type Payload } from './core.ts'

/** tempfile.gettempdir(): $TMPDIR, $TEMP, $TMP, then /tmp. */
function tempDir(io: GuardIO): string {
  return io.env('TMPDIR') || io.env('TEMP') || io.env('TMP') || '/tmp'
}

/**
 * The payload's session_id (on every event this is wired to), then CLAUDE_CODE_SESSION_ID, then the
 * host's fallback key. The result is a FILENAME component: anything that could introduce a
 * separator or a `..` is stripped, and a stripped-empty id falls through to the next source.
 */
function counterKey(payload: Payload, io: GuardIO): string {
  for (const candidate of [payload?.session_id, io.env('CLAUDE_CODE_SESSION_ID')]) {
    if (typeof candidate !== 'string') continue
    const safe = candidate.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64)
    if (safe && safe !== '.' && safe !== '..') return safe
  }
  return io.fallbackKey
}

/** Python `int(text)`: optional sign, decimal digits, surrounding whitespace already stripped. */
function pyInt(text: string): number | null {
  return /^[+-]?[0-9]+$/.test(text) ? Number(text) : null
}

export const suggestCompact: Guard = async (payload, io) => {
  const toolName = String(payload.tool_name ?? '')
  if (toolName !== 'Edit' && toolName !== 'Write') return {}

  const counterFile = joinPath(tempDir(io), `claude-tool-count-${counterKey(payload, io)}`)
  const text = await io.read(counterFile)
  const count = (text === null ? null : pyInt(text.trim()) ?? null) ?? 0
  try {
    await io.write(counterFile, String(count + 1))
  } catch {
    // IOError: pass
  }
  const n = count + 1

  const threshold = Number(io.env('COMPACT_THRESHOLD') ?? '50')
  const interval = Number(io.env('COMPACT_INTERVAL') ?? '25')
  if (n === threshold) {
    return { context: `[StrategicCompact] ${threshold} edits reached - consider /compact if transitioning phases` }
  }
  if (n > threshold && (n - threshold) % interval === 0) {
    return { context: `[StrategicCompact] ${n} edits - good checkpoint for /compact if context is stale` }
  }
  return {}
}
