# Why the fix loop does not converge

The measurement behind `SKILL.md`'s two assertions — that the judged plan layer grew its own reviewed
surface (§ *Plan review*), and that a plan amended by accretion "manufactures new surface for the
next one" (§ *The FAIL fix loop*). Read this before changing the fix loop, the lens set, or the
round-exit condition.

Derived from 67 `result*.json` across 19 `.craft/` run directories, 8 multi-round, 240 surviving
findings, 633 raw lens findings (snapshot 2026-08-14). Full per-run tables and method notes:
`.craft/CONVERGENCE-ANALYSIS.md` (gitignored, may be gone).

## The four numbers

| | |
|---|---|
| Runs where `survivingBlocking` strictly decreases | **0 of 10** |
| Findings that repeat a prior round's finding (any prior round, not just the last) | **0 of 158 exact; 3 loose (1.9%)** |
| Raw lens findings per round, pooled over 54 rounds | **11.7, slope −0.13/round, r = −0.13** |
| Refutation survival rate | **27%, sd 0.16, flat across rounds** |

Constant generation × constant filter ⇒ **P(a round exits) = 5/54 = 9%**, expected ~11 rounds
*regardless of the state of the deliverable*. Observed: exits at rounds 5 and 12; two runs abandoned
at 7 and 13. `0809-ds-migration` reached zero blocking at round 5 and climbed back — round 5 raised
12 findings and the refuters happened to kill all 12.

**The loop terminates by luck, not by depletion.** Monotonicity was never available. Every individual
verdict in the corpus is defensible; the refuters work (they kill 464 of 633); the design's exit
condition is simply a draw from a population that does not shrink.

Two further facts that shape any fix:

- **Only the judged half of the gate decides anything.** Of 64 FAIL rounds, 51 had a surviving lens
  finding and **4** had a failing mechanical check.
- **Zero blocking findings is not a PASS.** Two rounds hit `survivingBlocking: 0` and still failed on
  a non-empty `tasksThatFlagged`.

## The two generators

### 1. The control surface regenerates (dominant — 18 of 19 runs)

63% of findings (title-only classification) to 80% (title + detail) target the run's own plan,
acceptance clauses, mechanical command or lens prompts rather than the product. `plan-gateability`,
`gate-integrity`, `plan-workflow-doctrine` and `plan-parallelism` produce 51% of all findings and are
~85% control-surface; `extraction-unity` and `vendor-fidelity`, the two lenses judging a domain
artifact, are 6% and 10%.

The plan is rewritten every round and grows every round (3 of 4 archived plan sets monotone up;
`0814-writeside-findings-r2`: 31 522 → 34 416 → 35 584 → 35 911 bytes).

**Chain A — one `mechanicalChecks` command, rewritten three times in four rounds**
(`0814-writeside-findings-r2`, diffed across its four `plan-<hash>.md` archives):

1. `for t in dev ds writing; do bash check.sh --target $S/$t || rc=1; done`
   → round 1, gate-integrity MAJOR: *red at baseline, cannot exit 0 within scope, so its exit code
   decides nothing.* Correct — the plan itself declares those three fail at baseline.
2. `bun wc-probe.ts … | grep -q "P12 dispatch routing" && { …; rc=1; }`
   → round 3, gate-integrity MAJOR: *passes vacuously when the probe never ran.* Also correct — the
   pipe discards the probe's exit code.
3. `out=$(bun wc-probe.ts …); e=$?; if [ $e -ge 2 ]; then … else case "$out" in …`
   → round 4: the surviving finding is on a different leg, and MINOR. Exit.

Three findings, each decidable, none of which could exist without the previous round's fix.

**Chain B — a lint rule that eats its own plan** (`0814-craft-cleanup`): round 3, *"R14's widening is
inert on project-relative writablePaths"* → widen R14 → round 4, *"Widened R14 has no deletion
exemption, so **the approved plan now fails its own tier-1 gate** with 2 blocking majors."*

**Chain C — the adjacent sentence** (`0814-craft-cleanup`, final round): *"The rewritten Tier 2 block
still attributes a could-not-run classifier to plan-preflight, **one bullet below the sentence that
was corrected**."*

**The controlled experiment.** `write-side-migration` r1/r2/r3 were three dispatches of one plan that
halted on the old judged plan layer: **20/16/17 findings, 8/8/9 surviving, zero title overlap, zero
artifacts built.** Deliverable held at nothing; only the plan changed; the rate did not fall and the
surviving count rose. That layer is now deleted in favour of computed `plan-lint`/`plan-preflight`.
The two multi-round runs after the deletion are the only two non-increasing ones (3,2,2,1 and
4,1,1,0) — n=2, suggestive, not proven. The *post-dispatch* gate-judging lens remains.

### 2. Accretive scope (the two runs that never converged)

`0813-upstream-classes` is the worst oscillator (7,9,8,6,3,3,6) and the *least* control-surface run
(28%) — its findings are genuine product defects in a large artifact. It is not the plan regenerating;
it is a surface no round can exhaust, enlarged every round.

`tasks[].work` carries **21** `ROUND N —` amendment markers across 6 tasks in `upstream-classes` and
**17** across 4 tasks in `notes-port`. **Every other run carries zero.** The two runs that accreted
their task text are exactly the two that never converged.

## What shipped

- **The finding set is frozen from round 2** (`freezeFindingSet`, carried `priorFindings`), so the
  exit condition is "is the round-1 blocking set closed?" — finite and shrinking — instead of a draw
  from the constant-rate generator. Fresh blocking lens findings become `residue`: reported, and the
  input to a follow-up run's `priorFindings`. Covers both generators.
- **`maxRounds`, default 3.** The only remedy whose benefit does not depend on which generator is
  running. `notes-port` sat at exactly 2 surviving for its final five rounds; 39.6 h of logged wall
  clock bought 3 PASSes in 67 rounds.
- **Accretion is a tier-1 rule** (`plan-lint`'s `work-accretion`, MAJOR) and a `converge-check.ts`
  reason. It fires on exactly `upstream-classes` and `notes-port` across the corpus.
- **`converge-check.ts`**, advisory: the blocking sequence, generation slope, repeat rate,
  deliverable-vs-gate split and accretion count, computed from the run's own archives.

Two remedies were considered and dropped. **Gate-judging lenses blocking once, then going advisory**
is subsumed by the freeze — after round 1 no fresh lens finding blocks, gate-judging or not.
**Requiring a blocking finding to name a path some task wrote** would downgrade genuine defects in
files no task touched, and the freeze already defuses the `scope-fidelity` cases that motivated it
(pytest caches, a foreign staged deletion, "eleven dirty files attributable to the concurrent craft
session").

**Do not dedupe findings against a seen-set.** It would suppress 3 findings out of 158. The
`workflow-creator` loop-until-dry doctrine warns to dedupe against `seen` because *its* finders
re-surface the same bug; craft's lenses never do. It would also weaken the one genuine cross-run
repeat — a defect restated across a run boundary because it was still unfixed.

**Do not freeze the plan outright.** Some amendments are obligatory (a `redCommand` wrong as written
cannot stand, and the hash makes it unignorable). Freezing the finding set and refusing accretion
stop the exit condition from moving and stop the plan from growing, without forbidding a correction.
