// Human-paced Lexis Public Records Judgments & Liens lookup by company and/or FEIN.
// usage: bun jnl-lookup.ts <in.csv> <out.csv> [--max-records N] [--no-strict] [--fein-only | --debtor-segment] [--dry-run] [--limit N] [--min-delay S] [--max-delay S] [--dump DIR]
//   in.csv   columns `company[,fein]`; a row with an empty company and a fein runs a FEIN-only search (company field left blank)
//   out.csv  appended, resumable: queries already present (company+fein) are skipped; one row per returned record
//   --max-records N  records kept per query (default 50, max 500); result pages are followed only until N
//   --fein-only      ignore the company column wherever a fein is present (name+FEIN does not narrow in Lexis); rows without a fein are skipped
//   --debtor-segment Terms-and-Connectors search on the Debtor segment only: debtor("NAME WITHOUT LEGAL-FORM SUFFIX"), built through the page's own Add button; the fein column is ignored.
//                    Same output schema; query_company holds the query string (so rows never collide with form-mode rows), strict is `n/a`. Use a separate out.csv. NOT yet live-tested.
//   --dry-run        print the exact query per input row and exit; no browser, no out.csv needed
//   --no-strict      leave Strict Search off (default: on, as the form checkbox)
//   --dump DIR       also save each page's raw text (debugging the parser)
// Drives the signed-in Lexis tab on CDP 127.0.0.1:9222 (open r3.lexis.com/laprma/JnL.aspx first).
// Limits live here, not just in the docs: delay floor 20 s (default random 20-45 s) between searches and result pages,
// cap 100 queries per run (max 300). Stops on a sign-in page or CAPTCHA.
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs'

const MIN_FLOOR_S = 20, DEFAULT_MAX_S = 45, DEFAULT_CAP = 100, HARD_CAP = 300, DEFAULT_RECORDS = 50, MAX_RECORDS = 500
const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, v === undefined || v.startsWith('--') ? 1 : 2); return v ?? '' }
const usage = 'usage: bun jnl-lookup.ts <in.csv> <out.csv> [--max-records N] [--no-strict] [--fein-only | --debtor-segment] [--dry-run] [--limit N] [--min-delay S] [--max-delay S] [--dump DIR]'
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0) }
const strict = flag('--no-strict') === undefined
const maxRecords = Number(flag('--max-records') ?? DEFAULT_RECORDS)
const limit = Number(flag('--limit') ?? DEFAULT_CAP)
const minS = Number(flag('--min-delay') ?? MIN_FLOOR_S)
const maxS = Number(flag('--max-delay') ?? Math.max(DEFAULT_MAX_S, minS))
const dumpDir = flag('--dump')
const feinOnly = args.includes('--fein-only')
if (feinOnly) args.splice(args.indexOf('--fein-only'), 1)
const debtorMode = args.includes('--debtor-segment')
if (debtorMode) args.splice(args.indexOf('--debtor-segment'), 1)
const dryRun = args.includes('--dry-run')
if (dryRun) args.splice(args.indexOf('--dry-run'), 1)
const [inPath, outPath] = args
const die = (m: string): never => { console.error(m); process.exit(2) }
if (!inPath || (!outPath && !dryRun)) die(usage)
if (debtorMode && feinOnly) die('refusing: --debtor-segment and --fein-only are different searches')
if (!(minS >= MIN_FLOOR_S)) die(`refusing: --min-delay ${minS} is below the ${MIN_FLOOR_S} s floor`)
if (!(maxS >= minS)) die('refusing: --max-delay is below --min-delay')
if (!(limit >= 1) || limit > HARD_CAP) die(`refusing: --limit ${limit} outside 1..${HARD_CAP}`)
if (!(maxRecords >= 1) || maxRecords > MAX_RECORDS) die(`refusing: --max-records ${maxRecords} outside 1..${MAX_RECORDS}`)

const parseCsv = (text: string) => text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim()).map(l => {
  const out: string[] = []; let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur); return out
})
const csv = (s: string) => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s

