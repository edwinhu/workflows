#!/usr/bin/env bun
// jev-spend: what the Jev (OpenRouter Decisions) calls cost, from the append-only call log that
// hooks/work-hold.ts decisionsCall writes ($JEV_CALL_LOG, default ~/.local/state/jev/calls.ndjson).
//
//   jev-spend                 per day x caller, the last 7 days
//   jev-spend --days 30       a longer window
//   jev-spend --by session    per day x session instead of caller
//   jev-spend --json          the rows as JSON
//
// Read-only. Cost is the reply's own usage.cost; a cache hit costs nothing and `saved` is what the
// original ask cost. Times are local (the day boundary is local midnight, not OpenRouter's UTC day).
import { existsSync, readFileSync } from 'node:fs'
import { jevCallLogPath } from '../hooks/work-hold.ts'

export interface CallRecord {
  ts: string
  caller: string
  session?: string
  stateBytes?: number
  questions?: number
  inTokens?: number | null
  cost?: number | null
  saved?: number | null
  cache?: 'hit' | 'miss' | 'off'
  unavailable?: string
}

export interface Row {
  day: string
  key: string
  calls: number
  billed: number
  hits: number
  failed: number
  inTokens: number
  stateBytes: number
  cost: number
  saved: number
}

function localDay(ts: string): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function parseLog(text: string): CallRecord[] {
  const out: CallRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r.ts === 'string') out.push(r)
    } catch {
      /* a torn last line from a concurrent append */
    }
  }
  return out
}

export function summarize(recs: CallRecord[], opts: { by: 'caller' | 'session'; sinceMs: number }): Row[] {
  const rows = new Map<string, Row>()
  for (const r of recs) {
    const t = Date.parse(r.ts)
    if (!(t >= opts.sinceMs)) continue
    const day = localDay(r.ts)
    const key = (opts.by === 'session' ? r.session : r.caller) || '-'
    const id = `${day}\0${key}`
    const row = rows.get(id) ?? { day, key, calls: 0, billed: 0, hits: 0, failed: 0, inTokens: 0, stateBytes: 0, cost: 0, saved: 0 }
    rows.set(id, row)
    row.calls++
    if (r.cache === 'hit') {
      row.hits++
      row.saved += r.saved ?? 0
    } else if (r.unavailable) {
      row.failed++
    } else if (typeof r.cost === 'number') {
      row.billed++
    }
    if (r.cache !== 'hit') {
      row.cost += r.cost ?? 0
      row.inTokens += r.inTokens ?? 0
      row.stateBytes += r.stateBytes ?? 0
    }
  }
  return [...rows.values()].sort((a, b) => (a.day === b.day ? b.cost - a.cost : a.day < b.day ? 1 : -1))
}

export function render(rows: Row[], by: string): string {
  if (!rows.length) return 'jev-spend: no calls in the window'
  const head = ['day', by, 'calls', 'billed', 'hits', 'failed', 'in tokens', 'cost $', 'saved $']
  const cells = (r: Row) => [r.day, r.key, String(r.calls), String(r.billed), String(r.hits), String(r.failed),
    String(r.inTokens), r.cost.toFixed(6), r.saved.toFixed(6)]
  const body = rows.map(cells)
  const days = [...new Set(rows.map(r => r.day))]
  for (const d of days) {
    const rs = rows.filter(r => r.day === d)
    const sum = (f: (r: Row) => number) => rs.reduce((a, r) => a + f(r), 0)
    body.push([d, 'TOTAL', String(sum(r => r.calls)), String(sum(r => r.billed)), String(sum(r => r.hits)),
      String(sum(r => r.failed)), String(sum(r => r.inTokens)), sum(r => r.cost).toFixed(6), sum(r => r.saved).toFixed(6)])
  }
  body.sort((a, b) => (a[0] === b[0] ? (a[1] === 'TOTAL' ? 1 : b[1] === 'TOTAL' ? -1 : 0) : a[0] < b[0] ? 1 : -1))
  const w = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)))
  const line = (c: string[]) => c.map((x, i) => (i < 2 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ')
  return [line(head), w.map(n => '-'.repeat(n)).join('  '), ...body.map(line)].join('\n')
}

function main(): void {
  const argv = process.argv.slice(2)
  let days = 7
  let by: 'caller' | 'session' = 'caller'
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--days') days = Number(argv[++i])
    else if (a === '--by') by = argv[++i] === 'session' ? 'session' : 'caller'
    else if (a === '--json') json = true
    else if (a === '-h' || a === '--help') {
      console.log('usage: jev-spend [--days N] [--by caller|session] [--json]')
      return
    } else {
      console.error(`jev-spend: unknown argument ${a}`)
      process.exit(2)
    }
  }
  if (!(days > 0)) {
    console.error('jev-spend: --days takes a positive number')
    process.exit(2)
  }
  const path = jevCallLogPath()
  if (!path || !existsSync(path)) {
    console.log(`jev-spend: no call log at ${path ?? '(JEV_CALL_LOG=off)'}`)
    return
  }
  const now = new Date()
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime()
  const rows = summarize(parseLog(readFileSync(path, 'utf8')), { by, sinceMs: since })
  console.log(json ? JSON.stringify(rows) : render(rows, by))
}

if (import.meta.main) main()
