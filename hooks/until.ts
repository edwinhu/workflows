/**
 * Compatibility shim for the until -> hound rename (2026-09-20).
 *
 * Claude Code resolves a hook's command at SESSION START, so a session opened before the rename
 * still invokes THIS path. Without this file it dies with `Module not found`, which takes that
 * session's Stop hook down with it — a rename should not break sessions that were already running.
 *
 * DELETE THIS once no pre-rename session is left. It is residue by design, and residue that
 * outlives its reason is indistinguishable from live code to the next reader.
 */
import { main } from './hound.ts'

main()
