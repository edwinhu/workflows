/**
 * Async stand-in for spawnSync, for tests that run a long-lived bash child many times in one file.
 *
 * A synchronous spawn blocks the worker's event loop while it waits for the child's exit; under
 * bun 1.4 the exit was sometimes missed — the worker spun at ~95% user CPU beside an unreaped zombie
 * until the spawn's timeout fired, and 25 such tests ran into the suite's wall cap. Awaiting
 * `proc.exited` leaves the loop free. The result has spawnSync's `status`/`stdout`/`stderr` shape
 * (stdout and stderr as strings); `status` is null when the kill timer fired.
 */
export interface AsyncSpawnResult { status: number | null; stdout: string; stderr: string }

/** How long after the child exits to keep waiting for its pipes to close. */
const PIPE_GRACE_MS = 3000

export async function spawnAsync(
  cmd: string,
  args: string[],
  opts: { timeout: number; env?: Record<string, string | undefined>; cwd?: string },
): Promise<AsyncSpawnResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd, env: opts.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeout)
  // Read incrementally: a grandchild that inherited the pipe keeps it open after the child has
  // exited, so EOF is only awaited for a short grace once `exited` has resolved.
  const out: string[] = [], err: string[] = []
  const drain = async (s: ReadableStream<Uint8Array>, into: string[]) => {
    const dec = new TextDecoder()
    for await (const chunk of s) into.push(dec.decode(chunk, { stream: true }))
  }
  const readers = Promise.all([drain(proc.stdout, out), drain(proc.stderr, err)]).catch(() => {})
  try {
    const status = await proc.exited
    await Promise.race([readers, new Promise(r => setTimeout(r, PIPE_GRACE_MS))])
    return { status: proc.signalCode ? null : status, stdout: out.join(''), stderr: err.join('') }
  } finally {
    clearTimeout(timer)
  }
}
