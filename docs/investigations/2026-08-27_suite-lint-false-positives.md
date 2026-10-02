# suite-lint false positives, measured against this repository

Issue 134's open question 4 asks for a number nobody has produced: how often does the suite lint fire
on a test that is not defective? A refusing gate that is wrong once costs a dispatch, so the gating
decision needs the false-positive count, not the raw count. This document is the measurement.

It does **not** recommend a threshold or a gating posture. That decision is explicitly out of scope
here; the deliverable is the number and enough method that someone who disagrees can re-run it or
argue with a specific row.

## Result

| rule id | cited findings | raw findings | false positives | true positives |
|---|---|---|---|---|
| positive-match-failure-vocabulary | 14 | 26 | 23 | 3 |
| single-distinct-literal | 10 | 208 | 191 | 17 |
| existence-only-artifact | 1 | 1 | 1 | 0 |
| injected-key-never-varied | 17 | 44 | 44 | 0 |

**The cited-findings column is the one this repository's suite pins, and the only one re-executed on
every run.** It counts, per rule, the distinct findings cited in that rule's own section below.
`suite-lint-report.test.ts` re-runs the lint and requires each citation to resolve to a finding the
tool reports under that rule, and the count of resolving citations to equal this column, so a cited
finding that stops firing or moves to another rule turns the suite red.

**A finding is cited as `path::test title`, never `path:line`.** The title is that of the innermost
test declaration enclosing the finding (`test`/`it`/`describe` in TypeScript, `def test_*`/`class
Test*` in Python), which suite-lint reports in each finding's `test` field; a finding outside any
test is cited as `path::<file scope>`. A line number moved whenever anything above it in the file was
edited, and line citations broke the suite three times on 2026-10-02; a title moves only when its
test is renamed or deleted. Several findings in one test, or at one file's scope, under one rule
share one citation, so the column counts citations, not findings. The previous pinned column, the
*audited corpus* (every finding in every cited file, 15 / 43 / 1 / 21), moved whenever a cited file
gained an unrelated finding, and was retired on 2026-10-02 for the same reason as the line numbers.

**Every citation below names a file THIS REPOSITORY TRACKS, and that is a requirement rather
than a coincidence.** The suite re-executes every citation, so a citation into a path that is present on some checkouts and absent on others made the suite pass
on the machine that happened to hold the file and fail in a fresh clone, a worktree, or CI. Two
classes of such path have been removed:

- **Gitignored.** A `phase_gate_guard_test.py` line under `scratch/python-suite-head/`, cited by
  `injected-key-never-varied`; it is gone, and the paragraph that rested on it is rewritten around a
  tracked example.
- **Inside a submodule.** A `skills/bmll/scripts/test_bmll_impact.py` line cited by
  `single-distinct-literal`. `skills/bmll` and `external/anthropic-skills` are submodules, so whether
  their contents exist is decided by `git submodule update --init` rather than by this repository:
  the filesystem walk reports 342 findings in a checkout that has run it and 210 in one that has not.
  That citation is gone.

`suite-lint-report.test.ts` now scopes every recomputation to `git ls-files` *without*
`--recurse-submodules`, which excludes both classes by one mechanism: a submodule is a single
mode-160000 gitlink entry, so nothing under it is tracked here, and a gitignored path is not tracked
either. The walker still lints `scratch/` and an initialized submodule when they are present, which
is why the raw column's snapshot below discusses `scratch/` — but nothing this document *cites*, and
therefore nothing the suite recomputes, depends on a file whose presence is a property of the
checkout.

**The raw column is a whole-repository snapshot, as of 2026-09-17, and is deliberately NOT pinned.**
It counts every suite file in the tree, so it moved every time this repo gained an unrelated test
file — three hand-corrections in a fortnight, each a commit editing a document to make a suite pass,
none of them evidence about the lint. What that column supports is the arithmetic below it
(`false positives + true positives = raw`, and `cited findings ≤ raw`), which the suite does check.
Recompute it with the Method command before quoting it; do not expect the figure printed here to
match a tree that has moved.

