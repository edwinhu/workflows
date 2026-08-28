# suite-lint false positives, measured against this repository

Issue 134's open question 4 asks for a number nobody has produced: how often does the suite lint fire
on a test that is not defective? A refusing gate that is wrong once costs a dispatch, so the gating
decision needs the false-positive count, not the raw count. This document is the measurement.

It does **not** recommend a threshold or a gating posture. That decision is explicitly out of scope
here; the deliverable is the number and enough method that someone who disagrees can re-run it or
argue with a specific row.

## Result

| rule id | raw findings | false positives | true positives |
|---|---|---|---|
| positive-match-failure-vocabulary | 24 | 23 | 1 |
| single-distinct-literal | 186 | 186 | 0 |
| existence-only-artifact | 0 | 0 | 0 |
| injected-key-never-varied | 39 | 39 | 0 |

Unparseable files: 0 of 218 linted. Every file the walker reached was extracted; nothing was dropped
silently, and no count above is understated by a skipped file.

One finding in 249 survives inspection.

## Method

The tool was run over the whole repository from its root:

```
bun skills/craft/scripts/suite-lint.ts --corpus /home/eh/projects/workflows
```

The same numbers are obtainable from the module API, which is what the accompanying suite
`skills/craft/scripts/suite-lint-report.test.ts` does:

```
bun -e 'import {lintCorpus} from "./skills/craft/scripts/suite-lint.ts"; console.log(lintCorpus(process.cwd()).counts)'
```

**Sample.** The tree at commit `4e7f28a9` with the working tree of this run in place, with the
hardened guard, the widened catastrophic-pattern classifier and the pair-cost budget of task H1
delivered and its suite green (40 pass, 0 fail). 216 test files were linted, in both dialects,
producing 247 findings across 122 files. Output is deterministic — sorted paths, no wall clock — so a
re-run over the same tree reproduces the counts exactly. If the tree has moved since, the raw counts
will move with it; recompute before disputing them. This measurement was taken last, after every
other task in the run had settled, precisely because the lint's own suites are inside the corpus and
every fixture they gain changes the totals.

**The counts moved while this run was in flight, and the mechanism is worth stating.** Earlier
versions of this document recorded 184 and then 183 `single-distinct-literal` findings. Both numbers
were correct when taken and both are wrong now, and neither moved because a rule changed. The corpus
contains the lint's own suite, and `skills/craft/scripts/suite-lint.test.ts` kept growing as task H1's
red gate demanded more of it. The two findings that account for the move to 185 are both in that file
and both name H1's work directly. `skills/craft/scripts/suite-lint.test.ts:438` flags
`isAffordablePair`, which is exported at `suite-lint.ts:564` and did not exist before H1, so no
earlier run could have reported it. `skills/craft/scripts/suite-lint.test.ts:462` flags the
`execFileSync('bun', …)` pair at lines 462 and 486 — the two out-of-process budget tests, which run
`lintSource` in a child because a regression there hangs rather than fails. A stale line reference in
the previous draft came from the same churn: line 459 held a `lintSource('many.test.ts', …)` call when
that draft was written and now holds `lintSource('scan.test.ts', …)`. This is the ordinary condition
of a lint whose corpus contains its own suite, not a defect — but it is why the report is rewritten
from a fresh run rather than edited in place, and why `suite-lint-report.test.ts` re-executes the
corpus instead of trusting the table.

**A caveat about the sample that matters for reading the raw counts.** `scratch/` holds three older
snapshots of this same repository (`scratch/ds-skill-eval/iteration-1/prior-workflows/`,
`scratch/python-suite-head/`, `scratch/python-suite-pre-port/`). The walker lints them because they
are in the tree, so many findings appear three or four times over near-identical copies of one file.
Of the 247 findings, 129 are in `scratch/`. Deduplicated to the working tree, the raw counts are
15 / 77 / 0 / 26 rather than 24 / 185 / 0 / 38. The table reports what the tool reports; the FP
verdicts below were reached on the distinct files and then carried to their copies, which are
byte-comparable at the cited lines.