// Debtor-segment query, exactly what the page's Add button builds for Debtor + input: value.replace('()', '(' + input + ')').
// Legal-form suffix is dropped (trailing, repeatable): the connector/OR-group syntax (`w/N`, `or`) is listed on the page but its
// grouping inside a segment is unconfirmed, so no suffix OR group is built.
const SUFFIX = /[\s,]+(?:INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LLC|L\.L\.C|LP|L\.P|LLP|PLC|NV|N\.V|SA|AG)\.?$/i
const stripSuffix = (name: string) => { let n = name.replace(/["]/g, ' ').replace(/\s+/g, ' ').trim(), prev = ''
  while (n !== prev) { prev = n; const m = n.replace(/[.,\s]+$/, '').replace(SUFFIX, ''); if (m.trim()) n = m.trim() }
  return n.replace(/[.,\s]+$/, '') }
const debtorQuery = (company: string) => `debtor("${stripSuffix(company)}")`

// ---- results parsing (pure; exercised offline with --parse-file) ----
type Rec = { rank: number; debtor: string; filing_date: string; amount: string; type: string; filing_number: string; filing_office: string; creditor: string; released: string; release_date: string }
const parseResults = (text: string): { total: number | null; recs: Rec[] } => {
  const totalM = text.match(/\d+\s*-\s*\d+\s+of\s+([\d,]+)/i)
  const cut = text.lastIndexOf('\nTerms:')
  const parts = (cut > 0 ? text.slice(0, cut) : text).split(/\n\s*(\d+)\.\t/)
  const recs: Rec[] = []
  const isRelease = (t: string) => /RELEASE|SATISF|DISMISSAL/.test(t)
  for (let i = 1; i < parts.length; i += 2) {
    const rank = Number(parts[i]), lines = parts[i + 1].split('\n')
    const start = lines.findIndex(l => /Filing Date:/.test(l))
    // sub-filings: an all-caps type line whose next non-empty line is a `Filing ...:` line, then its Filing Date / Filing Office
    const subs: { type: string; num: string; date: string; office: string }[] = []
    let amount = '', lastOffice = -1
    for (let j = Math.max(start, 0); j < lines.length; j++) {
      const l = lines[j].trim()
      if (!amount && /^Amount:/.test(l)) amount = l.replace(/^Amount:\s*/, '')
      if (/^[A-Z][A-Z \/&-]{3,}$/.test(l) && !/ COUNTY$/.test(l) && /^Filing (Number|Date|Office):/.test((lines.slice(j + 1).find(x => x.trim()) ?? '').trim())) subs.push({ type: l, num: '', date: '', office: '' })
      const cur = subs[subs.length - 1]
      if (cur && /^Filing Number:/.test(l)) cur.num = l.replace(/^Filing Number:\s*/, '')
      if (cur && /^Filing Date:/.test(l) && !cur.date) cur.date = l.replace(/^Filing Date:\s*/, '')
      if (cur && /^Filing Office:/.test(l)) { cur.office = l.replace(/^Filing Office:\s*/, ''); lastOffice = j }
    }
    const main = subs.find(x => !isRelease(x.type)) ?? subs[0]
    const rel = subs.find(x => isRelease(x.type) && x !== main)
    const headerDate = (lines[start] ?? '').replace(/.*Filing Date:\s*/, '').trim()
    // creditor: first tab-led line after the last Filing Office
    const credLine = lines.slice(lastOffice + 1).find(l => l.startsWith('\t') && l.trim())
    recs.push({
      rank, debtor: lines.slice(0, start < 0 ? lines.length : start).join('\n').split('\t')[0].split('\n')[0].trim(),
      filing_date: main?.date || headerDate, amount, type: main?.type ?? '', filing_number: main?.num ?? '', filing_office: main?.office ?? '',
      creditor: credLine ? credLine.split('\t')[1].trim() : '', released: rel || (main && isRelease(main.type)) ? 'yes' : '', release_date: rel?.date ?? (main && isRelease(main.type) ? main.date : ''),
    })
  }
  return { total: totalM ? Number(totalM[1].replace(/,/g, '')) : null, recs }
}
if (args[0] === '--parse-file') { console.log(JSON.stringify(parseResults(readFileSync(args[1], 'utf8')), null, 1)); process.exit(0) }

const [head, ...body] = parseCsv(readFileSync(inPath, 'utf8'))
const hl = head.map(h => h.trim().toLowerCase()), ci = hl.indexOf('company'), fi = hl.indexOf('fein')
if (ci < 0) die('input needs a header column: company[,fein]')
if (feinOnly && fi < 0) die('refusing: --fein-only needs a fein column in the input')
if (dryRun) {
  for (const r of body) { const company = (r[ci] ?? '').trim(), fein = (fi >= 0 ? r[fi] ?? '' : '').trim()
    if (debtorMode) { if (company) console.log(`${company}\t${debtorQuery(company)}`) }
    else if ((company || fein) && !(feinOnly && !fein)) console.log(`${company}\t${fein}\tform: company=${JSON.stringify(feinOnly || !company ? '' : company)} fein=${JSON.stringify(fein)} strict=${strict}`) }
  process.exit(0)
}
const cols = ['query_company', 'query_fein', 'strict', 'n_results', 'rank', 'debtor', 'filing_date', 'amount', 'type', 'filing_number', 'filing_office', 'creditor', 'released', 'release_date', 'checked_at']
const key = (c: string, f: string) => `${c}|${f}`
const done = new Set<string>()
if (existsSync(outPath)) {
  const [oh, ...orows] = parseCsv(readFileSync(outPath, 'utf8'))
  if (oh.join(',') !== cols.join(',')) die(`refusing: ${outPath} header differs from this run's columns`)
  orows.forEach(r => done.add(key(r[0], r[1])))
} else appendFileSync(outPath, cols.join(',') + '\n')

const targets: any[] = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const lexis = targets.filter(t => t.type === 'page' && t.url.includes('r3.lexis.com/laprma'))
const page = lexis.find(t => /judgments/i.test(t.title)) ?? lexis[0]
if (!page) die('open a Lexis Public Records tab (r3.lexis.com/laprma/JnL.aspx) first')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let msgId = 0
const call = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
  const id = ++msgId
  const h = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.id !== id) return; ws.removeEventListener('message', h); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
  ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expr: string) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const pace = () => sleep((minS + Math.random() * (maxS - minS)) * 1000)
