/**
 * A stub HTTP server in a python child, bound by the CHILD on a kernel-chosen port.
 *
 * It is out of process because the hooks under test call `spawnSync`, which would starve an in-test
 * `Bun.serve` on the same event loop. The child binds port 0 itself and prints the port once it is
 * listening, so the caller learns the port only when connections are already queued. The earlier shape
 * (`freePort()`, then spawn, then sleep 700 ms) raced twice: python's start-up is the scheduler's
 * business under load, and between `freePort()` closing its socket and python binding, a sibling
 * test's `Bun.serve({ port: 0 })` could be handed the same port, so one test's hook talked to another
 * test's server (decisions-fallback's OpenAI stub answered early-stop's judge call, 2026-10-13).
 */
export interface Stub { port: number; kill(): void }

/**
 * `handlerBody` is python source that defines `class H(http.server.BaseHTTPRequestHandler)` after
 * `import json, http.server, socketserver`; this appends the bind and the port announcement.
 */
export async function startPyStub(handlerBody: string, deadlineMs = 90_000): Promise<Stub> {
  const code = `${handlerBody}
socketserver.TCPServer.allow_reuse_address = True
_srv = socketserver.TCPServer(("127.0.0.1", 0), H)
print(_srv.server_address[1], flush=True)
_srv.serve_forever()
`
  const proc = Bun.spawn(['python3', '-c', code], { stdout: 'pipe', stderr: 'ignore' })
  const reader = proc.stdout.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`stub announced no port within ${deadlineMs} ms`)), deadlineMs) })
  try {
    let text = ''
    const line = (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error(`stub exited before announcing a port: ${text}`)
        text += new TextDecoder().decode(value)
        if (text.includes('\n')) return Number(text.split('\n')[0])
      }
    })()
    const port = await Promise.race([line, deadline])
    return { port, kill: () => proc.kill() }
  } catch (e) {
    proc.kill()
    throw e
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