**The false-positive column is audited only where this note says so.** Those counts are the ones
this investigation reached in August, over the findings that existed then — so the newer findings
(`single-distinct-literal` and `positive-match-failure-vocabulary`) sit in the true-positive column
by arithmetic, NOT by judgement. Nobody has read them. Do not cite that column as evidence about
them.

Six more findings arrived on 2026-09-16 with the loop-tick, teardown, ds-waiver, until and
ds-schema tests — one `positive-match-failure-vocabulary`, five `single-distinct-literal`, none
audited, all in the true-positive column by arithmetic like the rest.

Two rows moved on 2026-09-15 when elide-case's strays leg was rewired to the canonical checkers,
and both were read:

- `positive-match-failure-vocabulary` lost one, 26 to 25, and it was a TRUE positive.
  `expect(out).toMatch(/SUB runt: (PASS|FAIL)/)` asked whether the sub-check ran and passed either
  way, so the rule was right. The replacement collects the sub-check names and asserts the set.
- `injected-key-never-varied` gained one, 43 to 44, and it is a FALSE positive, so the
  false-positive column moves with it. The suite injects `PATH` in one literal, which is what the
  rule measures; that literal shadows `typst-constraints` with a stub that refuses, and the test
  asserts the leg then reports each canonical checker as unmeasured. An implementation ignoring the
  injected `PATH` fails it.

`single-distinct-literal` lost two on 2026-09-16 when `tests/workflow_return_shape_test.py` was
deleted (a whole-repository movement, of the kind the raw column no longer pins) — a return-shape lint that globbed a `workflows/` directory removed when that script became
`skills/work/workflow.js`, so it scanned an empty set and returned 0. Both of its findings were READ
before the row moved, and both were FALSE positives: `text.find("\n", i)` and `mm.group(1)` are
scanner internals in a file the walker admitted on its `_test.py` name alone, not assertions whose
literal could have been varied. Raw 209 to 207, false positives 193 to 191, true positives unmoved.

Unparseable files: 0. Every file the walker reached was extracted; nothing was dropped
silently, and no count above is understated by a skipped file. (The file *total* the walker reaches
is tree-dependent — 139 tracked suites in a clean checkout, 274 in a working tree carrying
`scratch/` — which is why the count stated here is the unparseable one, the only one the suite
re-executes.)

Of the 261 findings this investigation audited in August, one survived inspection. The
2026-09-15 reading above adds one more false positive and no true positive, so that number
still stands; the twelve unaudited findings are not in it.

## Method

The tool was run over the whole repository from its root:

```
bun skills/work/scripts/suite-lint.ts --corpus /home/eh/projects/workflows
```

The same numbers are obtainable from the module API, which is what the accompanying suite
`skills/work/scripts/suite-lint-report.test.ts` does:

```
bun -e 'import {lintCorpus} from "./skills/work/scripts/suite-lint.ts"; console.log(lintCorpus(process.cwd()).counts)'
```

**Refreshed 2026-09-12.** Re-executed from scratch because the corpus moved: the craft dispatch and
gate suites were edited that day (`skills/work/scripts/work-dispatch-loops.test.ts` and
`skills/work/scripts/workflow.test.ts`), which shifted cited lines and changed three of the four raw
counts. Every number below comes from that run; its line citations became `path::test` on 2026-10-02.

**Sample.** The tree as of the 2026-09-12 refresh, with the working trees of the sessions then in
flight in place. 232 test files were linted, in both dialects, producing 261 findings across 127
files. Output is deterministic — sorted paths, no wall clock — so a
re-run over the same tree reproduces the counts exactly. If the tree has moved since, the raw counts
will move with it; recompute before disputing them. This measurement was taken last, after every
other task in the run had settled, precisely because the lint's own suites are inside the corpus and
every fixture they gain changes the totals.

