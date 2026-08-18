# plan-lint — the two tiers of plan review

Plan review is the computed review of the args `workflow.js` will run, and it is finished before
dispatch. Two tiers, in order; `craft-dispatch.sh` enforces both.

| Tier | What decides it | Cost | Terminates because |
|---|---|---|---|
| 1 — schema | `scripts/plan-lint.ts` over the plan's structured fields | ~15 ms, 0 agents | the rule set is finite |
| 2 — baseline | `scripts/plan-preflight.ts` runs the plan's own commands and reads exit codes | one command each, 0 agents | an exit code is not an opinion |

There is no third, judged tier — the measurement that removed it is in `SKILL.md` under *Plan
review*. What a reader would catch belongs here as a rule instead.

## Running them

```bash
bun ~/.claude/skills/workflows/skills/craft/scripts/plan-lint.ts      <plan.md|args.json> [--json]
bun ~/.claude/skills/workflows/skills/craft/scripts/plan-preflight.ts <plan.md|args.json> --cwd <repo> [--json] \
    [--only redCommand|mechanical|acceptance] [--skip <key,key>] [--timeout N] [--unsafe]
```

Both accept a plan file or a craft args object. Exit 0 clean, 1 findings, 2 unparseable. Fix
everything they report before dispatching Phase 4.

**Severity is the precision claim.** Tier 1's `major` rules are the ones whose verdict is
unambiguous — measured 13/13 true positives across three real plans. `acceptance-clause-uncommanded`
and `redcommand-relative-path` are `minor` and advisory: whether a prose sentence states a
requirement is itself a judgement, which is what tier 1 exists to exclude. A clause a mechanical
check already runs is not a finding at all.

Tier 2 executes commands taken verbatim from a plan that has not been vetted yet: live-service and
network commands are skipped unless `--unsafe`, and `--skip <key,key>` drops named ones. A gate that
needs the network to prove itself is a finding, not a reason to pass `--unsafe`.

Tier 2 probes three kinds: every task's `redCommand`, every `mechanicalChecks.cmd`, and every
runnable command in a task's `acceptance`. A `redCommand` already green (`red-not-red`) or exiting
127 refuses the dispatch; an acceptance command exiting 127 is `acceptance-command-not-found`
(critical), and a task with no `redCommand` whose acceptance commands all exit 0 at baseline is
`acceptance-green-at-baseline` (major) — nothing there distinguishes "the work landed" from "the
work was never started".

## What each tier cannot do

Tier 1 cannot tell a missing artifact from one already in the tree — that is tier 2. Tier 2 cannot
tell a legitimate regression guard from a vacuous gate: it reports the green/red split and the plan
must declare which is which.