const blocked = `(() => { const t = document.title + ' ' + document.body.innerText.slice(0, 600); if (/captcha|verify you are human|unusual activity/i.test(t) || document.querySelector('iframe[src*="recaptcha"],iframe[src*="captcha"]')) return 'captcha: ' + document.title; if (/sign in|session has expired|access denied/i.test(t)) return 'sign-in: ' + document.title; return '' })()`

// Clears every field first (the form keeps the previous search; jurisdiction defaults to a stale state), then sets company/FEIN/strict.
// Debtor mode: select Terms and Connectors (the page's own tab sets the BooleanMode radio), build the query with the Add button, verify it, submit.
const fillAndSubmitDebtor = (query: string) => `(() => {
  const tab = document.querySelector('#TermsTab'), ta = document.querySelector('#AdditionalTermsContent_AdditionalTerms_additionalTermsTextBox'), dd = document.querySelector('#AdditionalTermsContent_AdditionalTerms_segmentsDropDown'), inp = document.querySelector('#segmentInput'), add = document.querySelector('#segmentAddButton'), go = document.querySelector('#AdditionalTermsContent_formSubmitTerms_searchButton')
  if (!tab || !ta || !dd || !inp || !add || !go) return 'noform:' + document.title
  document.querySelectorAll('input[type=text],input:not([type]),input[type=search],textarea').forEach(e => { e.value = '' })
  document.querySelectorAll('input[type=checkbox]').forEach(e => { e.checked = false })
  document.querySelectorAll('select').forEach(e => { e.selectedIndex = 0 })
  tab.click()
  if (!document.querySelector('#BooleanMode').checked) return 'noboolean'
  dd.value = 'debtor()'; inp.value = ${JSON.stringify(query.slice('debtor('.length, -1))}; add.click()
  if (ta.value !== ${JSON.stringify(query)}) return 'mismatch:' + ta.value
  go.click(); return 'ok' })()`

const fillAndSubmit = (company: string, fein: string) => `(() => {
  const c = document.querySelector('#MainContent_Company_CompanyName'), f = document.querySelector('#MainContent_Company_Fein'), s = document.querySelector('#MainContent_StrictMatch')
  if (!c || !f || !s) return 'noform:' + document.title
  document.querySelectorAll('input[type=text],input:not([type]),input[type=search]').forEach(e => { e.value = '' })
  document.querySelectorAll('input[type=checkbox]').forEach(e => { e.checked = false })
  document.querySelectorAll('select').forEach(e => { e.selectedIndex = 0 })
  c.value = ${JSON.stringify(company)}; f.value = ${JSON.stringify(fein)}; s.checked = ${strict}
  document.querySelector('#MainContent_formSubmit_searchButton').click(); return 'ok' })()`

