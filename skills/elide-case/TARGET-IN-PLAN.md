# The page target moves from a flag into the interview and the plan

The per-reading page target was a `--target MIN-MAX` typed at the command line. An agent invented
`4-6`, ran the gate with it, and later ran with no flag at all. The flag now fails closed, but
failing closed only forces *some* number to be typed. The number now comes from the interview,
is recorded per reading in the plan, and is read from the plan by `check.sh`.

## 1. The SKILL.md wording

Phase 1's heading and opening sentence became three questions ("`## Phase 1 — CLARIFY: three
questions, asked with AskUserQuestion, never self-answered`" / "Ask exactly these three … record
every answer verbatim in the plan"), with this third question:

> 3. **What is the page target for each reading?** One MIN-MAX per reading, offered with **2-6 as the
>    default** option — the skill's established range — since a reading whose length he does not care
>    about takes the default. A lead case and a short blog post reasonably differ, which is why the
>    plan carries one target per row. When the request or the schedule already gives a target,
>    **pre-fill the options from it** rather than posing the question blind; nothing is inferred
>    silently, and nothing is typed at a command line.

The dated paragraph that declined the axis was rewritten in place, recording the reversal rather
than deleting the old decision:

> **Do not ask anything else.** On 2026-09-09 the instructor declined a passage he wants kept, and
> declined insertion point and length as an interview axis — then **reversed the length half the same
> day**: the per-reading page target is now question 3 above, set in the interview and enforced from
> the plan, because a number typed at the command line is a number an agent can invent. Insertion point
> and class number still come from the request, or off the schedule if the request omits them.

Two red-flag rows were added and one rewritten:

| About to | Do instead |
|---|---|
| Ask about a passage to keep, or about the insertion point | Both were declined; insertion point and class number come from the request or the schedule. The page target IS asked — question 3 |
| Type a `--target` on a real run, or invent a range to fit the excerpt | The target lives in the plan, per reading. With `--plan` the flag is ignored and said to be ignored; `--target` is the `--no-plan` fixture override |
| Leave a `## Readings In Scope` page target blank or `TBD` | The `--plan` leg FAILS naming the row. Ask question 3, or take the 2-6 default |

