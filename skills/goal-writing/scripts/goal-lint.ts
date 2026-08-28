#!/usr/bin/env bun
/**
 * goal-lint.ts — the decidable half of goal review, computed.
 *
 *   bun goal-lint.ts "<goal text>" [--unattended] [--json]
 *   bun goal-lint.ts --file BRIEF.md [--unattended] [--json]
 *
 * Exit 0 = clean, 1 = findings, 2 = usage error.
 *
 * Every rule answers a question about the goal STRING alone — no repo access, no model. A goal
 * defect that needs judgement is not in here; see SKILL.md. This exists because ~/.claude/CLAUDE.md
 * rule 9 forbids settling by prose review what an exit code can settle.
 *
 * `--unattended` turns on the rules that only matter when nobody is awake to answer a question.
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
 * Milestone verbs: true while the objective is still unmet. Each one closed a real goal early.
 * `has returned a verdict` is the exact clause from the 2026-08-27 npx-reconcile stall, where a
 * hard FAIL — 0 of 5 tasks implemented — satisfied the goal and released the Stop hook.
 */
const MILESTONE =
  /\b(has |have |is |are )?(returned a verdict|been carried out|been completed|finished running|been dispatched|been written|exists|landed|ran|run to completion|been run|reported back|notified)\b/i

/** A clause only a human can close. Measured 2026-08-22: an 18-hour wait on one of these. */
const HUMAN_DEP =
  /\b(user|human|you|I)\s+(has\s+)?(approve[sd]?|confirm(s|ed)?|sign(s|ed)?[- ]off|repl(y|ies|ied)|respond(s|ed)?|says?|okays?|greenlights?)\b|\bhuman review\b|\btuicr\b|\bmanual(ly)? (review|approv)/i

/** Nothing in the harness counts turns. See craft/references/goal-and-review-gate-defects.md §1. */
const TURN_COUNT = /\bstop after\b[^.]{0,24}\bturns?\b|\b\d+\s+turns?\b/i

/** A ceiling the session can settle without a human: minutes/hours, or a counter file. */
const WALL_CLOCK = /\b\d+\s*(minute|min|hour|hr)s?\b/i
const COUNTER = /\b(rounds?|attempts?|iterations?)\b[^.]{0,60}\b(field|file|counter|reads|jq|cat)\b|\.json\b/i

/** Success stated as a feeling rather than a measurement. */
const VAGUE =
  /\b(works?|working|usable|useful|good|better|solid|clean|correct(ly)?|properly|as expected|reasonable|acceptable|sensible|robust|nice)\b/i

