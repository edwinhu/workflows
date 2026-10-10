// Parse the Filing History section of a Lexis Public Records Nevada full record (innerText).
// Layout measured live 2026-10-10 (fixtures/corp-full-synthetic.txt mirrors it): header
// `Filing Date\tFiling Type\tNumber\tDescription\tMisc.`, rows
// `MM/DD/YYYY\tEFFECTIVE|FILING\tRef No.: <n>\t<document name>\t<misc>`; the section ends at `Important:`.
// `type` is the document name (4th column); `kind` is EFFECTIVE or FILING; each document usually has both rows.
export type Filing = { date: string; kind: string; ref: string; type: string; description: string }
const DATE = /^\d{2}\/\d{2}\/\d{4}$/
const END = /^(Important:|Stock Information|Officers?\b|Historical Contacts|Annual Report Filings|Registered Agent)/i

export function parseFilingHistory(text: string): Filing[] {
  const i = text.search(/Filing History/i)
  if (i < 0) return []
  const out: Filing[] = []
  for (const raw of text.slice(i).split(/\r?\n/).slice(1)) {
    if (!raw.trim()) continue
    if (END.test(raw.trim())) break
    const c = raw.split('\t').map(s => s.trim())
    if (DATE.test(c[0])) {
      out.push({ date: c[0], kind: c[1] ?? '', ref: (c[2] ?? '').replace(/^Ref No\.:\s*/i, ''), type: c[3] ?? '', description: c[4] ?? '' })
    } else if (out.length && !/^Filing Date\b/i.test(raw.trim())) {
      out[out.length - 1].description = [out[out.length - 1].description, raw.trim()].filter(Boolean).join(' ')
    }
  }
  return out
}

const ts = (d: string) => { const [m, dd, y] = d.split('/'); return `${y}${m}${dd}` }
const last = (rows: { date: string; type: string }[], re: RegExp) => rows.filter(r => re.test(r.type)).map(r => r.date).sort((a, b) => ts(a).localeCompare(ts(b))).pop() ?? ''

// Reinstatement is tested on type alone first so "Reinstatement after revocation" never counts as a revocation.
export function deriveDates(rows: { date: string; type: string }[]) {
  const reinst = rows.filter(r => /reinstat/i.test(r.type))
  const rest = rows.filter(r => !/reinstat/i.test(r.type))
  return {
    last_default_date: last(rest, /default/i),
    last_revocation_date: last(rest, /revo(ke|cation)/i),
    last_reinstatement_date: last(reinst, /reinstat/i),
  }
}

// Annual Report Filings section of the Full view: blocks headed `Filing N`, each holding either
// `Filed Date:\tMM/DD/YYYY` (+ `Filing Number:`, optional `Comments:`) or, for a missed list, `Due Date:\tMM/DD/YYYY`.
// Returns one row per block, newest first as listed; the date that does not apply is ''.
export type AnnualList = { due_date: string; filed_date: string }
const AL_END = /^(Stock Information|Important:|Officers?\b|Historical Contacts|Registered Agent|Filing History)/i

export function parseAnnualLists(text: string): AnnualList[] {
  const m = /^Annual Report Filings\s*$/im.exec(text)
  if (!m) return []
  const out: AnnualList[] = []
  for (const raw of text.slice(m.index).split(/\r?\n/).slice(1)) {
    const l = raw.trim()
    if (!l) continue
    if (AL_END.test(l)) break
    if (/^Filing \d+$/i.test(l)) { out.push({ due_date: '', filed_date: '' }); continue }
    const d = /^(Filed|Due) Date:\s*(\d{2}\/\d{2}\/\d{4})$/i.exec(l)
    if (d && out.length) out[out.length - 1][d[1].toLowerCase() === 'filed' ? 'filed_date' : 'due_date'] = d[2]
  }
  return out.filter(r => r.due_date || r.filed_date)
}
