// Human-paced Lexis Public Records Corporation Filings lookup by filing number.
// usage: bun corp-lookup.ts <in.csv> <out.csv> [--full] [--limit N] [--min-delay S] [--max-delay S]
//   in.csv   columns `jurisdiction,number` (state name as in the Filing Jurisdiction dropdown)
//   out.csv  appended, resumable: rows already present (jurisdiction+number) are skipped
//   --full   also open the Full view: Status Date, Date Incorporated, last annual list filed, missed Due Date,
//            filing_history (JSON [{date,type,description}]), last default / revocation / reinstatement dates and
//            annual_lists (JSON [{due_date,filed_date}]: one row per Annual Report Filings entry, filed or missed)
// Drives the signed-in Lexis tab on CDP 127.0.0.1:9222 (open advance.lexis.com/publicrecordshome first; the search form is a
// cross-origin r3.lexis.com/laprma iframe, and navigating straight to CorporateFilings.aspx gives a Lexis System Error).
// Limits live here, not just in the docs: delay floor 20 s (default random 20-45 s), cap 100 entities per run (max 300).
// Stops on a sign-in page or CAPTCHA. Delaware is not covered by Lexis and is refused without a search.
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { parseFilingHistory, deriveDates, parseAnnualLists } from './corp-history.ts'

const MIN_FLOOR_S = 20, DEFAULT_MAX_S = 45, DEFAULT_CAP = 100, HARD_CAP = 300
const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v === undefined || v.startsWith('--') ? 1 : 2); return v ?? '' }
const usage = 'usage: bun corp-lookup.ts <in.csv> <out.csv> [--full] [--limit N] [--min-delay S] [--max-delay S]'
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0) }
const full = flag('--full') !== undefined
const limit = Number(flag('--limit') ?? DEFAULT_CAP)
const minS = Number(flag('--min-delay') ?? MIN_FLOOR_S)
const maxS = Number(flag('--max-delay') ?? Math.max(DEFAULT_MAX_S, minS))
const [inPath, outPath] = args
const die = (m: string): never => { console.error(m); process.exit(2) }
if (!inPath || !outPath) die(usage)
if (!(minS >= MIN_FLOOR_S)) die(`refusing: --min-delay ${minS} is below the ${MIN_FLOOR_S} s floor`)
if (!(maxS >= minS)) die('refusing: --max-delay is below --min-delay')
if (!(limit >= 1) || limit > HARD_CAP) die(`refusing: --limit ${limit} outside 1..${HARD_CAP}`)

const parseCsv = (text: string) => text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim()).map(l => {
  const out: string[] = []; let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur); return out
})
const BLANK = ['', '', '', '', '', '', '', '', '']
const csv = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s

const [head, ...body] = parseCsv(readFileSync(inPath, 'utf8'))
const ji = head.map(h => h.trim().toLowerCase()).indexOf('jurisdiction'), ni = head.map(h => h.trim().toLowerCase()).indexOf('number')
if (ji < 0 || ni < 0) die('input needs header columns: jurisdiction,number')
const cols = ['jurisdiction', 'number', 'found', 'status', 'name', 'n_results', 'checked_at', ...(full ? ['status_date', 'date_incorporated', 'last_annual_list', 'due_date', 'filing_history', 'last_default_date', 'last_revocation_date', 'last_reinstatement_date', 'annual_lists'] : [])]
const key = (j: string, n: string) => `${j}|${n}`
const done = new Set<string>()
if (existsSync(outPath)) {
  const [oh, ...orows] = parseCsv(readFileSync(outPath, 'utf8'))
  if (oh.join(',') !== cols.join(',')) die(`refusing: ${outPath} header differs from this run's columns (${full ? 'with' : 'without'} --full)`)
  orows.forEach(r => done.add(key(r[0], r[1])))
} else appendFileSync(outPath, cols.join(',') + '\n')

const targets: any[] = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = targets.find(t => t.type === 'page' && t.url.includes('advance.lexis.com/publicrecordshome'))
if (!page) die('open the Lexis Public Records home page (advance.lexis.com/publicrecordshome) in the signed-in tab first')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let msgId = 0
let ctxs: any[] = []
ws.addEventListener('message', e => { const m = JSON.parse(String(e.data))
  if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context)
  if (m.method === 'Runtime.executionContextDestroyed') ctxs = ctxs.filter(c => c.id !== m.params.executionContextId)
  if (m.method === 'Runtime.executionContextsCleared') ctxs = [] })
