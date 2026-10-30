#!/usr/bin/env bun
/**
 * farm-status.ts — the statusLine segment for this session's farm runs, work rounds and grind loops,
 * launched by bin/farm-status. Claude Code pipes the session JSON on stdin; the line is rebuilt from
 * <TMPDIR>/farm-events/<session_id>/ (and /tmp's) through the watcher's own snapshot
 * (hooks/watch/snapshot.ts) and printed as runs.ts statusLine() words it, in colour.
 *
 * Nothing running, unusable input, or any error prints nothing. It always exits 0.
 *
 *   {"statusLine":{"type":"command","command":"farm-status","refreshInterval":5}}
 */
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { buildViews, psArgv, psPids, type Entry, type SnapshotIO } from '../../hooks/watch/snapshot.ts'
import { statusLine } from '../../hooks/watch/runs.ts'

// The id becomes a path segment, so '/' and '..' must never get through.
const SESSION_ID = /^[A-Za-z0-9_-]+$/

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

// The run kind opens a part (`farm:`, `work <run>`) or a farm-list item (`grind <journal>`); an
// elapsed time closes an item or a part. Matches never overlap, so no span nests in another.
const ELAPSED = String.raw`\d+h\d{2}m|\d+m|\d+s`
const SPANS = new RegExp(String.raw`(?<=^|· )(?:farm:|work \S+)|(?<=\(|, )grind \S+|(?<= )(?:${ELAPSED})(?=,|\)| ·|$)`, 'g')

/** statusLine()'s text with escapes inserted around its spans; strip them and the text is unchanged.
 *  Control characters a decoded label can carry (a newline, ESC) are neutralised first. */
function paint(line: string): string {
  return line
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '?')
    .replace(SPANS, (m) => `${/^\d/.test(m) ? DIM : BOLD}${m}${RESET}`)
}

const nodeIO: SnapshotIO = {
  // lstat: a symlink in a world-writable /tmp event directory is never taken for an event file.
  async list(dir) {
    const out: Entry[] = []
    for (const name of readdirSync(dir)) {
      try {
        const s = lstatSync(`${dir}/${name}`)
        out.push({ name, kind: s.isFile() ? 'file' : s.isDirectory() ? 'dir' : s.isSymbolicLink() ? 'link' : 'other', size: s.size, mtimeMs: s.mtimeMs })
      } catch { /* removed between the listing and the stat */ }
    }
    return out
  },
  async read(p) {
    return readFileSync(p, 'utf8')
  },
  async stat(p) {
    const s = statSync(p)
    return { size: s.size, mtimeMs: s.mtimeMs }
  },
  async alivePids(pids) {
    const [cmd = 'ps', ...args] = psArgv(pids)
    // ps exits 1 when none of the pids runs; only a failure to run it at all is "cannot tell".
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2000 })
    if (r.error) throw r.error
    return psPids(r.stdout ?? '')
  },
}

async function main(): Promise<string | undefined> {
  let input: unknown
  try { input = JSON.parse(await Bun.stdin.text()) } catch { return undefined }
  const sid = input && typeof input === 'object' ? (input as { session_id?: unknown }).session_id : undefined
  if (typeof sid !== 'string' || !SESSION_ID.test(sid)) return undefined
  const roots = [...new Set([(process.env.TMPDIR || '/tmp').replace(/\/+$/, ''), '/tmp'])]
  const nowMs = Date.now()
  const views = await buildViews(nodeIO, roots.map((r) => `${r}/farm-events/${sid}`), nowMs, { firstSeen: new Map(), parsed: new Map() })
  return statusLine(views, nowMs)
}

try {
  const line = await main()
  if (line !== undefined) process.stdout.write(`${paint(line)}\n`)
} catch { /* a statusLine segment that errors prints nothing */ }
process.exitCode = 0
