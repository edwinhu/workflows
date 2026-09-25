/**
 * grind.sh — subjects, loop-derived exhaustion, and the reopen record.
 *
 * Measured 2026-09-25 on a 108-iteration production journal: 23 iterations (21%) recorded nothing,
 * and one family (CIK 810573) collected 6 attempt records under 6 different free-text keys while
 * three separate iterations re-diagnosed the same blocker. Attempt records are never shown to a
 * later iteration, and a free-text key cannot group work on one family — so an amnesiac loop spends
 * a fifth of its model calls rediscovering what an earlier pass already wrote down.
 *
 * A subject is the grouping key. Exhaustion is DERIVED from the journal the same way floors and the
 * iteration counter are — never recorded — so there is no second file that can disagree about
 * whether a subject is still worth a pass. A subject goes quiet after --exhaust-after attempts with
 * nothing to show, and comes back only when an iteration says what changed: a `reopen` record whose
 * rerunReason is non-empty. Recording is never refused for being exhausted; only PICKING is
 * discouraged, and only through the prompt.
 *
 * Nothing here touches the network. `--runner` points at a stub in every case.
 *
 * Run: bun test /home/eh/projects/workflows/skills/grind/scripts/grind-subjects.test.ts
 */
import { describe, expect, test, afterAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const GRIND = `${import.meta.dir}/grind.sh`
const SKILL_MD = resolve(import.meta.dir, '..', 'SKILL.md')

/** Attempts on one subject with nothing to show before the loop stops offering it. */
const EXHAUST_DEFAULT = 3
/** The newest N subjects reach the prompt; older ones drop rather than growing it without end. */
const SUBJECT_CAP = 30
/** A subject's `last=` excerpt is cut here, so one chatty note cannot dominate the block. */
const LAST_MAX = 200

const scratch: string[] = []
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })))

function workdir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  scratch.push(d)
  return d
}

