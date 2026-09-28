#!/usr/bin/env bun
/**
 * hold-lint.ts — the decidable half of reviewing the OBJECTIVE a HOLD is armed on: its check
 * command and its `--goal` text.
 *
 * There is no second linter, and the tick prompt has none: a tick is a NUDGE and the hold carries
 * the objective, so every rule about the objective — milestone phrasing, a human-closed clause, a
 * turn count, success stated as a judgement — is here, over the check and the `--goal` text both.
 *
 * `work-hold.sh` already refuses a check that is green (nothing to hold) or that cannot run
 * (exit > 1 is not a verdict). Those are runtime facts. This lints the check as a SPECIFICATION,
 * which is where 2026-09-21 went wrong: two gates passed arm-time validation and were still
 * mis-specified — one measured a pager whose discreteness is intended, the other asserted a
 * threshold above its instrument's own ceiling and then began returning exit 3 on a flaky recorder.
 *
 * It renders no opinion on whether the objective is RIGHT — "measures the wrong property" is
 * judgment and stays the session's problem. It settles what a string and two probes can settle.
 *
 * Usage: hold-lint.ts '<check command>' [--goal '<objective>'] [--probe]
 *        hold-lint.ts --goal '<objective>'          a CHECK-LESS hold: the goal is the whole objective
 *   --goal   also lint the objective text the hold records and the judge rules on
 *   --probe  also RUN the check twice (the flakiness and duration rules need execution)
 * Exit 0 clean, 1 findings, 2 usage.
 */

const args = process.argv.slice(2)
const probe = args.includes('--probe')
const goalIdx = args.indexOf('--goal')
if (goalIdx !== -1 && !args[goalIdx + 1]) {
  console.error('hold-lint: --goal needs the objective text')
  process.exit(2)
}
const goal = goalIdx === -1 ? '' : args[goalIdx + 1]
const consumed = new Set(goalIdx === -1 ? [] : [goalIdx, goalIdx + 1])
const check = args.filter((a, i) => a !== '--probe' && !consumed.has(i))[0] ?? ''
// A check-less hold is lintable — the goal is then the whole objective — but SOMETHING has to be.
if (!check && !goal) {
  console.error("usage: hold-lint.ts '<check command>' [--goal '<objective>'] [--probe]")
  console.error("       hold-lint.ts --goal '<objective>'   (check-less hold)")
  process.exit(2)
}
if (!check && probe) {
  console.error('hold-lint: --probe needs a check command to run')
  process.exit(2)
}

type Sev = 'critical' | 'major' | 'minor'
const findings: Array<{ sev: Sev; rule: string; detail: string }> = []
const add = (sev: Sev, rule: string, detail: string) => findings.push({ sev, rule, detail })