const readPage = `(() => { const t = document.body.innerText
  const next = [...document.querySelectorAll('a,input[type=submit],input[type=button]')].find(e => /^\\s*(next|next page|>|»)\\s*$/i.test((e.innerText || e.value || e.title || '').trim()) && !e.disabled && !/aspNetDisabled|disabled/.test(e.className))
  return { text: t, hasNext: !!next, ready: /\\n\\s*\\d+\\.\\t/.test(t) || /No documents|no results|0 results|did not return/i.test(t) } })()`
const clickNext = `(() => { const next = [...document.querySelectorAll('a,input[type=submit],input[type=button]')].find(e => /^\\s*(next|next page|>|»)\\s*$/i.test((e.innerText || e.value || e.title || '').trim()) && !e.disabled && !/aspNetDisabled|disabled/.test(e.className)); if (!next) return false; next.click(); return true })()`
const waitFor = async (expr: string, prevText = '', timeoutMs = 30000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { await sleep(1500); const r = await evaluate(expr); if (r?.ready && r.text !== prevText) return r }
  return await evaluate(expr)
}

let count = 0, qn = 0
for (const r of body) {
  const company0 = (r[ci] ?? '').trim(), fein = debtorMode ? '' : (fi >= 0 ? r[fi] ?? '' : '').trim()
  if (debtorMode && !company0) continue
  const company = debtorMode ? debtorQuery(company0) : company0  // debtor mode: the query string is the resume key
  if ((!company && !fein) || (feinOnly && !fein) || done.has(key(company, fein))) continue
  const qCompany = feinOnly || !company ? '' : company  // what goes into the form
  if (count >= limit) { console.log(`cap reached: ${limit} per run`); break }
  qn++
  await call('Page.navigate', { url: 'https://r3.lexis.com/laprma/JnL.aspx' })
  await sleep(4000 + Math.random() * 3000)
  const b0 = await evaluate(blocked)
  if (b0) { console.error(`stopping: ${b0}; resolve in the browser and re-run`); break }
  const ok = await evaluate(debtorMode ? fillAndSubmitDebtor(company) : fillAndSubmit(qCompany, fein))
  if (ok !== 'ok') { console.error(`stopping: search form not available (${ok}); sign in to Lexis and re-run`); break }
  let pg = await waitFor(readPage)
  const b1 = await evaluate(blocked)
  if (b1 && !pg?.ready) { console.error(`stopping: ${b1}; resolve in the browser and re-run`); break }
  const kept: Rec[] = []; let total: number | null = null, pageNo = 1
  for (;;) {
    if (dumpDir) { mkdirSync(dumpDir, { recursive: true }); writeFileSync(`${dumpDir}/q${qn}-p${pageNo}.txt`, pg?.text ?? '') }
    const parsed = parseResults(pg?.text ?? '')
    total ??= parsed.total
    for (const rec of parsed.recs) if (kept.length < maxRecords && !kept.some(k => k.rank === rec.rank)) kept.push(rec)
    if (kept.length >= maxRecords || !parsed.recs.length || !pg?.hasNext) break
    await pace()
    if (!(await evaluate(clickNext))) break
    pg = await waitFor(readPage, pg.text); pageNo++
    const b2 = await evaluate(blocked)
    if (b2 && !pg?.ready) { console.error(`stopping: ${b2}; resolve in the browser and re-run`); process.exit(1) }
  }
  const n = total ?? kept.length, now = new Date().toISOString()
  const base = [company, fein, debtorMode ? 'n/a' : strict ? 'yes' : 'no', String(n)]
  const rows = kept.length ? kept.map(k => [...base, String(k.rank), k.debtor, k.filing_date, k.amount, k.type, k.filing_number, k.filing_office, k.creditor, k.released, k.release_date, now])
    : [[...base, '', '', '', '', '', '', '', '', '', '', now]]
  rows.forEach(row => appendFileSync(outPath, row.map(csv).join(',') + '\n'))
  console.log(`${company || '(fein-only)'} ${fein}: ${n} results, kept ${kept.length}${kept.length >= maxRecords && n > kept.length ? ' (max-records)' : ''}`)
  count++
  await pace()
}
ws.close()
console.log(`done: ${count} queried this run`)