const call = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
  const id = ++msgId
  const h = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.id !== id) return; ws.removeEventListener('message', h); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
  ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params }))
})
await call('Runtime.enable')
await new Promise(r => setTimeout(r, 800))
// evaluate inside the r3.lexis.com/laprma iframe (cross-origin to the advance.lexis.com shell)
const evaluate = async (expr: string) => {
  const c = ctxs.filter(c => /r3\.lexis\.com/.test(c.origin) && c.auxData?.isDefault !== false).pop()
  if (!c) return 'noctx'
  return (await call('Runtime.evaluate', { expression: expr, contextId: c.id, returnByValue: true, awaitPromise: true })).result.value
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const blocked = `(() => { const t = document.title + ' ' + document.body.innerText.slice(0, 600); if (/captcha|verify you are human|unusual activity/i.test(t) || document.querySelector('iframe[src*="recaptcha"],iframe[src*="captcha"]')) return 'captcha: ' + document.title; if (/sign in|session has expired|access denied/i.test(t)) return 'sign-in: ' + document.title; return '' })()`

const fillAndSubmit = (jur: string, num: string) => `(() => {
  const c = document.querySelector('#MainContent_CharterNumber'), s = document.querySelector('#MainContent_FilingJurisdiction_stateList')
  if (!c || !s) return 'noform:' + document.title
  document.querySelectorAll('input[type=text],input:not([type]),input[type=search]').forEach(e => { e.value = '' })
  document.querySelectorAll('input[type=checkbox]').forEach(e => { e.checked = false })
  document.querySelectorAll('select').forEach(e => { e.selectedIndex = 0 })
  const o = [...s.options].find(o => o.text.trim() === ${JSON.stringify(jur)})
  if (!o) return 'nojurisdiction'
  c.value = ${JSON.stringify(num)}; s.value = o.value
  document.querySelector('#MainContent_formSubmit_searchButton').click(); return 'ok' })()`

const readResults = (num: string) => `(() => { const t = document.body.innerText
  const blocks = t.split(/\\n\\s*\\d+\\.\\t/).slice(1)
  const recs = blocks.map(b => ({ name: b.split('\\t')[0].trim(), reg: (b.match(/Registration Number:\\s*(\\S+)/) || [])[1] || '', status: ((b.match(/Status:\\s*([^\\n\\t]+)/) || [])[1] || '').trim() }))
  return { n: recs.length, hit: recs.find(r => r.reg === ${JSON.stringify(num)}) || recs[0] || null, ready: /Registration Number:|No documents|no results|0 results/i.test(t) } })()`

const readFull = `(() => { const t = document.body.innerText
  const f = (re) => ((t.match(re) || [])[1] || '').trim()
  const sec = t.split(/Annual Report/i)[1] || ''
  const dates = [...sec.matchAll(/\\b(\\d{2}\\/\\d{2}\\/\\d{4})\\b/g)].map(m => m[1])
  const due = f(/Due Date:?\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i)
  return { ready: /Filing History|Annual Report/i.test(t), statusDate: f(/Status Date:?\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i), dateInc: f(/Date Incorporated:?\\s*(\\d{2}\\/\\d{2}\\/\\d{4})/i), due, lastAnnual: dates.find(d => d !== due) || '', text: t } })()`

const waitFor = async (expr: string, timeoutMs = 30000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { await sleep(1500); const r = await evaluate(expr); if (r?.ready) return r }
  return await evaluate(expr)
}

let count = 0
for (const r of body) {
  const jur = (r[ji] ?? '').trim(), num = (r[ni] ?? '').trim()
  if (!jur || !num || done.has(key(jur, num))) continue
  if (count >= limit) { console.log(`cap reached: ${limit} per run`); break }
  const row = (found: string, status = '', name = '', n = 0, extra: string[] = []) =>
    appendFileSync(outPath, [jur, num, found, status, name, String(n), new Date().toISOString(), ...(full ? extra : [])].map(csv).join(',') + '\n')
  if (/^delaware$/i.test(jur)) { row('unsupported_jurisdiction', '', '', 0, BLANK); console.log(`${num}: Delaware is not covered by Lexis`); continue }

  // Enter via the home page and click 'Corporation Filings' (direct navigation to CorporateFilings.aspx gives a System Error)
  await call('Page.navigate', { url: page.url })
  await sleep(6000 + Math.random() * 2000)
  const clicked = await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === 'Corporation Filings'); if (!a) return 'nolink:' + document.title; a.click(); return 'ok' })()`)
  if (clicked !== 'ok') { console.error(`stopping: Corporation Filings link not found (${clicked}); sign in to Lexis and re-run`); break }
  await sleep(5000 + Math.random() * 2000)
  const b0 = await evaluate(blocked)
  if (b0) { console.error(`stopping: ${b0}; resolve in the browser and re-run`); break }
  const ok = await evaluate(fillAndSubmit(jur, num))
  if (ok === 'nojurisdiction') { row('unsupported_jurisdiction', '', '', 0, BLANK); console.log(`${jur}: not in the Filing Jurisdiction dropdown`); continue }
  if (ok !== 'ok') { console.error(`stopping: search form not available (${ok}); sign in to Lexis and re-run`); break }
  const res = await waitFor(readResults(num))
  const b1 = await evaluate(blocked)
  if (b1 && !res?.hit) { console.error(`stopping: ${b1}; resolve in the browser and re-run`); break }
  const found = res?.hit ? (res.hit.reg === num ? 'exact' : 'other') : 'none'
  let extra = BLANK
  if (full && found === 'exact') {
    await sleep(3000 + Math.random() * 2000)
    await evaluate(`__doPostBack('ctl00$MainContent$resultsViewLinks$fullListButton','')`)
    const f = await waitFor(readFull)
    const hist = parseFilingHistory(f?.text ?? ''), d = deriveDates(hist)
    extra = [f?.statusDate ?? '', f?.dateInc ?? '', f?.lastAnnual ?? '', f?.due ?? '', JSON.stringify(hist), d.last_default_date, d.last_revocation_date, d.last_reinstatement_date, JSON.stringify(parseAnnualLists(f?.text ?? ''))]
  }
  row(found, res?.hit?.status ?? '', res?.hit?.name ?? '', res?.n ?? 0, extra)
  console.log(`${jur} ${num}: ${found} ${res?.hit?.status ?? ''}${full ? ' ' + extra.join(' | ') : ''}`)
  count++
  await sleep((minS + Math.random() * (maxS - minS)) * 1000)
}
ws.close()
console.log(`done: ${count} looked up this run`)