**The counts moved while this run was in flight, and the mechanism is worth stating.** Earlier
versions of this document recorded 184, then 183, then 185 `single-distinct-literal` findings, and the
2026-09-12 refresh records 193. Every one of those numbers was correct when taken and all but the last
are wrong now, and none moved because a rule changed. The corpus
contains the lint's own suite, and `skills/work/scripts/suite-lint.test.ts` kept growing as task H1's
red gate demanded more of it. The two findings that account for the move to 185 are both in that file
and both name H1's work directly. `skills/work/scripts/suite-lint.test.ts::an UNANCHORED pattern is priced for the start-position scan it actually performs` flags
`isAffordablePair`, which is exported at `suite-lint.ts:564` and did not exist before H1, so no
earlier run could have reported it. `skills/work/scripts/suite-lint.test.ts::BUDGET, end to end: the unanchored bomb is bounded too` flags the
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
Of the 261 findings, 129 are in `scratch/`. Deduplicated to the working tree, the raw counts are
15 / 85 / 1 / 31 rather than 24 / 193 / 1 / 43. The table reports what the tool reports; the FP
verdicts below were reached on the distinct files and then carried to their copies, which are
byte-comparable at the cited lines.

**Classification procedure.** A finding is a **false positive** when the test it names is not
defective in the way the rule claims — that is, when the property the rule was written to detect
("the failure branch would still pass this assertion", "no input in this file distinguishes the two
behaviours", "nothing varies this key") is false of the actual file. The judgement is made by reading
the cited line and its surrounding test, not from the finding's own message. Every FP verdict below
names the mechanism that produced it, so a reader can check the claim against one line of source.

For `single-distinct-literal`, whose 193 findings are too many to quote individually, the procedure
was applied to all of them and the source was read in full for every finding whose flagged callee is
a project-local function rather than a host or standard-library one — `recordDispatch`, `amend`,
`run`, `carriedIds`, `withHook`, `hooksJson`, `runFarm`, `runProseAudit`, `_audit`, `uploadFile`,
`frontmatter_value`, `isAffordablePair` — plus `np.allclose`, `count` and `Error`. Those are the only
class where a true positive was plausible. The remaining findings flag a fixed parameter of a host or
standard-library callee, which is definitionally not the input under test.

## positive-match-failure-vocabulary

Raw 24, false positives 23, one true positive.

The one that survives is `skills/work/scripts/work-redispatch.test.ts::a run dir whose oldest archive is over 2h old triggers the self-eval early`:

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
`skills/work/scripts/converge-check.test.ts::a blocking sequence that clears to zero is CONVERGING` asserts `toContain('CONVERGING')` and is immediately
followed, on line 94, by `expect(r.stdout).not.toContain('NOT CONVERGING')`, which is precisely the
repair the rule wants. The rule reads assertions one at a time and has no notion of a neighbouring
assertion that neutralises the ambiguity, so a correctly written test scores the same as the
defective one above it.

**File-wide literal pooling across unrelated tests (22 findings).** The rule collects failure-
vocabulary literals from the whole file and matches any positive assertion against all of them, so a
fixture string defined for one test taints an assertion belonging to another that can never see it.
`skills/workflow-creator/scripts/wc-probe.test.ts::a registered hook whose body is missing is a finding` asserts `findings[0].detail` contains
`guard.ts`; the matched "failure" literal is a fixture at line 470 belonging to a different test
(`'Do NOT use guard.ts; it was deleted from the hook config.'`), which never reaches `detail`. The
same mechanism produces `skills/workflow-creator/scripts/wc-probe.test.ts::a broken absolute path under a known root is a finding`,
`skills/workflow-creator/scripts/wc-probe.test.ts::${CLAUDE_PLUGIN_ROOT} is still substituted and still checked`,
`skills/workflow-creator/scripts/wc-probe.test.ts::(a) the finding points at the line that names the runner` and
`skills/workflow-creator/scripts/wc-probe.test.ts::the dispatch marker is honoured vocabulary, not a P9 finding`; both
`skills/work/scripts/work-dispatch.test.ts::a plan with no work:dispatch block fails loudly rather than printing a hash` and
`skills/work/scripts/work-dispatch.test.ts::a block that is not valid JSON fails loudly rather than printing a hash`, whose matched literal is a malformed-plan fixture
about 150 lines away at line 702; `tests/public-extension-contract.test.ts::ships without ignored planning files as public contract authority`, where the assertion
is `toContain("specHash")` and the matched literal is a prose table cell at line 47 that happens to
contain the word; and the three cite-check findings, two in
`skills/cite-check/tests/cite-check.test.ts::marks NOT_IN_STORE for bibkeys whose import failed (timeout)`
and one in `skills/cite-check/tests/cite-check.test.ts::loads importedBibkeys from store state on reuse (failed imports stay NOT_IN_STORE)`, where the matched literal is the input draft
`'Success claim [@SuccessKey2024-aa]. Failure claim [@FailedKey2024-bb].'` at line 1133 and the
assertion is on the generated report. The nine `scratch/` copies of those three cite-check findings
inherit the same verdict.

Two of the 22 deserve a separate note because they are self-reference:
`skills/work/scripts/suite-lint.test.ts::fires: /saved/i matches "plan NOT SAVED to disk", so the failure branch passes the test` and
`skills/work/scripts/suite-lint-python.test.ts::fires: re.search(r"saved") matches the module's own "NOT SAVED" failure string` are flagged for the lint's **own**
`/saved/i`-versus-`'plan NOT SAVED to disk'` fixture, which those suites embed as a string literal in
order to prove the rule fires. Both cited lines are `expect(f.evidence).toMatch(/saved/i)` — the
assertion that checks the finding, condemned by the fixture that produced it. A lint that runs over
the repository will always flag the file that demonstrates it. The tests are correct; the finding is
not.

## single-distinct-literal

Raw 193, false positives 193, no true positives.

The rule's premise is that if every literal argument to a repeatedly-called function is the same
value, no input in the file distinguishes the behaviours the tests claim differ. On this corpus that
premise held in none of the 193 cases, for three reasons.

**The varying input is not a literal (the dominant case).**
`skills/work/scripts/work-amend.test.ts::applying collapses the work cell to ONE round marker and prints a unified diff` is `amend(f, '--apply')`, one of five calls passing the
same `'--apply'` (lines 127, 140, 155, 162, 202); that string is the mode under test and is constant
on purpose, while the discriminating input is `f`, a fixture built from `ACCRETED_TASK` in one test
and `ESCALATING_TASK` in another. Identically, `tests/farm-runner.test.ts::a relative --expect resolves against --cwd, not the caller cwd` calls `runFarm('out.md',
{ writeRelative: 'out.md' })` while the paired test six lines below at line 40 calls
`runFarm('out.md')` with no options — the whole point of the pair is the second argument, which the
rule does not count. `skills/work/scripts/work-pending.test.ts::is still pending when the OTHER root holds a dispatch of a different spec` is `'f'.repeat(64)`, one of two
calls passing the same `64` (lines 113, 240); that literal is only the width of a sha256 and is
constant on purpose, while the discriminating input is the run root the record lands in — `.work` at
line 113, `.craft` at line 240. The rule sees
literal arguments only, so any test that varies its input through a variable, a fixture builder, a
temp path or an options object reads as undistinguished.

The two findings this run added are the same shape, and they are worth naming because they are the
lint indicting the very tests that hardened it. `skills/work/scripts/suite-lint.test.ts::an UNANCHORED pattern is priced for the start-position scan it actually performs` flags
two `isAffordablePair('a*b', …)` calls, at lines 438 and 439, for sharing the pattern `'a*b'`. Holding
the pattern fixed is the entire experiment: the claim under test is that one unanchored pattern flips
from affordable to unaffordable as the subject grows, so the discriminating input is the numeric
second argument — 990,000 and 400,000, both expected `false`. Line 446, twenty lines below in the
neighbouring test, calls `isAffordablePair('a*b', n)` for `n` in 80, 200 and 1,000 and asserts `true`.
The file distinguishes the two behaviours about as loudly as a file can; it just does not do it
through a differing literal in the same argument position.

Two findings in `skills/grind/scripts/grind.test.ts` were read when that file entered the
investigation through the `existence-only-artifact` citation below. Both are the dominant shape.
`skills/grind/scripts/grind.test.ts::<file scope>` flags `readFileSync(journal, 'utf8')` for sharing `'utf8'`
across lines 58, 200 and 297; the encoding is not an input at all, and the varying argument is
`journal`, a per-test temp path. `skills/grind/scripts/grind.test.ts::exits 0 when the check goes green, having run exactly one iteration per red check` flags two `at(-1)` calls,
lines 103 and 153, for sharing `-1`: both read the LAST journal record, and the behaviour they
distinguish is `'done'` versus `'stalled'` in the assertion, not the index. Neither is defective;
neither moves the true-positive column.

**Variation by absence.** `tests/test_prose_audit.py::test_every_pattern_system_is_represented` anchors a group of nine `_audit("tics.md")`
calls; two of them, at lines 77 and 78, sit inside one test that calls `_audit("tics.md")` and
`_audit("tics.md", style="legal")` to prove the domain guide is gated by style. The fixture filename
is deliberately constant *so that* style is the only difference. The rule flags the constant and
misses that the variation is the presence of a second argument.
`skills/workflow-creator/scripts/wc-probe.test.ts::a registered hook whose body is missing is a finding` is the same shape and worse: its call group
(lines 416, 424, 470) is a defective/correct **pair**, the exact test structure the vendored doctrine
asks for, where the fixture hook command is held identical and the second fixture adds the missing
file. The rule penalises the control.

**The literal is an incidental constant of a host callee.** Across the corpus, 40 findings flag the
encoding argument of `readFileSync`, 15 the separator of `split`, 13 the index of a regex `group()`,
11 the argument of `replace`, 10 of `slice`, 8 each of `join` and `execFileSync`, and so on down
through `stringify`, `createHash`, `digest` and `sys.exit`. None of these is a value under test;
varying them would break the test rather than strengthen it.
`skills/cite-check/tests/cite-check.test.ts::creates store and imports files on first run (batch mode)` is the plainest case — nine `readFileSync(…, 'utf-8')`
calls, flagged for the encoding. `skills/work/scripts/suite-lint.test.ts::BUDGET, end to end: the unanchored bomb is bounded too` is the same thing at
the end of this run's own work: `execFileSync('bun', …)` at lines 462 and 486, the two out-of-process
budget tests, flagged for the name of the interpreter. Those two tests differ in the fixture file they
write — one unanchored pattern against a 400 KB literal, versus twenty guard-defeating patterns
against twenty literals — and in their kill deadlines, 10 s and 20 s. Neither difference is a literal
argument to `execFileSync`, and that is the general case: the two calls a finding pairs can
distinguish real behaviours while the literal they share distinguishes nothing.

A `skills/bmll/scripts/test_bmll_impact.py` line once illustrated that last point from the other
side. It is withdrawn, not replaced: `skills/bmll` is a submodule, so the finding exists only in a
checkout that initialized it, and no tracked file in the corpus was found to carry the same shape.
The `suite-lint.test.ts:462` reading above establishes the point without it.

## existence-only-artifact

Raw 1, false positives 1, no true positives.

The one finding is `skills/grind/scripts/grind.test.ts::reports the run after it finishes, reading only the journal`, and it is a false positive of a shape the
rule cannot currently distinguish. The line is

```
expect(existsSync(`${journal}.pid`)).toBe(false)
```

a NEGATIVE existence assertion: the test's claim, stated in the comment above it, is that the journal
is the only file the loop writes, so the `.pid` file must *not* exist. The rule's premise — an
artifact whose existence is checked while its contents are never asserted — presupposes an artifact
that is supposed to be there. Here there are no contents to assert, and asserting any would falsify
the test. The rule's own evidence string says as much: "is the only reference to `${journal}.pid` in
this file" is exactly what a correct absence assertion looks like. The repair the rule wants does not
exist. (The line immediately above it, `expect(stray.length).toBeGreaterThan(0)`, asserts the
contents of the artifact that *is* supposed to exist, which the rule does not flag.)

Its earlier finding was a different false positive: a read guard rather than an assertion, the last
field of a helper's return, where an `existsSync` chose `''` over throwing so that the failure would
surface at the assertion instead of in the fixture, while the artifact's *contents* were asserted
twice further down. There the rule scored an `existsSync` reference without noticing that the guarded
read flows into a variable the assertions consume. That file was `tests/goal-send-drain.test.ts`,
deleted 2026-09-17 with the `/goal` self-send transport it exercised, so the finding went with its
subject rather than being fixed.

This count has moved 0 → 1 → 0 → 1 across four refreshes without the rule changing once: what moved
each time was which files the corpus held. That is the case for pinning the AUDITED CORPUS rather
than the whole-tree total, which is what `suite-lint-report.test.ts` now does. Both findings the rule
has ever produced here were read, and both were false; on this corpus it has never been right.

## injected-key-never-varied

Raw 43, false positives 43, no true positives.

Three mechanisms, and the first is an extraction defect rather than a rule-design one.

**A ternary parsed as a key-value pair (8 findings).**
`skills/work/scripts/converge-check.test.ts::<file scope>` contains `verdict: r.blocking === 0 ? 'PASS' : 'FAIL'`
and is reported as the key `PASS` with the value `'FAIL'`. There is no such key. The same misparse
produces the `PASS: 'FAIL'` findings at `skills/work/scripts/work-dispatch-loops.test.ts::<file scope>`,
`skills/work/scripts/work-loop.test.ts::<file scope>` and `skills/work/scripts/work-result.test.ts::a claimed/observed disagreement says WHICH direction it went`, and
the `ACTIVE: "PROCESSING"` finding at `skills/cite-check/tests/gemini.test.ts::polls until file is ACTIVE before returning`
(`state: getCalls >= 2 ? "ACTIVE" : "PROCESSING"`) together with its three `scratch/` copies. The
gemini case is doubly wrong: that line exists precisely to vary the state across polls.

**Prose and comments read as configuration (4 findings).** `tests/agent-contract.test.mjs::<file scope>` is a
comment sentence, "THE DIRECTORY STATES THE SCOPE: `agents/` is auto-discovered…", reported as the key
`SCOPE`. `tests/bluebook-cites.test.ts::<file scope>` is a comment quoting a DOI, reported as `URL`.
`tests/test_prose_audit.py::<file scope>` is a fixture comment containing the word "CHANGED:". And
`skills/work/scripts/dev-lens-contract.test.ts::<file scope>` is a header comment explaining that the suite
deliberately does **not** read `git show HEAD:`, reported as the key `HEAD` — a finding produced by
the very sentence documenting the absence of the thing.

**Harness plumbing, correctly held constant (31 findings).** The remainder are environment keys a test
sets to configure its own harness rather than to exercise a branch: `CRAFT_DISPATCH_DRYRUN: '1'` (at
`skills/work/scripts/plan-lint.test.ts::<file scope>`,
`skills/work/scripts/work-dispatch-loops.test.ts::WORK_DISPATCH_DRYRUN still stops after the gates, even with --loops set`), `CRAFT_GOAL_PRINT: '1'` at
`skills/work/scripts/work-dispatch.test.ts::the goal names the round budget work actually enforces`, `CLAUDE_CODE_SESSION_ID: ''`
at `skills/work/scripts/work-goal-resend.test.ts::<file scope>`, `WORK_REDISPATCH_DRYRUN: '1'` and `WORK_NO_SCOPE: '1'` (both at
`skills/work/scripts/work-redispatch.test.ts::<file scope>`), `PATH` (four files) and `FARM_OUT_CHILD` (two),
`CRAFT_SUITE_LINT_TIMEOUT: '2'` at `skills/work/scripts/suite-lint-dispatch.test.ts::WORK_SUITE_LINT_TIMEOUT bounds the tier, and a timeout still exits 0`, and the
`GATE_STATUS`, `GATE_BLOCKED_TOOLS` and `GATE_REQUIRE_FIELDS` of the `scratch/` guard suites. A
dry-run switch has one meaningful value, and a scope opt-out has none at all; the varying input is what
the harness then feeds the script. `WORK_NO_SCOPE` joined on 2026-09-28 when that suite stopped
using the dry-run flag as its way of observing the committed round and began dispatching for real
against a stub farm, which needs it alongside `WORK_FARM` — one more key held constant for the same
reason as the rest, read and false like them. The estimate helper in
`tests/farm-runner.test.ts::<file scope>` adds three more: the task cap, the session cap and the
override opt-out (`FARM_TASK_BUDGET`, `FARM_SESSION_BUDGET`, `FARM_BUDGET_OVERRIDE`), all configuring
the stubbed runner rather than the behaviour under test; its session identity, once a fourth, is now
set in three literals and no longer fires.

One of these is worth calling out because it is the rule's own target shape, correctly handled by
the test. `skills/work/scripts/compose-goal.test.ts::WORK_GOAL_MAX_HOURS still settles a goal composed before the switch` sets `CRAFT_GOAL_MAX_HOURS: '2'` once, and
the test directly above it exercises the unset default and asserts a different output
(`/480 minutes or more/` versus `/120 minutes or more/`). The key **is** varied — across presence and
absence, which the rule cannot count.

A second example of the same shape used to sit here, and it is worth saying what happened to it
rather than deleting it silently. It cited `scratch/python-suite-head/tests/phase_gate_guard_test.py`
— a snapshot of an older tree under a gitignored directory — for a `GATE_REQUIRE_FIELDS` injection
varied between a module constant and a literal, where only the literal is counted. The mechanism is
real and is the same "variation the rule cannot count" as the `compose-goal` case above, but the
evidence was unverifiable anywhere but on the machine that held the snapshot, so it cannot stand as a
citation. No tracked file in this repository reproduces that exact shape, so the section rests on the
one tracked example rather than on an invented substitute.

## What a disputer should do

Every verdict above is anchored to a file and the test enclosing the finding; the Method command
prints each finding's `where` (file and line) beside its `test`. To contest one, open that line and answer the
rule's own question: would the assertion still pass if the behaviour it names were wrong? To contest
the totals, re-run the command in Method over the same tree; the raw column is a snapshot and will
have moved if the tree has.

What `suite-lint-report.test.ts` re-executes, and therefore what cannot silently rot, is narrower and
firmer than a whole-tree total: the cited-findings counts above, reproduced exactly; every
`path::test` cited in this document, confirmed to be a finding the tool really reports **under the
rule in whose section it is cited**; and the one true positive this investigation found by reading,
`skills/work/scripts/work-redispatch.test.ts::a run dir whose oldest archive is over 2h old triggers the self-eval early`, confirmed still to fire under
`positive-match-failure-vocabulary`. That re-execution is not decorative: it has caught drift three
separate times, twice from edits landing while a run was still in flight, on documents whose prose
was otherwise still accurate.
