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

export async function spawnAsync(
  cmd: string,
  args: string[],
  opts: { timeout: number; env?: Record<string, string | undefined>; cwd?: string },
): Promise<AsyncSpawnResult> {
  const proc = Bun.spawn([cmd, ...args], {
    cwd: opts.cwd, env: opts.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeout)
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    return { status: proc.signalCode ? null : status, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}
