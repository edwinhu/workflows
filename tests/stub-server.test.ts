/**
 * tests/helpers/stub-server.ts: the child binds, so the port it returns is already listening, and no
 * two stubs can share one. The pre-fix shape (a port picked by closing a probe socket, then a fixed
 * sleep) failed both ways under load.
 */
import { expect, setDefaultTimeout, test } from 'bun:test'
import { startPyStub } from './helpers/stub-server.ts'

setDefaultTimeout(240_000)

const echo = (marker: string) => `
import json, http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b = json.dumps({"who": ${JSON.stringify(marker)}}).encode()
        self.send_response(200); self.send_header("content-type","application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
`

test('the returned port answers the first request, with no wait in between', async () => {
  const s = await startPyStub(echo('solo'))
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/x`, { method: 'POST', body: '{}' })
    expect(await r.json()).toEqual({ who: 'solo' })
  } finally { s.kill() }
})

test('concurrent stubs get distinct ports and each answers as itself', async () => {
  const stubs = await Promise.all(Array.from({ length: 12 }, (_, i) => startPyStub(echo(`s${i}`))))
  try {
    expect(new Set(stubs.map(s => s.port)).size).toBe(12)
    const who = await Promise.all(stubs.map(async s => (await (await fetch(`http://127.0.0.1:${s.port}/x`, { method: 'POST', body: '{}' })).json()).who))
    expect(who).toEqual(stubs.map((_, i) => `s${i}`))
  } finally { stubs.forEach(s => s.kill()) }
})

test('a child that dies before binding is an error naming it, not a hang', async () => {
  await expect(startPyStub('raise SystemExit(3)')).rejects.toThrow(/exited before announcing a port/)
})