// R1 MILESTONE. True the moment a file appears, and a file appears long before the work is done.
// The skill states this rule; nothing enforced it.
const milestone = /(^|\s)(test\s+-[feds]\s|\[\s+-[feds]\s|ls\s+\S+\s*$)/
if (milestone.test(check)) {
  add('major', 'milestone', 'the check tests for a FILE, which is true while the objective is unmet; name a state the work reaches (a suite passing, a rate under a number, a count at zero)')
}

// R1b ROUND VERDICT. A `work` round's verdict is the wrong thing to hold on, in both directions: it
// goes green on a FAIL the loop was going to fix, and it OUTLIVES the run — an abandoned run leaves
// result.json sitting there forever, so the hold can neither release nor be argued with. AGK
// 2026-09-27: a heartbeat armed on `work-result.sh` woke 14 times with no news, each tick
// re-entering a 113 KB plan and a 276 KB run dir.
// `.craft/` is the retired run root: a check reading one is still a round verdict, so keep refusing it.
if (/work-result\.sh|result\.json|(^|[\s"'`/])\.(work|craft)\//.test(check)) {
  add(
    'critical',
    'round-verdict',
    'the check reads a work ROUND VERDICT (work-result.sh / result.json / .work/). A round verdict cannot certify the goal and outlives an abandoned run; arm on the goal check itself, or use grind for long loops',
  )
}

// R2 APOSTROPHE. work-hold takes the check as one single-quoted argument; an apostrophe ends it.
if (check.includes("'")) {
  add('critical', 'apostrophe', 'an apostrophe ends the single quote work-hold.sh wraps this in; rewrite the word without it')
}

// R3 FOREIGN PATHS. A check whose paths live in another repo can never be met where it runs.
const cwd = process.cwd()
const abs = [...check.matchAll(/(^|\s)(\/[^\s"']+)/g)].map((m) => m[2])
const foreign = abs.filter((p) => !p.startsWith(cwd) && !p.startsWith('/nix/store') && !p.startsWith('/tmp') && !p.startsWith('/usr') && !p.startsWith('/bin'))
if (foreign.length) {
  add('minor', 'foreign-path', `paths outside the session cwd (${cwd}): ${foreign.slice(0, 3).join(', ')} — meetable only if that tree is the work`)
}

// R4 NO ASSERTION. A check that prints a number but compares nothing holds on whatever it feels.
if (/\b(echo|printf|cat)\b/.test(check) && !/(-ge|-le|-gt|-lt|-eq|\[\[|\btest\b|exit\s+1|grep\s+-q)/.test(check)) {
  add('minor', 'no-assertion', 'the check looks like it only prints; a gate needs a comparison whose exit code decides')
}

// ── The OBJECTIVE rules. Each answers a question about a string alone, and each runs over BOTH
// surfaces the hold records: the check command and the `--goal` text the judge rules on.

/**
 * R7 MILESTONE PHRASING. True while the objective is still unmet. `has returned a verdict` is the
 * exact clause from the 2026-08-27 npx-reconcile stall, where a hard FAIL — 0 of 5 tasks
 * implemented — counted as done.
 */
const MILESTONE_WORDS =
  /\b(has |have |is |are )?(returned a verdict|been carried out|been completed|finished running|been dispatched|been written|exists|landed|ran|run to completion|been run|reported back|notified)\b/i
/** Anything that reads as a settleable quantity: a threshold, a percentage, a count, an exit code. */
const NUMERIC = /\b\d[\d,._]*\s*(%|percent|rows?|files?|filings?|ms\b|s\b|minutes?|hours?|of\b|\/)/i
const EXIT_CODE = /exit(s|ed)?\s+(code\s+)?[0-9]|\bPASS\b|\breturns 0\b/i
/** A clause only a human can close. Measured 2026-08-22: an 18-hour wait on one of these. */
const HUMAN_DEP =
  /\b(user|human|you|I)\s+(has\s+)?(approve[sd]?|confirm(s|ed)?|sign(s|ed)?[- ]off|repl(y|ies|ied)|respond(s|ed)?|says?|okays?|greenlights?)\b|\bhuman review\b|\btuicr\b|\bmanual(ly)? (review|approv)/i
/** Nothing in the harness counts turns; the ceilings are work-hold.sh --rounds and --minutes. */
const TURN_COUNT = /\bstop after\b[^.]{0,24}\bturns?\b|\b\d+\s+turns?\b/i
/**
 * Success stated as a feeling rather than a measurement. `work` is deliberately NOT here: it is a
 * noun in every well-formed objective, and the adjective that matters is the one next to it.
 */
const VAGUE =
  /\b(usable|useful|good|better|solid|clean|correct(ly)?|properly|as expected|reasonable|acceptable|sensible|robust|nice)\b/i

for (const [surface, text] of [
  ['check', check],
  ['goal', goal],
] as const) {
  if (!text) continue
  const measured = NUMERIC.test(text) || EXIT_CODE.test(text)

  if (MILESTONE_WORDS.test(text) && !measured) {
    add(
      'critical',
      `milestone-phrasing (${surface})`,
      `"${(text.match(MILESTONE_WORDS) || [''])[0]}" is true while the objective is still unmet, so the hold releases over unfinished work; name the state the WORK reaches — a suite passing, a rate under a number, a count at zero`,
    )
  }
  if (HUMAN_DEP.test(text)) {
    add(
      'critical',
      `human-dependency (${surface})`,
      `"${(text.match(HUMAN_DEP) || [''])[0]}" can only be closed by a person, and a held session cannot work its way to it (measured 18h); review after the hold releases, as a step the session performs`,
    )
  }
  if (TURN_COUNT.test(text)) {
    add(
      'critical',
      `turn-count (${surface})`,
      'nothing in the harness counts turns — no num_turns, no turn_count — so a turn ceiling is prose re-adjudicated every round; the ceilings are work-hold.sh --rounds N --minutes M, which the Stop hook enforces',
    )
  }
  if (VAGUE.test(text) && !measured) {
    add(
      'major',
      `vague-success (${surface})`,
      `success stated as a judgement rather than a measurement: "${(text.match(VAGUE) || [''])[0]}"; replace it with a number and its denominator`,
    )
  }
}

if (probe) {
  const { spawnSync } = await import('node:child_process')
  const runs: Array<{ code: number; ms: number }> = []
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now()
    const r = spawnSync('bash', ['-lc', check], { encoding: 'utf8', timeout: 900_000 })
    runs.push({ code: r.status ?? 2, ms: Date.now() - t0 })
  }
  const [a, b] = runs

  // R5 FLAKINESS. Two runs, two answers: that is an instrument, not a gate. This is the rule that
  // would have refused check-o-wheel-fps.sh, which alternated between 1 and 3 on a recorder that
  // sometimes wrote no video.
  if (a.code !== b.code) {
    add('critical', 'flaky', `two consecutive runs disagreed (${a.code} then ${b.code}); a hold on this blocks or releases on chance`)
  }
  if (a.code > 1 || b.code > 1) {
    add('critical', 'could-not-run', `a run exited ${Math.max(a.code, b.code)}, which is could-not-run rather than a verdict`)
  }

  // R6 COST. The hook runs this on EVERY Stop. A three-minute check turns each turn end into a
  // three-minute pause, and a desktop check also takes over the screen while it runs.
  const worst = Math.max(a.ms, b.ms)
  if (worst > 60_000) {
    add('major', 'slow', `a run took ${(worst / 1000).toFixed(0)}s; this executes on every Stop, so the hold costs that per turn`)
  } else if (worst > 15_000) {
    add('minor', 'slow', `a run took ${(worst / 1000).toFixed(0)}s per Stop`)
  }
  console.log(`probe: exits ${a.code},${b.code}; ${(a.ms / 1000).toFixed(1)}s,${(b.ms / 1000).toFixed(1)}s`)
}

if (!findings.length) {
  console.log('hold-lint: clean')
  process.exit(0)
}
const order: Sev[] = ['critical', 'major', 'minor']
for (const sev of order) {
  for (const f of findings.filter((x) => x.sev === sev)) {
    console.log(`${sev.toUpperCase().padEnd(9)} ${f.rule}`)
    console.log(`          ${f.detail}`)
  }
}
console.log(`\n${findings.length} finding(s) — ${findings.filter((f) => f.sev === 'critical').length} critical`)
process.exit(1)
