#!/usr/bin/env bun
/**
 * hold-lint.ts — the decidable half of reviewing the COMMAND a HOLD is armed on.
 *
 * Sibling of heartbeat-lint.ts: that one lints the text a heartbeat re-enters with, this one lints
 * the check the Stop hook gates on. Two mechanisms, two artifacts, two linters.
 *
 * `hound-arm.sh` already refuses a check that is green (nothing to hold) or that cannot run
 * (exit > 1 is not a verdict). Those are runtime facts. This lints the check as a SPECIFICATION,
 * which is where 2026-09-21 went wrong: two gates passed arm-time validation and were still
 * mis-specified — one measured a pager whose discreteness is intended, the other asserted a
 * threshold above its instrument's own ceiling and then began returning exit 3 on a flaky recorder.
 *
 * It renders no opinion on whether the objective is RIGHT — "measures the wrong property" is
 * judgment and stays the session's problem. It settles what a string and two probes can settle.
 *
 * Usage: hold-lint.ts '<check command>' [--probe]
 *   --probe  also RUN the check twice (the flakiness and duration rules need execution)
 * Exit 0 clean, 1 findings, 2 usage.
 */

const args = process.argv.slice(2)
const probe = args.includes('--probe')
const check = args.filter((a) => a !== '--probe')[0]
if (!check) {
  console.error("usage: hold-lint.ts '<check command>' [--probe]")
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

// R2 APOSTROPHE. hound-arm takes the check as one single-quoted argument; an apostrophe ends it.
if (check.includes("'")) {
  add('critical', 'apostrophe', 'an apostrophe ends the single quote hound-arm.sh wraps this in; rewrite the word without it')
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