function script(dir: string, name: string, bodyText: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${bodyText}\n`)
  chmodSync(p, 0o755)
  return p
}

/** Append through the agent's own channel, returning the raw result so a refusal can be asserted. */
function appendRaw(journal: string, rec: Record<string, unknown>) {
  return spawnSync('bash', [GRIND, 'append', '--journal', journal, JSON.stringify(rec)], {
    encoding: 'utf8', timeout: 30_000,
  })
}

/** Append and insist it landed — for the records a test treats as setup rather than as subject. */
function append(journal: string, rec: Record<string, unknown>) {
  const r = appendRaw(journal, rec)
  if (r.status !== 0) throw new Error(`append refused: ${r.stderr}`)
}

function records(journal: string): any[] {
  if (!existsSync(journal)) return []
  return readFileSync(journal, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .flatMap(l => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
}

/**
 * A run whose check never goes green, with a stub runner that files every prompt it is given under
 * prompt-<iteration>.txt. `extraRunner` is bash appended to that stub: it re-reads GRIND_SH and
 * GRIND_JOURNAL out of the prompt it was handed, which is how an iteration stands in for an agent
 * appending records mid-run.
 */
function loop(d: string, iters: number, extraRunner = '', extraArgs: string[] = []) {
  const journal = join(d, 'journal.jsonl')
  writeFileSync(join(d, 'prompt.txt'), 'work the goal')
  const runner = script(
    d,
    'runner.sh',
    [
      `printf '%s' "$2" > ${join(d, 'prompt')}-"$GRIND_ITERATION".txt`,
      `sh=$(printf '%s' "$2" | sed -n 's/^GRIND_SH: //p' | head -n 1)`,
      `j=$(printf '%s' "$2" | sed -n 's/^GRIND_JOURNAL: //p' | head -n 1)`,
      extraRunner,
      'exit 0',
    ].join('\n'),
  )
  return {
    journal,
    prompt: (i: number) => readFileSync(`${join(d, 'prompt')}-${i}.txt`, 'utf8'),
    args: [
      '--journal', journal,
      '--check', script(d, 'check.sh', 'exit 1'),
      '--runner', runner,
      '--prompt-file', join(d, 'prompt.txt'),
      '--sleep', '0',
      '--max-iters', String(iters),
      ...extraArgs,
    ],
  }
}

function run(args: string[]) {
  return spawnSync('bash', [GRIND, 'run', ...args], { encoding: 'utf8', timeout: 60_000 })
}

/** The GRIND_SUBJECTS block: its header line plus the indented subject lines that follow it. */
function subjectsBlock(prompt: string): string[] {
  const lines = prompt.split('\n')
  const start = lines.findIndex(l => l.startsWith('GRIND_SUBJECTS:'))
  if (start < 0) return []
  const out = [lines[start]]
  for (let i = start + 1; i < lines.length && lines[i].startsWith('  '); i++) out.push(lines[i])
  return out
}

/**
 * The one subject line naming `subject`, without its leading indent. Throws rather than returning
 * undefined, so a missing block fails as "grind.sh printed no GRIND_SUBJECTS line" instead of as a
 * TypeError further down, which would read like a broken test rather than a missing feature.
 */
function subjectLine(prompt: string, subject: string): string {
  const lines = subjectsBlock(prompt).slice(1).map(l => l.slice(2))
  const hit = lines.find(l => l.split('\t')[0] === subject)
  if (hit === undefined) {
    throw new Error(
      `no GRIND_SUBJECTS line for subject ${JSON.stringify(subject)}; the block held ${JSON.stringify(lines)}`,
    )
  }
  return hit
}

function fieldsOf(line: string): Record<string, string> {
  const parts = line.split('\t')
  const out: Record<string, string> = { subject: parts[0] }
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq < 0) out.state = p
    else out[p.slice(0, eq)] = p.slice(eq + 1)
  }
  return out
}

describe('grind.sh — a subject with nothing to show is retired from the prompt', () => {
  test('three attempts and no progress mark the subject EXHAUSTED', () => {
    const d = workdir('grind-subj-exhaust')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= EXHAUST_DEFAULT; n++) {
      append(journal, { kind: 'attempt', subject: '810573', note: `tried route ${n}` })
    }

    const r = run(args)

    expect(r.status).toBe(4)
    const f = fieldsOf(subjectLine(prompt(1), '810573'))
    expect(f.attempts).toBe(String(EXHAUST_DEFAULT))
    expect(f.state).toBe('EXHAUSTED')
    // The header must say what EXHAUSTED costs a reader, or the word is decoration.
    expect(subjectsBlock(prompt(1))[0]).toMatch(/reopen/i)
  })

  test('two attempts are still open — the threshold is >= N, not > 0', () => {
    const d = workdir('grind-subj-under')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'attempt', subject: '810573', note: 'first' })
    append(journal, { kind: 'attempt', subject: '810573', note: 'second' })

    const r = run(args)

    expect(r.status).toBe(4)
    const f = fieldsOf(subjectLine(prompt(1), '810573'))
    expect(f.attempts).toBe('2')
    expect(f.state).toBe('open')
    expect(subjectsBlock(prompt(1)).join('\n')).not.toContain('EXHAUSTED')
  })

  test('a progress record on the subject resets the count to zero', () => {
    const d = workdir('grind-subj-progress-reset')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= 4; n++) {
      append(journal, { kind: 'attempt', subject: '810573', note: `tried ${n}` })
    }
    append(journal, { kind: 'progress', subject: '810573', key: 'K1', note: 'linked 4k rows' })

    const r = run(args)

    expect(r.status).toBe(4)
    const f = fieldsOf(subjectLine(prompt(1), '810573'))
    expect(f.attempts).toBe('0')
    expect(f.state).toBe('open')
    // progress= is the LIFETIME count on the subject, which is what tells a reader the subject has
    // ever paid out; attempts= is the count since the reset.
    expect(f.progress).toBe('1')
  })

  test('attempts after a progress record count from that record, not from the start', () => {
    const d = workdir('grind-subj-after-progress')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= 3; n++) append(journal, { kind: 'attempt', subject: 'S', note: `a${n}` })
    append(journal, { kind: 'progress', subject: 'S', key: 'K1', note: 'moved' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a4' })

    const r = run(args)

    expect(r.status).toBe(4)
    const f = fieldsOf(subjectLine(prompt(1), 'S'))
    expect(f.attempts).toBe('1')
    expect(f.state).toBe('open')
  })

  test('--exhaust-after 0 disables the feature: nothing is ever EXHAUSTED', () => {
    const d = workdir('grind-subj-off')
    const { journal, args, prompt } = loop(d, 1, '', ['--exhaust-after', '0'])
    for (let n = 1; n <= 8; n++) append(journal, { kind: 'attempt', subject: 'S', note: `a${n}` })

    const r = run(args)

    expect(r.status).toBe(4)
    const block = subjectsBlock(prompt(1))
    expect(block.length).toBeGreaterThan(1)
    expect(block.join('\n')).not.toContain('EXHAUSTED')
    expect(fieldsOf(subjectLine(prompt(1), 'S')).attempts).toBe('8')
  })

  test('--exhaust-after 2 retires a subject the default would still offer', () => {
    const d = workdir('grind-subj-flag')
    const { journal, args, prompt } = loop(d, 1, '', ['--exhaust-after', '2'])
    append(journal, { kind: 'attempt', subject: 'S', note: 'a1' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a2' })

    const r = run(args)

    expect(r.status).toBe(4)
    expect(fieldsOf(subjectLine(prompt(1), 'S')).state).toBe('EXHAUSTED')
  })
})

describe('grind.sh — reopen is the only way back, and it must say what changed', () => {
  test('a valid reopen is written and resets the subject to open', () => {
    const d = workdir('grind-subj-reopen-ok')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= EXHAUST_DEFAULT; n++) {
      append(journal, { kind: 'attempt', subject: 'S', note: `a${n}` })
    }
    const ok = appendRaw(journal, {
      kind: 'reopen', subject: 'S', rerunReason: 'the 2004 filings finished re-parsing',
    })
    expect(ok.status, `reopen refused: ${ok.stderr}`).toBe(0)
    expect(records(journal).filter(x => x.kind === 'reopen').length).toBe(1)

    const r = run(args)

    expect(r.status).toBe(4)
    const f = fieldsOf(subjectLine(prompt(1), 'S'))
    expect(f.attempts).toBe('0')
    expect(f.state).toBe('open')
  })

  test('attempts after a reopen count from the reopen', () => {
    const d = workdir('grind-subj-reopen-then-attempt')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= EXHAUST_DEFAULT; n++) {
      append(journal, { kind: 'attempt', subject: 'S', note: `a${n}` })
    }
    append(journal, { kind: 'reopen', subject: 'S', rerunReason: 'new dictionary landed' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a4' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a5' })

    const r = run(args)

    expect(r.status).toBe(4)
    const f = fieldsOf(subjectLine(prompt(1), 'S'))
    expect(f.attempts).toBe('2')
    expect(f.state).toBe('open')
  })

  test('the later of progress and reopen is the reset point', () => {
    const d = workdir('grind-subj-reset-latest')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'reopen', subject: 'S', rerunReason: 'first reopen' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a1' })
    append(journal, { kind: 'progress', subject: 'S', key: 'K1', note: 'moved' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a2' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a3' })

    const r = run(args)

    expect(r.status).toBe(4)
    expect(fieldsOf(subjectLine(prompt(1), 'S')).attempts).toBe('2')
  })

  test('a reopen without rerunReason is refused with exit 2 and writes nothing', () => {
    const d = workdir('grind-subj-reopen-noreason')
    const journal = join(d, 'journal.jsonl')
    // A valid reopen first, so this test fails when the kind is missing rather than when it is
    // merely unimplemented-and-therefore-refused-for-the-wrong-reason.
    const ok = appendRaw(journal, { kind: 'reopen', subject: 'S', rerunReason: 'the blocker cleared' })
    expect(ok.status, `a valid reopen must be accepted: ${ok.stderr}`).toBe(0)
    const before = records(journal).length

    const bad = appendRaw(journal, { kind: 'reopen', subject: 'S' })

    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('rerunReason')
    expect(records(journal).length, 'a refused record must be absent, not present-and-ignored').toBe(before)
  })

  test('a reopen with an empty or whitespace rerunReason is refused too', () => {
    const d = workdir('grind-subj-reopen-blankreason')
    const journal = join(d, 'journal.jsonl')
    const ok = appendRaw(journal, { kind: 'reopen', subject: 'S', rerunReason: 'real reason' })
    expect(ok.status, `a valid reopen must be accepted: ${ok.stderr}`).toBe(0)
    const before = records(journal).length

    for (const reason of ['', '   ']) {
      const bad = appendRaw(journal, { kind: 'reopen', subject: 'S', rerunReason: reason })
      expect(bad.status).toBe(2)
      expect(bad.stderr).toContain('rerunReason')
    }
    expect(records(journal).length).toBe(before)
  })

  test('a reopen without a subject is refused with exit 2 and writes nothing', () => {
    const d = workdir('grind-subj-reopen-nosubject')
    const journal = join(d, 'journal.jsonl')
    const ok = appendRaw(journal, { kind: 'reopen', subject: 'S', rerunReason: 'the blocker cleared' })
    expect(ok.status, `a valid reopen must be accepted: ${ok.stderr}`).toBe(0)
    const before = records(journal).length

    const noSubject = appendRaw(journal, { kind: 'reopen', rerunReason: 'the blocker cleared' })
    expect(noSubject.status).toBe(2)
    expect(records(journal).length).toBe(before)

    const blankSubject = appendRaw(journal, { kind: 'reopen', subject: '  ', rerunReason: 'cleared' })
    expect(blankSubject.status).toBe(2)
    expect(records(journal).length).toBe(before)
  })
})

describe('grind.sh — recording is always allowed, even on an exhausted subject', () => {
  test('an attempt on an exhausted subject is still accepted by append', () => {
    // Spec item 5. The loop discourages PICKING an exhausted subject through the prompt; refusing to
    // RECORD what happened would make the journal lie about the work that was done, and the journal
    // is the loop's only memory.
    const d = workdir('grind-subj-record-allowed')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= EXHAUST_DEFAULT; n++) {
      append(journal, { kind: 'attempt', subject: 'S', note: `a${n}` })
    }
    // The subject IS exhausted at this point — asserted through the prompt, so this test is about a
    // record landing on an exhausted subject rather than on any subject at all.
    expect(run(args).status).toBe(4)
    expect(fieldsOf(subjectLine(prompt(1), 'S')).state, 'the subject must be EXHAUSTED first')
      .toBe('EXHAUSTED')

    const another = appendRaw(journal, { kind: 'attempt', subject: 'S', note: 'a4 anyway' })
    expect(another.status, `an attempt on an exhausted subject must be recorded: ${another.stderr}`).toBe(0)

    const progress = appendRaw(journal, { kind: 'progress', subject: 'S', key: 'K1', note: 'it moved' })
    expect(progress.status, `progress on an exhausted subject must be recorded: ${progress.stderr}`).toBe(0)

    expect(records(journal).filter(x => x.kind === 'attempt').length).toBe(EXHAUST_DEFAULT + 1)
    expect(records(journal).filter(x => x.kind === 'progress').length).toBe(1)
  })
})

describe('grind.sh — the shape of the GRIND_SUBJECTS block', () => {
  test('with no subjects the prompt says so rather than omitting the block', () => {
    const d = workdir('grind-subj-none')
    const { args, prompt } = loop(d, 1)

    const r = run(args)

    expect(r.status).toBe(4)
    expect(subjectsBlock(prompt(1))).toEqual(['GRIND_SUBJECTS: none.'])
  })

  test('the block sits after GRIND_FLOORS and before GRIND_NOTES', () => {
    const d = workdir('grind-subj-order')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'floor', key: 'DEAD', why: 'no data exists' })
    append(journal, { kind: 'note', key: 'scope', note: 'rank by row count' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a1' })

    const r = run(args)

    expect(r.status).toBe(4)
    const lines = prompt(1).split('\n')
    const floors = lines.findIndex(l => l.startsWith('GRIND_FLOORS:'))
    const subjects = lines.findIndex(l => l.startsWith('GRIND_SUBJECTS:'))
    const notes = lines.findIndex(l => l.startsWith('GRIND_NOTES:'))
    expect(floors).toBeGreaterThanOrEqual(0)
    expect(subjects).toBeGreaterThan(floors)
    expect(notes).toBeGreaterThan(subjects)
  })

  test('a line carries subject, attempts, progress, state and the newest attempt excerpt', () => {
    const d = workdir('grind-subj-fields')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'attempt', subject: '810573', note: 'older attempt' })
    append(journal, { kind: 'progress', subject: '810573', key: 'K1', note: 'moved once' })
    append(journal, { kind: 'attempt', subject: '810573', note: 'newest attempt text' })

    const r = run(args)

    expect(r.status).toBe(4)
    const line = subjectLine(prompt(1), '810573')
    const parts = line.split('\t')
    expect(parts[0]).toBe('810573')
    expect(parts[1]).toBe('attempts=1')
    expect(parts[2]).toBe('progress=1')
    expect(parts[3]).toBe('open')
    expect(parts[4]).toBe('last=newest attempt text')
    // The excerpt is the NEWEST attempt, not the first one the scan happened to see.
    expect(line).not.toContain('older attempt')
  })

  test('the excerpt falls back to `why` when an attempt carries no note', () => {
    const d = workdir('grind-subj-why')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'attempt', subject: 'S', why: 'the grid job died' })

    const r = run(args)

    expect(r.status).toBe(4)
    expect(fieldsOf(subjectLine(prompt(1), 'S')).last).toBe('the grid job died')
  })

  test('the excerpt is cut to 200 characters', () => {
    const d = workdir('grind-subj-cut')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'attempt', subject: 'S', note: 'x'.repeat(250) })

    const r = run(args)

    expect(r.status).toBe(4)
    const last = fieldsOf(subjectLine(prompt(1), 'S')).last
    expect(last.length).toBe(LAST_MAX)
    expect(last).toBe('x'.repeat(LAST_MAX))
  })

  test('a record with no subject, or a whitespace one, is not listed', () => {
    const d = workdir('grind-subj-blank')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'attempt', note: 'no subject at all' })
    append(journal, { kind: 'attempt', subject: '   ', note: 'whitespace subject' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a real one' })

    const r = run(args)

    expect(r.status).toBe(4)
    const lines = subjectsBlock(prompt(1)).slice(1)
    expect(lines.length).toBe(1)
    expect(lines[0].slice(2).split('\t')[0]).toBe('S')
  })

  test('a subject with only a note record is not listed', () => {
    // Only subjects with at least one attempt or progress record are listed; a note is steering,
    // not work done on the subject.
    const d = workdir('grind-subj-noteonly')
    const { journal, args, prompt } = loop(d, 1)
    append(journal, { kind: 'note', subject: 'N', key: 'scope', note: 'mentioned only' })
    append(journal, { kind: 'attempt', subject: 'S', note: 'a1' })

    const r = run(args)

    expect(r.status).toBe(4)
    const lines = subjectsBlock(prompt(1)).slice(1).map(l => l.slice(2).split('\t')[0])
    expect(lines).toEqual(['S'])
  })

  test('only the newest 30 subjects appear, most recently touched last', () => {
    const d = workdir('grind-subj-cap')
    const { journal, args, prompt } = loop(d, 1)
    for (let n = 1; n <= 32; n++) append(journal, { kind: 'attempt', subject: `s${n}`, note: `a${n}` })

    const r = run(args)

    expect(r.status).toBe(4)
    const subjects = subjectsBlock(prompt(1)).slice(1).map(l => l.slice(2).split('\t')[0])
    expect(subjects.length).toBe(SUBJECT_CAP)
    expect(subjects[0]).toBe('s3')
    expect(subjects.at(-1)).toBe('s32')
    expect(subjects).not.toContain('s1')
    expect(subjects).not.toContain('s2')
  })

  test('a subject recorded BETWEEN iterations reaches the next one', () => {
    // The same read-at-the-top-of-the-pass property the floors and notes have: a subject an
    // iteration files is in hand for the next prompt, or the block is memory nobody keeps.
    const d = workdir('grind-subj-midrun')
    const { args, prompt } = loop(
      d,
      2,
      `[ "$GRIND_ITERATION" = "1" ] && bash "$sh" append --journal "$j" '{"kind":"attempt","subject":"810573","note":"tried the sibling CIK"}'`,
    )

    const r = run(args)

    expect(r.status).toBe(4)
    expect(subjectsBlock(prompt(1))).toEqual(['GRIND_SUBJECTS: none.'])
    const f = fieldsOf(subjectLine(prompt(2), '810573'))
    expect(f.attempts).toBe('1')
    expect(f.last).toBe('tried the sibling CIK')
  })
})

describe('skills/grind/SKILL.md documents the subject machinery', () => {
  const md = () => readFileSync(SKILL_MD, 'utf8')

  test('names subject, --exhaust-after and GRIND_SUBJECTS', () => {
    const body = md()
    expect(body).toContain('subject')
    expect(body).toContain('--exhaust-after')
    expect(body).toContain('GRIND_SUBJECTS')
  })

  test('documents reopen as the way back, and that it needs rerunReason', () => {
    // An agent reconstructs the record shape from its prompt and this file. A reopen documented
    // without its required field is a record the next iteration writes, gets refused, and cannot
    // explain.
    const body = md()
    expect(body).toContain('reopen')
    expect(body).toContain('rerunReason')
    const sentences = body.split(/(?<=[.!?])\s+|\n/).filter(s => /reopen/i.test(s))
    expect(
      sentences.some(s => /rerunReason/.test(s)),
      'SKILL.md must document reopen and rerunReason together',
    ).toBe(true)
  })

  test('says exhaustion excludes a subject the way a floor excludes a key', () => {
    const body = md()
    const sentences = body.split(/(?<=[.!?])\s+|\n/).filter(s => /exhaust/i.test(s))
    expect(sentences.length).toBeGreaterThan(0)
    expect(
      sentences.some(s => /subject/i.test(s)),
      'SKILL.md must tie exhaustion to subjects',
    ).toBe(true)
  })
})