Also updated: the header line ("the three CLARIFY questions"), the Phase 2 bullet ("The first two
CLARIFY answers, quoted (the third is the `page target` column above)"), and the `compile-table`
task's own acceptance command, which no longer hardcodes `--target 2-6`.

## 2. The new plan-leg rule

`## Readings In Scope` is now enforced the way the three `## Doctrinal target` lines are. The
`--plan` leg FAILS when:

- the `## Readings In Scope` section is absent — *"no '## Readings In Scope' section — no reading has
  an approved page target"*;
- the section has no reading rows;
- a row has no page target — *"reading '<caption>' has no page target — the '## Readings In Scope'
  row must end in a MIN-MAX page target (2-6 is the default range)"*;
- a row's target is a placeholder (`TBD`, `TODO`, `N/A`, `none`, `<…>`, `[…]`) — same message;
- a row's target is not MIN-MAX — *"has an unusable page target … expected MIN-MAX, e.g. 2-6"*.

Each message names the offending row. The leg's PASS line now reports the count:
`LEG plan: PASS — both interview answers recorded in <plan>; 4 reading(s) with a page target;
1 non-court reading(s) declared`.

`check.sh` then maps each caption in the `.typ` to its plan row (whole-token contiguous-run match,
the same discipline the non-court bullets use) and writes an index→target file that
`check-addendum.py --targets` consumes; a caption matching **no** row, or **several**, fails the
addendum leg naming the reading rather than falling back to any number. Targets are per reading:
`check-addendum.py` measures reading *i* against row *i*'s own MIN-MAX.

## 3. Both given: the plan wins, loudly

With `--plan`, a `--target` (or `--no-target`) on the same command line is **ignored**, and the
ignoring is printed with the plan's values before the leg runs:

```
  IGNORED FLAG — --target 1-1 was given alongside --plan and is IGNORED; the plan supplies each reading's page target:
    2-2  SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.
    3-5  SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.
```

Silently preferring either one is how this class of bug returns. `--target MIN-MAX` is now an
override for `--no-plan` runs (fixtures, dev) only, and there it keeps its fail-closed pair: on a
`--no-plan` run, naming neither `--target` nor `--no-target` is still a FAIL naming the missing flag,
`--no-target` still prints `NOBODY IS CHECKING PER-READING LENGTH`, and the summary line still never
claims length holds when nothing measured it (`LEG addendum: PASS — arity and table page ranges hold;
per-reading length NOT CHECKED`). When targets come from the plan the PASS line says so:
`LEG addendum: PASS — arity, table page ranges and per-reading length (targets from the plan) all hold`.

## 4. Tests — before and after

Five new tests in `scripts/check.test.ts`, plus one disclosed regression guard. The suite stays
hermetic: every fixture is still built from `fixtures/`, and nothing reads the live course repo.

**BEFORE** — the four scripts reverted to their pre-change form in a scratch copy
(`/tmp/elide-baseline`, same fixtures, same new test file), then
`bun test -t "the page target comes from the plan"`:

```
(fail) check.sh > the page target comes from the plan > a Readings In Scope row with no page target FAILS the plan leg, naming the row [307.54ms]
(fail) check.sh > the page target comes from the plan > a placeholder page target FAILS the plan leg [312.48ms]
(fail) check.sh > the page target comes from the plan > a missing '## Readings In Scope' section FAILS the plan leg [309.17ms]
(fail) check.sh > the page target comes from the plan > each reading is measured against ITS OWN row's target [589.15ms]
(fail) check.sh > the page target comes from the plan > with a plan, an explicit --target is IGNORED and the plan's value is used [574.03ms]
 1 pass
 5 fail
```

**The one that passed before is `--no-plan --target still measures every reading against the flag`,
and it is a REGRESSION GUARD, not a fail-first test.** `--no-plan --target` has always worked; the
test pins that the override survived the move, and it could not have failed at baseline. It is
labelled as such in the test file. Requirement (d) is therefore satisfied by a guard, disclosed
here rather than presented as fail-first.

Requirement (b) — per-reading rather than global — is decided by non-overlapping targets: Life
Partners runs 2 pages and Mutual Benefits 4, and the plan gives them `2-2` and `6-8`. The failure is
`FAIL length: reading 2 (…MUTUAL BENEF…) is 4 page(s) at pp. 4--7; target is 6-8` with reading 1
unflagged. No single global range produces that pair: any range containing 2 cannot report "target is
6-8", and 6-8 itself would have flagged the 2-page reading. The same addendum passes when only the
second row is widened to `3-5`.

**AFTER** — `cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test`:

```
bun test v1.4.0 (34cbb9a40)

 49 pass
 0 fail
 222 expect() calls
Ran 49 tests across 2 files. [15.18s]
```

Existing tests were adjusted only where the new plan rule requires it: plans that must PASS the leg
(`plan-good`, `plan-unchecked`, the non-court-bullet plans) now carry a `## Readings In Scope`
table, added through a `scopeSection()` helper, and the `run()` helper no longer appends
`--no-target` when a `--plan` is given. No assertion was loosened.

## 5. The live gate run, verbatim

No `--target` flag, and nothing written under `/home/eh/areas/secreg` (no `--pdf`, so the compile
goes to a temp dir):

```
$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md
--- leg plan
LEG plan: PASS — both interview answers recorded in addendum-02.md; 4 reading(s) with a page target; 1 non-court reading(s) declared
--- leg compile
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
--- leg quotes
  reading 1/4 "SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA": PASS [declared] — verbatim against SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': §§ 77e(a) and (c). The SEC also alleges that Garlinghouse and Larsen aided and abetted Ripple's Section 5 violations.
        source gap begins: am compl 9 430 35 ecf no 46 the sec also alleges ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': Tcherepnin v. Knight, 389 U.S. 332, 336 (1967); Glen-Arden Commodities, Inc. v. Constantino, 493 F.2d 1027, 1034 (2d Cir. 1974).
        source gap begins: 88 s ct 548 19 l ed 2d 564 1967 glen arden ...
  reading 2/4 "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.": PASS [declared] — verbatim against SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt
  reading 3/4 "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.": PASS [declared] — verbatim against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.': Howey, 328 U.S. at 299, 66 S. Ct. at 1103; see also Tcherepnin v. Knight, 389 U.S. 332, 336, 88 S. Ct. 548, 553 (1967) ("[I]n searching for the meaning and scope of the word 'security' in the Act[s], form should be disregarded for substance and the emphasis should be on economic reality.").
        source gap begins: 19 l ed 2d 564 1967 i n searching for the meaning ...
  reading 4/4 "SEC v. Ripple: Everyone Loses": DECLARED-UNCHECKED [plan] — a CLS Blue Sky Blog post by the instructor, not a judicial opinion; there is no retrieved source text to verify it against.
LEG quotes: PASS — 3 of 4 reading(s) verified verbatim, 1 declared unchecked
--- leg addendum
  PASS arity: 4 table row(s) == 4 caption block(s)
  PASS table: all 4 stated page range(s) match the PDF
  PASS length: every one of 4 reading(s) is within its own page target

  Computed table rows (paste these):
    [7],
    [_SEC v. Ripple Labs, Inc._, 682 F. Supp. 3d 308 (S.D.N.Y. 2023) (insert at p. 157)],
    [pp. 2--7],
    [7],
    [_SEC v. Life Partners, Inc._, 87 F.3d 536 (D.C. Cir. 1996) (insert at p. 158)],
    [pp. 8--9],
    [7],
    [_SEC v. Mutual Benefits Corp._, 408 F.3d 737 (11th Cir. 2005) (insert at p. 158)],
    [pp. 10--13],
    [7],
    [Edwin Hu, _SEC v. Ripple: Everyone Loses_, CLS Blue Sky Blog (July 18, 2023)],
    [pp. 14--16],
LEG addendum: PASS — arity, table page ranges and per-reading length (targets from the plan) all hold
--- verdict
PASS: every leg passed
```

(The quotation marks in the two gap-warning lines are rendered as straight quotes here; the terminal
output carries the reporter's curly ones.)

## 6. SKILL.md's `mechanicalChecks` cmd

It no longer passes `--target 2-6` — that was exactly the both-given case:

```
cmd: "bash …/check.sh --addendum …/addenda/NN-addendum.typ --pdf …/output/addenda/NN-addendum.pdf --plan …/.claude/plans/<slug>.md"
```

## What was not done

- The skill is still untracked in git and still not installed as a plugin; nothing was committed.
- Nothing under `/home/eh/areas/secreg` was written — the live plan and addendum were read only.
- The `/tmp/elide-baseline` scratch copy used for the before-run is disposable and is not part of the
  skill.
