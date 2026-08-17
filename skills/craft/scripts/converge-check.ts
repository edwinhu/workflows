#!/usr/bin/env bun
/**
 * converge-check.ts — is this craft run converging, or drawing from a constant-rate generator?
 *
 *   bun converge-check.ts <run-dir> [--json]
 *
 * exit 0  CONVERGING
 * exit 1  NOT CONVERGING — every reason is named
 * exit 2  too short to judge, or the run dir cannot be read
 *
 * ADVISORY. Nothing here gates a dispatch; the round cap in craft-redispatch.sh is what stops a run.
 * This says WHY it had to be stopped.
 *
 * Every input is a file craft already writes — `result-round<N>.json`, `result.json`, `args.json`,
 * the archived `plan-*.md`. No LLM, no new state.
 *
 * THE VERDICT IS THE SURVIVING-BLOCKING SEQUENCE. A fix loop converges when the blocking set it is
 * closing SHRINKS; a sequence that rises, or that ends where it started, is a loop whose exit is a
 * coin flip rather than depletion. Generation slope, repeat rate and the deliverable/gate split are
 * measured and printed because they say which failure this is — they are not extra verdicts.
 * Accretion is its own reason: it needs no history, and in the corpus it is what the two runs that
 * never converged had and no other run did.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { coveredBy, lint, parseArgs, parseMarkdown, type Plan } from './plan-lint.ts'

type Result = { scoreTable?: Record<string, unknown>; findings?: { title?: string; severity?: string; file?: string }[] }

const die = (msg: string): never => {
  console.error(`converge-check: ${msg}`)
  process.exit(2)
}

/** result-round1..N in numeric order, then the unrotated result.json — which is the newest round. */
function resultFiles(dir: string): string[] {
  const rounds = readdirSync(dir)
    .map(f => ({ f, m: /^result-round(\d+)\.json$/.exec(f) }))
    .filter(x => x.m)
    .map(x => ({ n: Number(x.m![1]), p: join(dir, x.f) }))
    .sort((a, b) => a.n - b.n)
    .map(x => x.p)
  const live = join(dir, 'result.json')
  return existsSync(live) ? [...rounds, live] : rounds
}

/** The plan the rounds ran under. args.json is what was DISPATCHED, so it wins; an archived
 *  plan-*.md is the fallback for a run dir written before args.json carried the table. */
function planOf(dir: string): Plan | null {
  const args = join(dir, 'args.json')
  if (existsSync(args)) {
    try {
      const p = parseArgs(JSON.parse(readFileSync(args, 'utf8')))
      if (p.tasks.length) return p
    } catch { /* fall through to the archived plan */ }
  }
  const plans = readdirSync(dir).filter(f => /^plan-.*\.md$/.test(f)).sort()
  if (!plans.length) return null
  try {
    return parseMarkdown(readFileSync(join(dir, plans[plans.length - 1]), 'utf8'))
  } catch {
    return null
  }
}

const BLOCKING = new Set(['critical', 'major'])
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter(x => b.has(x)).length
  const union = new Set([...a, ...b]).size
  return union ? inter / union : 0
}
/** Least-squares slope of y over its own index. 0 for fewer than two points. */
const slopeOf = (ys: number[]) => {
  if (ys.length < 2) return 0
  const n = ys.length
  const mx = (n - 1) / 2
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2 })
  return den ? Math.round((num / den) * 100) / 100 : 0
}

