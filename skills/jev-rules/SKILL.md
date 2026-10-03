---
name: jev-rules
description: 'Use when a written rule should become a Jev rule check, or an existing one misbehaves — "turn this rule into a Jev rule", "add a rule check", "make this a Jev check", "calibrate this rule", "why does my rule not separate", "my rule fires on accepted work", "my rule never blocks", "the violating case scores 0.6", "park this rule", "wire this rule", "unwire it", "add a rule set for <workflow>", "add a real case for this rule". Use proactively whenever a reviewer or lens keeps re-judging the same checkable rule, even if the user never says Jev. NEGATIVE ROUTING: running the existing rules over a change is rule-check.ts inside the workflow, not this skill; whether a phrase is an AI tic is ai-tic; a skill or workflow edit that only consumes rule checks is skill-creator or workflow-creator.'
user-invocable: true
---

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

A Jev rule is three parts: a deterministic **extractor** (`evidence()`), **one proposition** a judge
answers with P(VIOLATED), and a **calibration set** that proves the two separate. The runner is
`skills/work/scripts/rule-check.ts`; the calibrator is `skills/work/scripts/rule-calibrate.ts`; a rule
blocks at p >= 0.85.

<EXTREMELY-IMPORTANT>
## Iron Law: NO RULE IS WIRED WITHOUT `new-rule.ts --wire` EXITING 0

**`--wire` exits 0 only after two consecutive `rule-calibrate --runs 2` invocations pass on the final
code, with real accepted cases in the set. Never by loosening a fixture, relabelling an accepted case
without the user's ruling, or moving the bar.** A rule that blocks accepted work costs the user every
later round it fires on; a rule wired on noise blocks at random. Both are worse than no rule.

## Iron Law: SCRIPT BEFORE JEV

**A rule a regex, AST walk or count settles is a script leg in the workflow's `check.sh`, never a Jev
rule.** Jev is for the judgement residue. DQ1 sat at 0.62–0.66 on its own violation and 0.78–0.91 on
other rules' files until a script (`ds-dq.py check_dq1`) took it. T-NARRATE's accepted Texas notes held
0.50–0.61 over seven invocations; its screen-phrase lexicon, as the workshop `NAR` check, separates
every case of its set.
</EXTREMELY-IMPORTANT>

## The process

```
triage ──► ALREADY MECHANICAL / COUNTED-ADVISORY / LENS ONLY ──► stop (name the owner)
   │
   ├──► SCRIPTABLE ──► script leg in check.sh (diff-scoped to added lines)
   │
   └──► JEV RULE ──► new-rule.ts <set> <ID> ──► extractor ──► proposition ──► twins
                                                                              │
                     real accepted cases (+ legacy-base ok/bad pairs) ◄───────┘
                                   │
                     new-rule.ts --wire <set> <ID>
                        exit 0 ──► wire into the workflow (new set only) ──► trim the lens
                        exit 4 ──► diagnose (references/diagnosis.md) ──► fix ──► --wire again
                        twice failed on accepted work, rule text right ──► ask the user, or PARK
```

1. **Triage** every rule into one bucket — `references/triage.md`. Script before Jev.
2. **Scaffold**: `bun ${CLAUDE_SKILL_DIR}/scripts/new-rule.ts <set> <ID> [--layout files|diff]` creates
   the module in `<set>/uncalibrated/`, identical placeholder twins, the manifest entry and a stub test
   under `tests/jev-rules/`. It refuses to overwrite. `--manifest <path>` targets another plugin's
   calibration set (teaching's carries a `root` key).
3. **Extractor** — `references/extractor.md`: deterministic, bounded, file:line spans, the counts and
   booleans the proposition reads, diff-scoped via `changed`, never the whole file.
4. **Proposition** — `references/proposition.md`: ONE checkable claim, YES = VIOLATED, the state field
   it reads, every exemption named.
5. **Twins and real cases** — `references/fixtures.md`. The stub test stays red until the twins differ.
6. **Wire**: `bun ${CLAUDE_SKILL_DIR}/scripts/new-rule.ts --wire <set> <ID>`. Exit 0 moved the module;
   2 = Jev unavailable (never a pass); 3 = a placeholder, TODO or empty case remains; 4 = calibration
   failed or a cross-rule hit (`--accept-cross` only when one defect rightly breaks both rules).
7. **A new set** also needs its workflow's `ruleChecks`, `RULE_DIRS` + `ruleSetFor` in
   `hooks/jev/rules.ts`, and a lens trim — `references/calibration.md` § Wiring.

When `--wire` exits 0, start the next JEV row of the triage table at once; never stop after one rule.

### Facts

- **Rewording the question is the first fix, never the fixture.** MOCK's violating twin went 0.51 →
  0.92 when the proposition named the state field (`every_assertion_on_mock`); the fixture was not touched.
- **A whole-file or raw-search state does not separate.** 9 of the 10 ds rules were unwired
  (213223f6) until each extractor reported a defect count (e9c530ea).
- **Accepted legacy work is scored on changed lines only.** DQ4/DQ6 scored 0.94–1.0 on 4 of 7 accepted
  scripts; diff-scoped with legacy-base pairs, bad 1.00 and ok 0.00 (9dd3be43).
- **A pass at the bar is noise; fix the state, not the bar.** T-STORY's charter case sat at 0.84–0.89
  until the extractor withheld the diagram labels that supplied the insight its comment lacked and
  gave closed-list flags instead: 0.99–1.00 (b3db6917). T-TAKEAWAY ranged 0.41–0.61 across 8 runs until
  its state stopped showing the slide body, whose lines stated the claim the label lacked: 0.93–0.98. `--wire` adds a third invocation within 0.03 of a bar.
- **Jev is the backend.** strands-decider v19 separated 0 of 18 rules (p stayed in 0.17–0.83; margin
  +0.105 against Jev's +0.564).

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| About to edit a twin after seeing its score | the calibration then measures your edit, not the rule | add a corrected `vio2`/`sat2` beside it; the old twin stays |
| About to relabel an accepted real case violating | the user accepted it; only they rule it wrong | ask; record the ruling in the manifest `source` and the docstring, then add a cured twin |
| About to hand the extractor's whole file to the state | the judge guesses, as on 9 of 10 ds rules | extract the spans and the count the proposition reads |
| About to move a module out of `uncalibrated/` by hand | it skips the two-invocation gate | `new-rule.ts --wire` |
| About to change `blockAt` or the manifest criterion for one rule | every rule's evidence was measured against 0.85 / 0.5 | fix the question or the extractor, or park |
| About to try a fourth wording for a rule that failed two rounds on accepted work | T-ECHO and T-TRANSITION never moved; the rule text and the accepted work disagree | ask the user which is right, or park with the numbers in the docstring |
