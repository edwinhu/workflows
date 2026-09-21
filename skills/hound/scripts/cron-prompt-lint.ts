#!/usr/bin/env bun
/**
 * cron-prompt-lint.ts — the decidable half of reviewing the text a heartbeat re-enters with.
 *
 *   bun cron-prompt-lint.ts "<cron prompt>" [--json]
 *   bun cron-prompt-lint.ts --file BRIEF.md [--json]
 *
 * Exit 0 = clean, 1 = findings, 2 = usage error.
 *
 * The CRON PROMPT is the only text present when a tick fires into a quiet session, so it is what
 * has to carry the standing authority, the continuation rule, the complete list of terminal
 * blockers and both teardowns. Every rule answers a question about the STRING alone — no repo
 * access, no model. A defect that needs judgement is not in here; see SKILL.md. This exists
 * because ~/.claude/CLAUDE.md rule 9 forbids settling by prose review what an exit code can settle.
 *
 * The two escapes are NOT rules here: a round counter and a wall clock are `hound-arm.sh --rounds`
 * and `--minutes`, enforced by the hook rather than remembered by the model.
 */

import { readFileSync } from 'node:fs'

type Finding = {
  rule: string
  severity: 'critical' | 'major' | 'minor'
  message: string
  fix: string
}

/** Anything that reads as a settleable quantity: a threshold, a percentage, a count, an exit code. */
const NUMERIC = /\b\d[\d,._]*\s*(%|percent|rows?|files?|filings?|ms\b|s\b|minutes?|hours?|of\b|\/)/i
const EXIT_CODE = /exit(s|ed)?\s+(code\s+)?[0-9]|\bPASS\b|\breturns 0\b/i
const BACKTICKED = /`[^`]{3,}`/

/**
 * Milestone verbs: true while the objective is still unmet. Each one closed a real run early.
 * `has returned a verdict` is the exact clause from the 2026-08-27 npx-reconcile stall, where a
 * hard FAIL — 0 of 5 tasks implemented — counted as done.
 */
const MILESTONE =
  /\b(has |have |is |are )?(returned a verdict|been carried out|been completed|finished running|been dispatched|been written|exists|landed|ran|run to completion|been run|reported back|notified)\b/i

/** A clause only a human can close. Measured 2026-08-22: an 18-hour wait on one of these. */
const HUMAN_DEP =
  /\b(user|human|you|I)\s+(has\s+)?(approve[sd]?|confirm(s|ed)?|sign(s|ed)?[- ]off|repl(y|ies|ied)|respond(s|ed)?|says?|okays?|greenlights?)\b|\bhuman review\b|\btuicr\b|\bmanual(ly)? (review|approv)/i

/** Nothing in the harness counts turns; the ceilings are the hook's --rounds and --minutes. */
const TURN_COUNT = /\bstop after\b[^.]{0,24}\bturns?\b|\b\d+\s+turns?\b/i

/**
 * Success stated as a feeling rather than a measurement. `work` is deliberately NOT here: it is a
 * noun in every well-formed prompt ("take the next action", "hunt for work the check does not
 * cover") and the adjective that matters is the one next to it — `correctly`, `properly`, `clean`.
 */
const VAGUE =
  /\b(usable|useful|good|better|solid|clean|correct(ly)?|properly|as expected|reasonable|acceptable|sensible|robust|nice)\b/i

/** Terminal-state language: conflating a difficulty with a blocker. */
const DONE_OR_BLOCKED = /\b(when|if)\s+(you (are|'re) )?(done|finished|complete)\s+or\s+blocked\b|\bdone or blocked\b/i

/** Standing authority: the sentence that pre-answers the questions asked at 02:00. */
const AUTHORITY =
  /\b(standing authority|pre[- ]?authoriz|without asking|do not ask|don'?t ask|may commit|you may (commit|push|decide|choose|pick)|decide (it |this )?yourself|your call|no need to ask)\b/i

/**
 * A continuation clause: what happens to the REMAINING BUDGET when the stated scope closes.
 *
 * `next( task| item| defect)` used to count on its own and it is the wrong test — the terminal
 * blockers clause ends "everything else is the next task, difficulty included", which is about not
 * filing a difficulty as a blocker and says nothing about budget. Measured 2026-09-16: a text with
 * no continuation at all passed on that phrase, then closed at its first stopping point with 2
 * rounds and 400 minutes unspent.
 */
const CONTINUATION =
  /\b(keep (going|working)|continue until|(take|start|pick|begin) (on )?the next|next action|then (move|go|proceed) (on )?to|do not stop|don'?t stop|until the (budget|ceiling|rounds?)|spend the (remaining|rest)|budget remains|largest (open|remaining)|re-?dispatch|report at the ceiling)\b|\bon (a )?FAIL\b|\bnot a stopping point\b|\bin the same turn\b/i

/**
 * The teardown that nothing else can carry: a cron outlives the work and `CronDelete` is a model
 * tool with no CLI, so this text is the only thing present at the moment the work is done. The
 * hold's own teardown is self-clearing — the hook removes the state file when the check exits 0 —
 * so it is prescribed in SKILL.md but not required of every string.
 */
const TEARDOWN_CRON = /\bCronDelete\b/

/**
 * `isBrief` = the text is a multi-paragraph brief rather than a one-line tick. A brief may
 * legitimately contain question marks (it specifies what the recon must answer); a tick may not.
 */
function lint(text: string, isBrief = false): Finding[] {
  const f: Finding[] = []
  const t = text.trim()
  const hasNumber = NUMERIC.test(t)

  if (!t) return [{ rule: 'C0', severity: 'critical', message: 'Prompt is empty.', fix: 'Write one.' }]

  if (MILESTONE.test(t) && !EXIT_CODE.test(t) && !hasNumber)
    f.push({
      rule: 'C1',
      severity: 'critical',
      message: `Milestone verb with nothing measured: "${(t.match(MILESTONE) || [''])[0]}". This is true while the objective is still unmet, so a tick reading it reports done over unfinished work.`,
      fix: 'Name the state the WORK reaches — the check exiting 0, or a number someone can dispute — not the event on the way there.',
    })

  if (HUMAN_DEP.test(t))
    f.push({
      rule: 'C2',
      severity: 'critical',
      message: `Clause only a human can close: "${(t.match(HUMAN_DEP) || [''])[0]}". A tick fires into an empty room.`,
      fix: 'Move the human step out and into a phase the session performs after the hold releases.',
    })

  if (TURN_COUNT.test(t))
    f.push({
      rule: 'C3',
      severity: 'critical',
      message: 'Turn-counting escape. Nothing in the harness counts turns — no num_turns, no turn_count — so this is prose re-adjudicated on every tick.',
      fix: 'The ceilings are `hound-arm.sh --rounds N --minutes M`, which the Stop hook enforces. Do not restate them as prose.',
    })

  if (!EXIT_CODE.test(t) && !BACKTICKED.test(t))
    f.push({
      rule: 'C4',
      severity: 'major',
      message: 'No check command named: no backticked command and no exit code. A tick that re-reads the conversation is a tick that gets reasoned out of.',
      fix: 'Name the command the tick RUNS, in backticks, so its exit code lands in the transcript as evidence.',
    })

  if (VAGUE.test(t) && !hasNumber)
    f.push({
      rule: 'C5',
      severity: 'major',
      message: `Success stated as a judgement, not a measurement: "${(t.match(VAGUE) || [''])[0]}".`,
      fix: 'Replace with a number and its denominator — the thing a referee would ask for.',
    })

  if (t.includes('?') && !isBrief)
    f.push({
      rule: 'C6',
      severity: 'major',
      message: 'The prompt contains a question. At 02:00 a question is a five-hour pause with extra steps.',
      fix: 'Answer it now and state the answer as the instruction.',
    })

  if (DONE_OR_BLOCKED.test(t))
    f.push({
      rule: 'C7',
      severity: 'critical',
      message: '"done or blocked" makes any difficulty terminal. A fixture that is hard to cut, a menu with two branches, an unpushed commit — each reads as blocked and each is work.',
      fix: 'Enumerate the blockers that genuinely stop the session (missing credential, network down, an irreversible action). Everything not on that list is the next task.',
    })

  if (!AUTHORITY.test(t))
    f.push({
      rule: 'C8',
      severity: 'major',
      message: 'No standing authority. Every decision this text leaves open becomes a question asked into an empty room.',
      fix: 'State in one sentence what the session may decide alone: commit, pick the next scope, re-dispatch, choose between two branches it named itself.',
    })

  if (!CONTINUATION.test(t))
    f.push({
      rule: 'C9',
      severity: 'major',
      message: 'No continuation clause. When the stated scope closes, nothing says the remaining budget gets spent.',
      fix: 'State what happens next: "when a run returns, take the next action rather than proposing it; keep going until the ceiling."',
    })

  if (!TEARDOWN_CRON.test(t))
    f.push({
      rule: 'C10',
      severity: 'major',
      message: 'No teardown. A cron outlives the work and CronDelete is a model tool with no CLI, so this text is the only thing present when the work is done.',
      fix: 'End with: end this heartbeat with CronDelete. If a hold was armed for the same objective and did not self-clear, `hound-arm.sh --disarm` goes in the same sentence.',
    })

  return f
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const fileIdx = argv.indexOf('--file')
  let text: string
  if (fileIdx !== -1) {
    const p = argv[fileIdx + 1]
    if (!p) {
      console.error('cron-prompt-lint: --file needs a path')
      process.exit(2)
    }
    text = readFileSync(p, 'utf8')
  } else {
    const positional = argv.filter((a) => !a.startsWith('--'))
    if (positional.length === 0) {
      console.error('usage: cron-prompt-lint.ts "<cron prompt>" | --file <path> [--json]')
      process.exit(2)
    }
    text = positional.join(' ')
  }

  const findings = lint(text, fileIdx !== -1)
  if (json) {
    console.log(JSON.stringify({ findings, clean: findings.length === 0 }, null, 2))
  } else if (findings.length === 0) {
    console.log('cron-prompt-lint: clean')
  } else {
    for (const x of findings) {
      console.log(`[${x.severity.toUpperCase()}] ${x.rule}: ${x.message}`)
      console.log(`         fix: ${x.fix}`)
    }
    console.log(`\n${findings.length} finding(s).`)
  }
  process.exit(findings.length === 0 ? 0 : 1)
}

if (import.meta.main) main()

export { lint, type Finding }