function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const dir = argv.find(a => !a.startsWith('--'))
  if (!dir) die('usage: converge-check.ts <run-dir> [--json]')
  if (!existsSync(dir!)) die(`no such run dir: ${dir}`)
  if (!statSync(dir!).isDirectory()) die(`not a directory: ${dir}`)

  const files = resultFiles(dir!)
  const results: Result[] = []
  for (const f of files) {
    try { results.push(JSON.parse(readFileSync(f, 'utf8'))) } catch {
      console.error(`converge-check: ${f} is unreadable — excluded from the sequence`)
    }
  }
  const plan = planOf(dir!)
  const accretion = plan ? lint(plan).filter(f => f.rule === 'work-accretion') : []

  // The blocking count is COUNTED from the findings when the table does not carry it — a round whose
  // scoreTable is absent is still a round, and dropping it would shorten the sequence silently.
  const blocking = results.map(r => {
    const claimed = r.scoreTable?.survivingBlocking
    if (typeof claimed === 'number') return claimed
    return (r.findings ?? []).filter(f => BLOCKING.has(String(f.severity))).length
  })
  const generated = results.map((r, i) => {
    const claimed = r.scoreTable?.lensFindings
    return typeof claimed === 'number' ? claimed : (results[i].findings ?? []).length
  })

  // Repeats are counted against EVERY earlier round, not just the previous one: the question is
  // whether a round re-litigates anything already raised, and a two-round gap still counts.
  const titles = results.map(r => (r.findings ?? []).map(f => String(f.title ?? '')))
  let post = 0, exact = 0, jac = 0
  const seen: string[] = []
  titles.forEach((ts, i) => {
    for (const t of ts) {
      if (i > 0) {
        post++
        const norm = t.trim().toLowerCase()
        if (seen.some(s => s.trim().toLowerCase() === norm)) exact++
        else if (seen.some(s => jaccard(words(s), words(t)) >= 0.5)) jac++
      }
    }
    seen.push(...ts)
  })

  const writable = (plan?.tasks ?? []).flatMap(t => t.writablePaths)
  const split = { deliverable: 0, gate: 0, unattributed: 0 }
  for (const ts of results) {
    for (const f of ts.findings ?? []) {
      if (!f.file) { split.unattributed++; continue }
      // `file` routinely carries a :line suffix; the path is what a writablePath can cover.
      const path = String(f.file).replace(/:\d+(?::\d+)?$/, '')
      if (coveredBy(path, writable)) split.deliverable++
      else split.gate++
    }
  }

  const reasons: string[] = []
  if (accretion.length)
    reasons.push(
      `accretion: ${accretion.length} task(s) carry more than one round marker (${accretion.map(f => f.where.replace(/^task /, '')).join(', ')}) — ` +
        'the implementer is being handed superseded instructions beside the live ones',
    )

  const judgeable = blocking.length >= 2
  if (judgeable) {
    const rose = blocking.findIndex((b, i) => i > 0 && b > blocking[i - 1])
    if (rose > 0)
      reasons.push(
        `the surviving-blocking sequence rose at round ${rose + 1} (${blocking[rose - 1]} → ${blocking[rose]}) — ` +
          'a round that raises more than it closes is generating findings, not depleting them',
      )
    else if (blocking[blocking.length - 1] >= blocking[0])
      reasons.push(
        `no net decrease in surviving blocking findings over ${blocking.length} rounds (${blocking[0]} → ${blocking[blocking.length - 1]})`,
      )
  }

  const gen = { mean: Math.round((generated.reduce((a, b) => a + b, 0) / (generated.length || 1)) * 100) / 100, slope: slopeOf(generated) }
  const repeats = { post, exact, jaccard: jac, rate: post ? Math.round(((exact + jac) / post) * 1000) / 1000 : 0 }
  const verdict = !judgeable ? 'TOO SHORT' : reasons.length ? 'NOT CONVERGING' : 'CONVERGING'
  const code = verdict === 'TOO SHORT' ? 2 : verdict === 'CONVERGING' ? 0 : 1

  if (asJson) {
    console.log(JSON.stringify({
      dir, verdict, rounds: blocking.length, blocking, generated: { per: generated, ...gen },
      repeats, split, accretion: accretion.map(f => f.where), reasons,
    }, null, 2))
    process.exit(code)
  }

  console.log(`run: ${dir}  (${blocking.length} round(s) of results)`)
  if (blocking.length) console.log(`  surviving blocking: ${blocking.join(' → ')}`)
  console.log(`  generated per round: ${generated.join(', ')}  — mean ${gen.mean}, slope ${gen.slope}`)
  console.log(`  repeats after round 1: ${exact}/${post} exact, ${jac}/${post} jaccard≥0.5 — nothing re-litigated is the constant-rate signature`)
  console.log(`  findings by file: ${split.deliverable} inside a task writablePath, ${split.gate} outside it, ${split.unattributed} naming no file`)
  console.log(`  work accretion: ${accretion.length} task(s) with more than one round marker`)
  if (!judgeable) {
    console.log('\ntoo short to judge — a convergence verdict needs at least two rounds of results')
    if (accretion.length) console.log(`  but note: ${reasons[0]}`)
    process.exit(2)
  }
  console.log(`\n${verdict}${reasons.length ? '' : ' — the blocking set is shrinking'}`)
  for (const r of reasons) console.log(`  - ${r}`)
  process.exit(code)
}

if (import.meta.main) main()
