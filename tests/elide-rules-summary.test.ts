import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { useTmp } from './helpers/tmp.ts'

setDefaultTimeout(300_000)

// An editorial summary (`#emph[[Summary: ...]]`) is masked to an elision mark by _elide.parse, so the
// rules read it as the elision it is: EL-VOICE never sees its editor-voice text, while EL-HOLDING and
// EL-GAP count it among the marks -- a summary can neither hide a holding cut nor a heading gap.

const ROOT = join(import.meta.dir, '..')
const EVIDENCE = join(ROOT, 'checks/_jev/evidence.py')
const FIX = join(ROOT, 'skills/elide-case/fixtures')
const mkTmp = useTmp()

function evidence(edit: (t: string) => string) {
  const p = mkTmp('elide-sum-rules-')
  mkdirSync(join(p, 'addenda'))
  mkdirSync(join(p, 'docs'))
  for (const f of ['SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt', 'SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt']) copyFileSync(join(FIX, 'docs', f), join(p, 'docs', f))
  const a = join(p, 'addenda/a.typ')
  writeFileSync(a, edit(readFileSync(join(FIX, 'mini-addendum.typ'), 'utf8')))
  const r = spawnSync('python3', [EVIDENCE, '--rules-dir', join(ROOT, 'checks/elide/rules'), '--root', p, '--files', a], { encoding: 'utf8', timeout: 120_000 })
  expect(r.status, r.stderr).toBe(0)
  return JSON.parse(r.stdout)
}

const AT = 'form provided by MBC. [. . .]'
const VOICE = 'This excerpt omits the escrow arrangements and the later course of the district court proceedings.'
const voiceText = (s: any) => JSON.stringify([s.bracketed_spans_of_four_or_more_words, s.short_bracketed_spans, s.body_sentences_with_editor_voice_terms])

describe('elide rules read an editorial summary as an elision', () => {
  test('EL-VOICE: a correct summary in editor voice yields no candidate and is counted as excluded', () => {
    const s = evidence(t => t.replace(AT, `form provided by MBC. #emph[[Summary: ${VOICE}]]`))['EL-VOICE'].state
    expect(voiceText(s)).not.toContain('This excerpt omits')
    expect(s.n_editorial_summaries_excluded).toBe(1)
  })
  test('EL-VOICE: the same words unmarked in a body line are still listed', () => {
    const s = evidence(t => t.replace(AT, `form provided by MBC. ${VOICE}`))['EL-VOICE'].state
    expect(JSON.stringify(s.body_sentences_with_editor_voice_terms)).toContain('This excerpt omits')
    expect(s.n_editorial_summaries_excluded).toBe(0)
  })
  test('EL-HOLDING: a summary inside a sentence is listed as a mark inside a sentence, and counted', () => {
    const s = evidence(t => t.replace('Investors were asked to identify a desired', 'Investors were asked to identify #emph[[Summary: The court lists the terms.]] a desired'))['EL-HOLDING'].state
    expect(JSON.stringify(s.marks_inside_a_sentence)).toMatch(/Investors were asked to identify\s+\[\. \. \.\]\s+a desired/)
    expect(s.n_editorial_summaries).toBe(1)
  })
  test('EL-GAP: a summary line directly above a skipped heading counts as the mark there', () => {
    const gap = (edit: (t: string) => string) => evidence(edit)['EL-GAP'].state.gaps.find((g: any) => g.found.startsWith('III.'))
    const summarised = gap(t => t.replace(AT, 'form provided by MBC.\n\n#emph[[Summary: The court describes the escrow arrangements.]]'))
    expect(summarised.a_mark_or_centred_break_immediately_above).toBe(true)
    const unmarked = gap(t => t.replace(AT, 'form provided by MBC.'))
    expect(unmarked.a_mark_or_centred_break_immediately_above).toBe(false)
  })
})