**Classification procedure.** A finding is a **false positive** when the test it names is not
defective in the way the rule claims — that is, when the property the rule was written to detect
("the failure branch would still pass this assertion", "no input in this file distinguishes the two
behaviours", "nothing varies this key") is false of the actual file. The judgement is made by reading
the cited line and its surrounding test, not from the finding's own message. Every FP verdict below
names the mechanism that produced it, so a reader can check the claim against one line of source.

For `single-distinct-literal`, whose 185 findings are too many to quote individually, the procedure
was applied to all of them and the source was read in full for every finding whose flagged callee is
a project-local function rather than a host or standard-library one — `recordDispatch`, `amend`,
`run`, `carriedIds`, `withHook`, `hooksJson`, `runFarm`, `runProseAudit`, `_audit`, `uploadFile`,
`frontmatter_value`, `isAffordablePair` — plus `np.allclose`, `count` and `Error`. Those are the only
class where a true positive was plausible. The remaining findings flag a fixed parameter of a host or
standard-library callee, which is definitionally not the input under test.

## positive-match-failure-vocabulary

Raw 24, false positives 23, one true positive.

The one that survives is `skills/craft/scripts/craft-redispatch.test.ts:776`:

```
expect(r.out).toContain('CONVERGING')
```

Its fixture at line 770 is `rounds(f.dir, [2, 5])`, a rising sequence that the same file annotates at
line 752 as `// rises => NOT CONVERGING`. `'NOT CONVERGING'.includes('CONVERGING')` is true, so the
assertion passes on either verdict, and the sibling test at line 765 shows the author knew the
pairing was needed — it writes `expect(r.out).not.toContain('CONVERGING')` where the distinction
matters. This is the exact run-2 defect shape and the rule earns its keep on it.

The 23 false positives come from two mechanisms.

**A paired negative assertion the rule cannot see (1 finding).**
`skills/craft/scripts/converge-check.test.ts:93` asserts `toContain('CONVERGING')` and is immediately
followed, on line 94, by `expect(r.stdout).not.toContain('NOT CONVERGING')`, which is precisely the
repair the rule wants. The rule reads assertions one at a time and has no notion of a neighbouring
assertion that neutralises the ambiguity, so a correctly written test scores the same as the
defective one above it.

**File-wide literal pooling across unrelated tests (22 findings).** The rule collects failure-
vocabulary literals from the whole file and matches any positive assertion against all of them, so a
fixture string defined for one test taints an assertion belonging to another that can never see it.
`skills/workflow-creator/scripts/wc-probe.test.ts:419` asserts `findings[0].detail` contains
`guard.ts`; the matched "failure" literal is a fixture at line 470 belonging to a different test
(`'Do NOT use guard.ts; it was deleted from the hook config.'`), which never reaches `detail`. The
same mechanism produces `skills/workflow-creator/scripts/wc-probe.test.ts:261`,
`skills/workflow-creator/scripts/wc-probe.test.ts:755`,
`skills/workflow-creator/scripts/wc-probe.test.ts:3220` and
`skills/workflow-creator/scripts/wc-probe.test.ts:3265`; both
`skills/craft/scripts/craft-dispatch.test.ts:526` and
`skills/craft/scripts/craft-dispatch.test.ts:537`, whose matched literal is a malformed-plan fixture
about 150 lines away at line 682; `tests/public-extension-contract.test.ts:161`, where the assertion
is `toContain("specHash")` and the matched literal is a prose table cell at line 47 that happens to
contain the word; and the three cite-check findings
`skills/cite-check/tests/cite-check.test.ts:1174`, `skills/cite-check/tests/cite-check.test.ts:1178`
and `skills/cite-check/tests/cite-check.test.ts:1255`, where the matched literal is the input draft
`'Success claim [@SuccessKey2024-aa]. Failure claim [@FailedKey2024-bb].'` at line 1132 and the
assertion is on the generated report. The nine `scratch/` copies of those three cite-check findings
inherit the same verdict.

Two of the 22 deserve a separate note because they are self-reference:
`skills/craft/scripts/suite-lint.test.ts:131` and
`skills/craft/scripts/suite-lint-python.test.ts:98` are flagged for the lint's **own**
`/saved/i`-versus-`'plan NOT SAVED to disk'` fixture, which those suites embed as a string literal in
order to prove the rule fires. Both cited lines are `expect(f.evidence).toMatch(/saved/i)` — the
assertion that checks the finding, condemned by the fixture that produced it. A lint that runs over
the repository will always flag the file that demonstrates it. The tests are correct; the finding is
not.

## single-distinct-literal

Raw 185, false positives 185, no true positives.

The rule's premise is that if every literal argument to a repeatedly-called function is the same
value, no input in the file distinguishes the behaviours the tests claim differ. On this corpus that
premise held in none of the 185 cases, for three reasons.

**The varying input is not a literal (the dominant case).**
`skills/craft/scripts/craft-amend.test.ts:127` is `amend(f, '--apply')`, one of five calls passing the
same `'--apply'` (lines 127, 140, 155, 162, 202); that string is the mode under test and is constant
on purpose, while the discriminating input is `f`, a fixture built from `ACCRETED_TASK` in one test
and `ESCALATING_TASK` in another. Identically, `tests/farm-runner.test.ts:34` calls `runFarm('out.md',
{ writeRelative: 'out.md' })` while the paired test six lines below at line 40 calls
`runFarm('out.md')` with no options — the whole point of the pair is the second argument, which the
rule does not count. `skills/craft/scripts/craft-pending.test.ts:80` passes runId `'r'` across five
calls (lines 80, 101, 123, 159, 198) while varying the specHash and the directory. The rule sees
literal arguments only, so any test that varies its input through a variable, a fixture builder, a
temp path or an options object reads as undistinguished.

The two findings this run added are the same shape, and they are worth naming because they are the
lint indicting the very tests that hardened it. `skills/craft/scripts/suite-lint.test.ts:438` flags
two `isAffordablePair('a*b', …)` calls, at lines 438 and 439, for sharing the pattern `'a*b'`. Holding
the pattern fixed is the entire experiment: the claim under test is that one unanchored pattern flips
from affordable to unaffordable as the subject grows, so the discriminating input is the numeric
second argument — 990,000 and 400,000, both expected `false`. Line 446, twenty lines below in the
neighbouring test, calls `isAffordablePair('a*b', n)` for `n` in 80, 200 and 1,000 and asserts `true`.
The file distinguishes the two behaviours about as loudly as a file can; it just does not do it
through a differing literal in the same argument position.

**Variation by absence.** `tests/test_prose_audit.py:66` anchors a group of nine `_audit("tics.md")`
calls; two of them, at lines 77 and 78, sit inside one test that calls `_audit("tics.md")` and
`_audit("tics.md", style="legal")` to prove the domain guide is gated by style. The fixture filename
is deliberately constant *so that* style is the only difference. The rule flags the constant and
misses that the variation is the presence of a second argument.
`skills/workflow-creator/scripts/wc-probe.test.ts:416` is the same shape and worse: its call group
(lines 416, 424, 470) is a defective/correct **pair**, the exact test structure the vendored doctrine
asks for, where the fixture hook command is held identical and the second fixture adds the missing
file. The rule penalises the control.

**The literal is an incidental constant of a host callee.** Across the corpus, 37 findings flag the
encoding argument of `readFileSync`, 14 the separator of `split`, 13 the index of a regex `group()`,
11 the argument of `replace`, 10 of `slice`, 8 each of `join` and `execFileSync`, and so on down
through `stringify`, `createHash`, `digest` and `sys.exit`. None of these is a value under test;
varying them would break the test rather than strengthen it.
`skills/cite-check/tests/cite-check.test.ts:814` is the plainest case — nine `readFileSync(…, 'utf-8')`
calls, flagged for the encoding. `skills/craft/scripts/suite-lint.test.ts:462` is the same thing at
the end of this run's own work: `execFileSync('bun', …)` at lines 462 and 486, the two out-of-process
budget tests, flagged for the name of the interpreter. Those two tests differ in the fixture file they
write — one unanchored pattern against a 400 KB literal, versus twenty guard-defeating patterns
against twenty literals — and in their kill deadlines, 10 s and 20 s. Neither difference is a literal
argument to `execFileSync`. `skills/bmll/scripts/test_bmll_impact.py:47` is the most instructive:
`np.allclose(pre, 0)` is flagged for the constant `0` while line 52 asserts `(post > 0).all()` on the
same curve, so the file does distinguish the two behaviours — just not through a literal argument to
the same callee.

## existence-only-artifact

Raw 0, false positives 0.

The rule produced no findings on this corpus, so it contributes nothing to the false-positive count.
That is a fact about this repository at this commit, not evidence that the rule is inert: it fires on
its fixtures in `suite-lint.test.ts` and `suite-lint-python.test.ts`, which is what establishes it can
fire at all. A zero here should be read as "no artifact assertion in this tree is existence-only",
which is a plausible state for a repo whose suites mostly assert on parsed output.

## injected-key-never-varied

Raw 38, false positives 38, no true positives.

Three mechanisms, and the first is an extraction defect rather than a rule-design one.

**A ternary parsed as a key-value pair (8 findings).**
`skills/craft/scripts/converge-check.test.ts:44` contains `verdict: r.blocking === 0 ? 'PASS' : 'FAIL'`
and is reported as the key `PASS` with the value `'FAIL'`. There is no such key. The same misparse
produces the `PASS: 'FAIL'` findings at `skills/craft/scripts/craft-dispatch-loops.test.ts:37`,
`skills/craft/scripts/craft-loop.test.ts:31` and `skills/craft/scripts/craft-result.test.ts:654`, and
the `ACTIVE: "PROCESSING"` finding at `skills/cite-check/tests/gemini.test.ts:98`
(`state: getCalls >= 2 ? "ACTIVE" : "PROCESSING"`) together with its three `scratch/` copies. The
gemini case is doubly wrong: that line exists precisely to vary the state across polls.

**Prose and comments read as configuration (4 findings).** `tests/agent-contract.test.mjs:18` is a
comment sentence, "THE DIRECTORY STATES THE SCOPE: `agents/` is auto-discovered…", reported as the key
`SCOPE`. `tests/bluebook-cites.test.ts:59` is a comment quoting a DOI, reported as `URL`.
`tests/test_prose_audit.py:746` is a fixture comment containing the word "CHANGED:". And
`skills/craft/scripts/dev-lens-contract.test.ts:12` is a header comment explaining that the suite
deliberately does **not** read `git show HEAD:`, reported as the key `HEAD` — a finding produced by
the very sentence documenting the absence of the thing.

**Harness plumbing, correctly held constant (26 findings).** The remainder are environment keys a test
sets to configure its own harness rather than to exercise a branch: `CRAFT_DISPATCH_DRYRUN: '1'` (at
`skills/craft/scripts/plan-lint.test.ts:382`,
`skills/craft/scripts/craft-dispatch-loops.test.ts:176`), `CRAFT_GOAL_PRINT: '1'` at
`skills/craft/scripts/craft-dispatch.test.ts:88`, `CLAUDE_CODE_SESSION_ID: ''`
at `skills/craft/scripts/craft-goal-resend.test.ts:78`, `CRAFT_LOOP_POLL` and `CRAFT_NO_SCOPE`,
`CRAFT_FARM: '/bin/false'`, `CRAFT_REDISPATCH_DRYRUN`, `PATH` and `FARM_OUT_CHILD` (three files each),
`CRAFT_SUITE_LINT_TIMEOUT: '2'` at `skills/craft/scripts/suite-lint-dispatch.test.ts:178`, and the
`GATE_STATUS`, `GATE_BLOCKED_TOOLS` and `GATE_REQUIRE_FIELDS` of the `scratch/` guard suites. A
dry-run switch has one meaningful value; the varying input is what the harness then feeds the script.

Two of these are worth calling out because they are the rule's own target shape, correctly handled by
the test. `skills/craft/scripts/compose-goal.test.ts:142` sets `CRAFT_GOAL_MAX_HOURS: '2'` once, and
the test directly above it exercises the unset default and asserts a different output
(`/480 minutes or more/` versus `/120 minutes or more/`). The key **is** varied — across presence and
absence, which the rule cannot count.
`scratch/python-suite-head/tests/phase_gate_guard_test.py:135` varies `GATE_REQUIRE_FIELDS` between
the module constant `FIELDS` and the literal `'codex_second_pass'`; only one of the two is a literal,
so the occurrence count is one.

## What a disputer should do

Every verdict above is anchored to a file and line. To contest one, open that line and answer the
rule's own question: would the assertion still pass if the behaviour it names were wrong? To contest
the totals, re-run the command in Method over the same tree and compare `counts` against the table —
`suite-lint-report.test.ts` performs exactly that comparison, and additionally re-executes the corpus
to confirm that every `path:line` cited in this document is a finding the tool really reports, so a
stale citation fails the suite rather than being believed. That assertion is not decorative: it has
now caught drift three separate times, twice from edits landing while the run was still in flight,
on documents whose prose was otherwise still accurate.
