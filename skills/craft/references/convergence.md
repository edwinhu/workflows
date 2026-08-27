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

## When a round repeats — which lever actually moves a stuck run

`converge-check.ts` compares each round's **failure signature**: the ids in `tasksThatFlagged`, the
non-`red-green` red verdicts, and the names in `mechanicalThatFailed`. Lens findings are excluded —
they never repeat (0 of 158 above), so a repeat there says nothing. Two consecutive rounds with the
same non-empty signature is the run's most informative event: **two independent implementers, working
from the same brief, hit the same wall in the same place.** That is evidence about the brief.

Measured case (`mail-bridge`, 2026-08-26): rounds 1 and 2 failed identically — same benchmark
regression, same red cases, two implementations converging on the same rejected design. Cause: the
task's `writablePaths` named one file, while the only signal that could satisfy the acceptance
required cooperation from writers in other files. The task was infeasible inside its own boundary, so
every implementer had to fake it the same way. A read-only analysis found this in one pass.

The levers, ranked by yield per token:

1. **Re-derive the constraint by measurement.** A read-only agent that goes and measures the thing the
   round assumed. Cheapest, and the only one that can change the *question*. Five hypotheses were
   refuted this way in one day; every one had been confidently held.
2. **Check feasibility inside the declared scope** — is the signal the acceptance demands reachable
   from inside this task's `writablePaths`? This is the specific form (1) takes after a repeat, and it
   is what the repeat reason prints.
3. **Model diversity.** Addresses FRAMING lock-in, not execution quality. Worth pulling only once (1)
   and (2) have shown the brief is sound — and craft already carries two thirds of it:
   - **Judge side, cross-provider: `thirdParty: ["codex"|"gemini"]`.** Already shipped, and advisory
     by construction. This is the diversity lever that exists; a second reader that does not share
     the first's framing is exactly what a repeated failure calls for, and it cannot corrupt the gate.
   - **Whole spine, cross-provider: `craft-dispatch.sh --provider codex|gemini`** (same flag on
     `craft-redispatch.sh`, so a stuck round can switch and re-run). It reaches farm.sh's
     `--provider`, which swaps the CLIProxyAPI wrapper. The wrapper remaps the **tier names** —
     `codex-code` exports `ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-5.6-terra`, opus→`gpt-5.6-sol` — so
     every `model: 'sonnet'` already in `workflow.js` follows with no arg change. Implementers,
     verifiers, lenses, refuters and probes all move together.
   - **Granularity is the whole run, and that is structural.** There is no way to put implementers on
     one provider and lenses on another: the provider is chosen when the spine is launched, before
     `workflow.js` runs. Not a gap to fill — a split run would be two gates.
   - **The provider is never written to `args.json`.** It is a property of the dispatch, not the plan,
     and the point of the lever is to DIFFER between rounds; a sticky value would silently pin round 4
     to whatever broke round 3.
   - **Per-leg tier tuning inside one provider: `implementerModel` / `lensModel`.** Plan keys, so
     changing them means amending the plan and re-hashing.
4. **A parallel horse race across approaches — do not build one into craft.** Two independent
   blockers, and the first is the same one that already keeps worktrees out (SKILL.md, *Red flags*):
   `workflow.js` has no filesystem, so it can neither isolate N competing implementations nor merge
   the winner, and a merge agent's silent slip reads as an implementer's omission. Second, a race
   needs a decidable selector. Craft's per-task signals are `redCommand`'s exit code, the verifier and
   the mechanical checks — if every horse goes green they do not discriminate, and picking a winner
   collapses into a fuzzy prose judgement, which is the loop that does not terminate. If one horse
   goes green it was not a race, it was retry-until-green, and the round already does that. Race
   outside craft, at the CLARIFY architecture step, where the deliverable is a *choice* and a human
   makes it.

**Neither (3) nor (4) would have helped the measured case, and running them is how a spec defect gets
paid for N times instead of once.** A specification failure is infeasible for every model equally; N
agents in parallel hit one wall N times and return N confident wrong answers. Diversity and racing
buy capability, and capability was never what was short.
