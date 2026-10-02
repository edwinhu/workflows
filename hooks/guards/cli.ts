// The settings-hook side of a guard: read stdin, run the guard over node IO, print what the hook
// contract expects. PreToolUse gates call `denyOnCrash` before this, so a throw denies.
//
// GUARD_PARITY_RECORD=<file> appends one JSON line per invocation: the stdin, cwd, argv, the
// guard's environment, every file it observed (first observation, before any write of its own),
// and what it printed. tests/mod-guards-parity.test.ts replays those inputs into the script and
// into the mod's handler.
import { appendFileSync } from 'node:fs'
import { basename } from 'node:path'
import { context, deny, parsePayload } from '../_gate_common.ts'
import { ENV_NAMES, type FileStat, type Guard, type GuardIO, type Outcome } from './core.ts'
import { nodeIO } from './node-io.ts'

interface Observed {
  stat?: FileStat | null
  text?: string | null
  list?: string[] | null
}

let record: { stdin: string; observed: Record<string, Observed>; stdout: string } | null = null

/** nodeIO, observed when GUARD_PARITY_RECORD is set. */
export function guardIO(): GuardIO {
  const io = nodeIO()
  if (!record) return io
  const seen = record.observed
  const note = (p: string, k: keyof Observed, v: unknown) => {
    const o = (seen[p] ??= {})
    if (!(k in o)) (o as Record<string, unknown>)[k] = v
  }
  return {
    ...io,
    stat: async p => {
      const v = await io.stat(p)
      note(p, 'stat', v)
      return v
    },
    read: async p => {
      const v = await io.read(p)
      note(p, 'text', v)
      return v
    },
    list: async p => {
      const v = await io.list(p)
      note(p, 'list', v)
      return v
    },
    write: async (p, t) => {
      note(p, 'text', await io.read(p))
      return io.write(p, t)
    },
    append: async (p, t) => {
      note(p, 'text', await io.read(p))
      return io.append(p, t)
    },
  }
}

/** The hook's stdin, read once (and kept for the parity record). */
export async function readStdin(): Promise<string> {
  const text = await Bun.stdin.text()
  const out = process.env.GUARD_PARITY_RECORD
  if (out && !record) {
    record = { stdin: text, observed: {}, stdout: '' }
    const log = console.log
    console.log = (...a: unknown[]) => {
      record!.stdout += a.map(String).join(' ') + '\n'
      log(...a)
    }
    const cwd = process.cwd()
    const env = Object.fromEntries(ENV_NAMES.map(n => [n, process.env[n]]).filter(([, v]) => v !== undefined))
    process.on('exit', code => {
      appendFileSync(
        out,
        JSON.stringify({
          script: basename(process.argv[1] ?? ''),
          args: process.argv.slice(2),
          cwd,
          env,
          stdin: record!.stdin,
          observed: record!.observed,
          stdout: record!.stdout,
          exit: code,
        }) + '\n',
      )
    })
  }
  return text
}

/** A PreToolUse gate: deny, additionalContext on the payload's own event, or silence. */
export async function runPreToolUse(guard: Guard): Promise<never> {
  const payload = parsePayload(await readStdin())
  return emit(await guard(payload, guardIO()), String(payload.hook_event_name || 'PreToolUse'))
}

/** Print an outcome and exit 0. */
export function emit(out: Outcome, event: string): never {
  if (out.deny !== undefined) deny(out.deny)
  if (out.context !== undefined) context(event, out.context)
  process.exit(0)
}
