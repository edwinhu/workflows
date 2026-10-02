# Calibration and wiring

## The criterion

`criterion` in the manifest, shared by every set: **violating >= 0.85, compliant and real < 0.5, on
every run**; a score > 0.5 by another rule of the set on a violating case is a **cross-rule hit**,
reported, not failed. `rule-calibrate.ts` exits 0 when every wired rule passes, 1 when one fails,
2 when Jev is unreachable or any score is missing — never a pass. A passing uncalibrated rule prints
"ready to wire"; that line is not wiring.

```bash
bun skills/work/scripts/rule-calibrate.ts --set <set> --runs 2            # the whole set
bun skills/work/scripts/rule-calibrate.ts --set <set> --rule <ID> --runs 2  # one rule + its cross column
bun skills/work/scripts/rule-calibrate.ts --manifest <plugin>/tests/fixtures/jev/calibration.json --runs 2
```

Cost scales with the set: 110 Jev calls for authoring, 290 for typst after legacy pairs, 584 for
`--set all`. Use `--rule` while iterating; run the whole set once before committing, since a changed
helper moves every rule that imports it.

## What counts as passed

- **Two consecutive invocations of `--runs 2` after the last code change** to the extractor, the
  proposition or the cases. An invocation before the last change does not count.
- **Margin.** A score within 0.03 of a bar needs a third passing invocation (`new-rule.ts --wire`
  does this). A rule that keeps landing there wants a firmer state, not more runs: T-STORY's charter
  case read 0.84–0.89 until its extractor stopped showing the diagram labels, then 0.99–1.00.
- **A "ready to wire" pair inside a failing history is noise.** T-TAKEAWAY failed rounds 2 and 3 and
  passed round 4 (0.46/0.47); it stayed parked.
- **Cross-rule hits.** Fix the twin when it breaks two rules by accident; accept (`--accept-cross`)
  when one defect breaks both by definition (an unlogged transform violates DQ4 and DQ6).
- **Uncalibrated rules still cost calls** in every set run and appear in the cross matrix; a parked
  rule's hits (DQ1 on every ds case) do not fail anything.

## Parking

A rule that does not pass stays in `<set>/uncalibrated/` with its measured numbers and the reason in
the module docstring:

```python
"""UNCALIBRATED -- not wired. Calibration 2026-10-02, two runs each of two rounds: violating fixture never
reached 0.85: 0.75/0.79 with the first wording, 0.51/0.56 with the stricter one; compliant and real <= 0.28.
Kept here, below the glob rule-check.ts reads, until the question or the extractor earns it back.
"""
```

Parking is a result, not a failure to report: it records which rules Jev cannot decide.

## Wiring

`new-rule.ts --wire` moves the module; everything else is a one-time step per set:

1. **Workflow args.** The workflow's dispatch fence carries `ruleChecks` (one per run):
   `ruleChecks: { name: "jev-<set>-rules", cmd: "bun ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/rule-check.ts --project-dir <projectDir> --plan <planPath> --rules ${CLAUDE_PLUGIN_ROOT}/constraints/jev/<set>" }`.
   `--rules` repeats: the writing workflow adds `--rules …/legal` or `…/econ` from the plan's
   `Domain:`. A read-only (audit) mode has no diff, so it passes `--files <paths>` instead of
   `--project-dir`. A skill with no `work` fence (skill-creator) gets a run step with the exit codes.
2. **Per-edit mod.** `hooks/jev/rules.ts`: add the set to `RuleSet` and `RULE_DIRS`, and a path test
   in `ruleSetFor` — order matters (exams → authoring → lecture notes → lecture deck → addenda → talk
   deck → prose → dev → ds). A set another plugin ships also goes in `TEACHING_SETS` and
   `TEACHING_PROBE`, and falls back to `writing` when that plugin is absent. Add a case to
   `tests/jev-edit-mod.test.ts`.
3. **Calibration manifest.** The scaffold adds the set; drop `uncalibratedDir` only when the directory
   is empty and removed.
4. **Lens trim.** For each item a wired rule now decides, one sentence in the lens or reviewer prompt:
   "<what> is the <rule> verdict in the digest: do not re-grade it, except to rule on a verdict ranked
   below the block line." Keep presence questions and everything an uncalibrated rule would cover.
5. **Docs.** `docs/DESIGN-routing.md` § Calibrating Jev rules is the method's reference; the set's
   checks reference (`writing-checks.md`, `workshop-checks.md`) names the rules.

Tests go through `scripts/test.sh` (parallel, own TMPDIR, leak guard). Stub Jev with a local
`Bun.serve` on `WORK_HOLD_DECISIONS_URL`; never call the live endpoint from a test.
