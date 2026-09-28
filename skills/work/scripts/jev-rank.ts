#!/usr/bin/env bun
/**
 * Rank review findings by Jev's probability that each is a real defect.
 *
 * Why a script and not JS inside workflow.js: the Workflow tool's script sandbox has NO network and
 * NO Node API. Probed 2026-09-28 with a zero-agent workflow — `fetch`, `process`, `require`,
 * `crypto`, `URL`, `TextEncoder` and `Buffer` are all `undefined`, and `import()` is rejected at
 * parse ("import() is not available in workflow scripts"). Only `setTimeout` and the six hooks
 * (agent/phase/parallel/pipeline/log/args) exist. So the ONLY way out of that sandbox is an agent
 * leg, and the cheapest useful agent leg is one that runs a deterministic command and reports its
 * stdout — the same shape workflow.js already uses for `mechanical:*` and `red:*` probes.
 *
 * ONE request for the whole batch: the Decisions API takes a `questions` map, so N findings cost one
 * call, not N. Measured cost per noul answer in the 2026-09-27 study: $0.0000255.
 *
 * This NEVER settles or drops a finding. It emits a probability per input index and nothing else;
 * the caller decides what to do with the order. A finding whose probability is missing keeps its
 * incoming position.
 *
 *   echo '{"findings":[{"title":"...","severity":"major","detail":"...","file":"..."}]}' \
 *     | bun jev-rank.ts
 *   -> {"ok":true,"scores":[{"index":0,"p":0.71}, ...]}
 *   -> {"ok":false,"reason":"decisions endpoint unreachable"}          (exit 0, caller falls back)
 *
 * Exit code is 0 whenever the script itself ran; `ok:false` is how unavailability is reported, so a
 * caller reading the exit code cannot mistake "Jev is down" for "the script is broken".
 */

import { readFileSync } from 'node:fs'
import { decisionsCall } from '../../../hooks/work-hold.ts'

interface Finding { title?: string; severity?: string; detail?: string; file?: string; lens?: string }

/**
 * The question asked of each finding, byte-for-byte the one the 2026-09-27 study measured at
 * AUC 0.639 against 3,137 refuter verdicts. Changing this wording invalidates that number.
 */
export const REAL_DEFECT_QUESTION =
  'This finding is a REAL defect in the deliverable that should block the gate: it is factually ' +
  "true, not already handled, and inside the plan's scope. (If the finding is wrong, already " +
  'fixed, out of scope, or merely informational, this is false.)'

/** The `state` a refuter would have been handed for this finding — same three lines workflow.js sends. */
export function findingState(f: Finding): string {
  return [
    `Adversarially REFUTE this ${f.severity} review finding (lens ${f.lens || 'unattributed'}):`,
    `  ${f.title}${f.file ? ` [${f.file}]` : ''}`,
    `  ${f.detail}`,
  ].join('\n')
}

/**
 * One `state` carrying every finding, plus one question per finding. Jev answers all of them in a
 * single call, so the batch costs one request.
 */
export function buildRequest(findings: Finding[]): {
  state: string
  questions: Record<string, { type: string; instructions: string }>
} {
  const state = findings
    .map((f, i) => `=== FINDING f${i} ===\n${findingState(f)}`)
    .join('\n\n')
  const questions: Record<string, { type: string; instructions: string }> = {}
  findings.forEach((_f, i) => {
    questions[`f${i}`] = {
      type: 'noul',
      instructions: `Considering ONLY the finding labelled "=== FINDING f${i} ===": ${REAL_DEFECT_QUESTION}`,
    }
  })
  return { state, questions }
}

/** Pull one probability per index out of a Decisions reply. A missing answer is null, never 0. */
export function parseScores(stdout: string, n: number): { index: number; p: number | null }[] | null {
  let d: unknown
  try { d = JSON.parse(stdout) } catch { return null }
  const answers = (d as { answers?: Record<string, { noul?: unknown }> })?.answers
  if (!answers || typeof answers !== 'object') return null
  const out: { index: number; p: number | null }[] = []
  for (let i = 0; i < n; i++) {
    const v = answers[`f${i}`]?.noul
    out.push({ index: i, p: typeof v === 'number' && Number.isFinite(v) ? v : null })
  }
  // All-null means the reply had no usable answers at all — report that as unavailable rather than
  // handing back a ranking that is silently the input order.
  return out.some(r => r.p !== null) ? out : null
}

function main(): void {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch (e) {
    console.log(JSON.stringify({ ok: false, reason: `could not read stdin: ${String(e)}` }))
    return
  }
  let findings: Finding[]
  try {
    const parsed = JSON.parse(raw)
    findings = Array.isArray(parsed) ? parsed : parsed?.findings
    if (!Array.isArray(findings)) throw new Error('no findings array')
  } catch (e) {
    console.log(JSON.stringify({ ok: false, reason: `stdin was not {findings:[...]}: ${String(e)}` }))
    return
  }
  if (!findings.length) {
    console.log(JSON.stringify({ ok: true, scores: [] }))
    return
  }
  const { state, questions } = buildRequest(findings)
  const r = decisionsCall(state, questions)
  if (r.stdout === null) {
    console.log(JSON.stringify({ ok: false, reason: r.unavailable }))
    return
  }
  const scores = parseScores(r.stdout, findings.length)
  if (!scores) {
    console.log(JSON.stringify({ ok: false, reason: 'decision reply carried no usable noul answers' }))
    return
  }
  console.log(JSON.stringify({ ok: true, scores }))
}

if (import.meta.main) main()
