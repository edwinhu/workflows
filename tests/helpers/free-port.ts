/**
 * A localhost port nothing listens on, for a stub server. The kernel picks it, so suites running at
 * once in sibling worktrees never share one (tests/no-fixed-stub-ports.test.ts forbids literals).
 */
export function freePort(): number {
  const l = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
  const port = l.port
  l.stop(true)
  return port
}