/** Terminal-state language for a brief: conflating a blocker with completion. */
const DONE_OR_BLOCKED = /\b(when|if)\s+(you (are|'re) )?(done|finished|complete)\s+or\s+blocked\b|\bdone or blocked\b/i

/** Standing authority: the sentence that pre-answers the questions asked at 02:00. */
const AUTHORITY =
  /\b(standing authority|pre[- ]?authoriz|without asking|do not ask|don'?t ask|may commit|you may (commit|push|decide|choose|pick)|decide (it |this )?yourself|your call|no need to ask)\b/i

/** A continuation clause: what happens to the remaining budget when a sub-run closes. */
const CONTINUATION =
  /\b(keep (going|working)|continue until|next( task| item| defect)|then (move|go|proceed) (on )?to|do not stop|don'?t stop|until the (budget|ceiling|rounds?)|spend the (remaining|rest)|re-?dispatch|report at the ceiling)\b|\bon (a )?FAIL\b|\bnot a stopping point\b|\bin the same turn\b/i

/**
 * `isBrief` = the text is a multi-paragraph brief rather than a one-line goal. A brief may
 * legitimately contain question marks (it specifies what the recon must answer); a goal may not.
 */
function lint(text: string, unattended: boolean, isBrief = false): Finding[] {
  const f: Finding[] = []
  const t = text.trim()
  const hasNumber = NUMERIC.test(t)
  const hasCheck = EXIT_CODE.test(t) || BACKTICKED.test(t)

  if (!t) return [{ rule: 'G0', severity: 'critical', message: 'Goal is empty.', fix: 'Write one.' }]

  if (MILESTONE.test(t) && !EXIT_CODE.test(t) && !hasNumber)
    f.push({
      rule: 'G1',
      severity: 'critical',
      message: `Milestone verb with nothing measured: "${(t.match(MILESTONE) || [''])[0]}". This is true while the objective is still unmet, and closing it releases the Stop hook.`,
      fix: 'Name the end state the WORK reaches — PASS, or a number someone can dispute — not the event on the way there.',
    })

  if (HUMAN_DEP.test(t))
    f.push({
      rule: 'G2',
      severity: 'critical',
      message: `Clause only a human can close: "${(t.match(HUMAN_DEP) || [''])[0]}". A goal is what a session can close BY WORKING.`,
      fix: 'Move the human step out of the goal and into a phase the session performs after the goal clears.',
    })

  if (TURN_COUNT.test(t))
    f.push({
      rule: 'G3',
      severity: 'critical',
      message: 'Turn-counting escape. Nothing in the harness counts turns — no num_turns, no turn_count — so this is prose re-adjudicated on every stop attempt.',
      fix: 'Name a counter the session can `cat`, or a wall-clock ceiling a script settles.',
    })

  if (!hasCheck)
    f.push({
      rule: 'G4',
      severity: 'major',
      message: 'No decidable check: no backticked command and no exit code.',
      fix: 'Name the command whose output settles it, in backticks, so running it lands as evidence in the transcript.',
    })

  if (!WALL_CLOCK.test(t))
    f.push({
      rule: 'G5',
      severity: 'major',
      message: 'No wall-clock ceiling. A goal with no time bound is one an unattended session cannot close by working when the work stalls.',
      fix: 'Add "or the run has been going N minutes or more" with the script that prints it.',
    })

  if (!COUNTER.test(t))
    f.push({
      rule: 'G6',
      severity: 'minor',
      message: 'No work-counter escape. A wall clock alone stops a stuck run but not a losing one.',
      fix: 'Name the rounds/attempts counter file and the value that ends it.',
    })

  if (VAGUE.test(t) && !hasNumber)
    f.push({
      rule: 'G7',
      severity: 'major',
      message: `Success stated as a judgement, not a measurement: "${(t.match(VAGUE) || [''])[0]}".`,
      fix: 'Replace with a number and its denominator — the thing a referee would ask for.',
    })

  if (t.includes('?') && !isBrief)
    f.push({
      rule: 'G8',
      severity: 'major',
      message: 'The goal contains a question. A goal states a destination; a question hands the destination back to the reader.',
      fix: 'Answer it now and state the answer as the destination.',
    })

  if (DONE_OR_BLOCKED.test(t))
    f.push({
      rule: 'G9',
      severity: 'critical',
      message: '"done or blocked" makes any difficulty terminal. A fixture that is hard to cut, a menu with two branches, an unpushed commit — each reads as blocked and each is work.',
      fix: 'Enumerate the blockers that genuinely stop the session (missing credential, network down, an irreversible action). Everything not on that list is the next task.',
    })

  if (unattended) {
    if (!AUTHORITY.test(t))
      f.push({
        rule: 'G10',
        severity: 'major',
        message: 'Unattended run with no standing authority. Every decision the goal leaves open becomes a question asked into an empty room.',
        fix: 'State in one sentence what the session may decide alone: commit, pick round-2 scope, re-dispatch, choose between two branches it named itself.',
      })
    if (!CONTINUATION.test(t))
      f.push({
        rule: 'G11',
        severity: 'major',
        message: 'Unattended run with no continuation clause. When the sub-run closes, nothing says the remaining budget gets spent.',
        fix: 'State what happens next: "when a run returns, take the next action rather than proposing it; keep going until the ceiling."',
      })
  }

  return f
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const unattended = argv.includes('--unattended')
  const fileIdx = argv.indexOf('--file')
  let text: string
  if (fileIdx !== -1) {
    const p = argv[fileIdx + 1]
    if (!p) {
      console.error('goal-lint: --file needs a path')
      process.exit(2)
    }
    text = readFileSync(p, 'utf8')
  } else {
    const positional = argv.filter((a) => !a.startsWith('--'))
    if (positional.length === 0) {
      console.error('usage: goal-lint.ts "<goal text>" | --file <path> [--unattended] [--json]')
      process.exit(2)
    }
    text = positional.join(' ')
  }

  const findings = lint(text, unattended, fileIdx !== -1)
  if (json) {
    console.log(JSON.stringify({ findings, clean: findings.length === 0 }, null, 2))
  } else if (findings.length === 0) {
    console.log('goal-lint: clean')
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
