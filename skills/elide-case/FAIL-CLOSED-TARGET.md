# The length check now fails closed

`scripts/check.sh`'s addendum leg used to run `check-addendum.py` without `--target` whenever
the flag was absent. `check-addendum.py` then measured no reading at all, while the leg still
printed:

```
LEG addendum: PASS — arity, table page ranges and length all hold
```

That line asserted a check nothing ran. This is the defect the plan leg already fixed once
(header comment, lines 14–22 of the old file); the same treatment is now applied to `--target`.

## The change

`scripts/check.sh` and `scripts/check.test.ts` only, plus the two callers and two doc passages
listed below.

1. **`--target MIN-MAX` or `--no-target` is now a required decision.** Passing neither is a
   FAIL naming both flags:

   ```
     LENGTH NOT CHECKED — neither --target MIN-MAX nor --no-target was given; the length check is enforced by nothing
     pass --target MIN-MAX to check each reading's length, or --no-target to check arity and the table alone
   LEG addendum: FAIL — arity or the table was rejected, or neither --target nor --no-target was given
   ```

2. **`--no-target` is the deliberate escape**, mirroring `--no-plan`: a loud NOT CHECKED line
   naming what is unmeasured, and no failure.

   ```
     LENGTH NOT CHECKED — --no-target was given; NOBODY IS CHECKING PER-READING LENGTH
     arity and the table were still checked; how many pages each reading runs to is unverified
   LEG addendum: PASS — arity and table page ranges hold; per-reading length NOT CHECKED
   ```

3. **`--target` and `--no-target` together are contradictory** and FAIL, as `--plan` /
   `--no-plan` do.

4. **The summary line states what was checked.** "and length all hold" is printed only when a
   target was measured. This is the part of the defect the exit code alone does not fix.

5. Arity and the table still run in every branch, including the missing-flag FAIL — the
   missing decision costs one check, not the whole leg.

6. The header comment gained a paragraph ("THE LENGTH CHECK FAILS CLOSED THE SAME WAY"),
   written to sit beside the plan paragraph as one rule applied twice; the usage line now reads
   `(--plan <md> | --no-plan) (--target MIN-MAX | --no-target)`.

### Callers updated

Grepped `check.sh` across the skill.

| caller | state |
|---|---|
| `SKILL.md:212` `mechanicalChecks.cmd` | **verified, already passes `--target 2-6`** — no edit needed |
| `SKILL.md` comment above `mechanicalChecks` | extended to state the length fail-closed rule |
| `scripts/check.test.ts` `run()` helper | now appends `--no-target` when the caller named neither target flag, exactly as it does for `--no-plan` |
| `check.test.ts` "--no-plan waives the leg loudly" (`runRaw`) | `--no-target` added — it asserts exit 0 and would otherwise break |
| `check.test.ts` "--plan and --no-plan together" (`runRaw`) | `--no-target` added |
| `references/verification.md` | usage block and Leg 3 section updated |
| `STAR-FIX.md`, `RETRIEVAL-ROUTING.md`, `GATE-FIXES.md`, `DIRECTIVE-FIX.md`, `HERMETIC-TESTS.md` | **not edited** — these are records of past runs, and rewriting a pasted transcript would misreport what those runs actually printed |

All other `runRaw` call sites already pass `--target` or assert a non-zero exit for another
reason.

## Tests

Three added, in `describe("the length check fails closed")`.

### Before the change (check.sh reverted to its pre-change text)

```
$ bun test check.test.ts -t "fails closed"
bun test v1.4.0 (34cbb9a40)

check.test.ts:
491 |   // check enforced by nothing, and a summary line claiming it holds is worse than the skip.
492 |   describe("the length check fails closed", () => {
493 |     test("naming neither --target nor --no-target FAILS and names the missing flag", () => {
494 |       const typ = fixture("target-absent", [3]);
495 |       const { code, out } = runRaw(["--addendum", typ, "--no-plan"]);
496 |       expect(legs(out).addendum).toBe("FAIL");
                                       ^
error: expect(received).toBe(expected)

Expected: "FAIL"
Received: "PASS"

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check.test.ts:496:34)
(fail) check.sh > the length check fails closed > naming neither --target nor --no-target FAILS and names the missing flag [489.69ms]
502 |
503 |     test("--no-target waives the length check loudly and does not claim it holds", () => {
504 |       // An otherwise-clean addendum, so a non-zero exit could only come from this decision.
505 |       const typ = fixture("target-waived", [3]);
506 |       const { code, out } = runRaw(["--addendum", typ, "--no-plan", "--no-target"]);
507 |       expect(out).toContain("LENGTH NOT CHECKED");
                        ^
error: expect(received).toContain(expected)

Expected to contain: "LENGTH NOT CHECKED"
Received: "FAIL setup: unknown argument --no-target\n"

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check.test.ts:507:19)
(fail) check.sh > the length check fails closed > --no-target waives the length check loudly and does not claim it holds [203.78ms]

 1 pass
 29 filtered out
 2 fail
 8 expect() calls
Ran 3 tests across 1 file. [1022.00ms]
```

**Disclosure — test (c) did not fail before the change, and could not have.** Test (c) passes
an explicit `--target 2-6` on a too-long reading, and the old script already ran the length
check whenever `--target` was given; the bug was only in the flagless path. It is a regression
guard for the behavior the defect report measured, not a fail-first test. That is the "1 pass"
in the run above. The two tests that do bisect the change, (a) and (b), failed as shown.

### After the change — full suite

```
$ cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test
bun test v1.4.0 (34cbb9a40)

 43 pass
 0 fail
 187 expect() calls
Ran 43 tests across 2 files. [11.56s]
```

## Gate run on the live addendum (read-only)

```
$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh --addendum addenda/02-addendum.typ --docs docs --target 2-6 --plan .claude/plans/addendum-02.md
--- leg plan
LEG plan: PASS — both interview answers recorded in addendum-02.md; 1 non-court reading(s) declared
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
  PASS length: every reading is within 2-6 pages

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
LEG addendum: PASS — arity, table page ranges and length all hold
--- verdict
PASS: every leg passed
```

**Reading 1 did NOT fail on length, contrary to the expectation in the brief.** It now runs
pp. 2--7 — six pages, inside the 2-6 target — not the eight pages measured earlier today. The
excerpt was evidently shortened between that measurement and this run. Nothing was changed in
`addenda/` or `docs/` by this task; the run above is read-only and the file was not touched.

## The other silent-skip audit

Every remaining flag in `check.sh` was examined for the same shape (absence drops a check while
the summary still asserts it).

| flag | verdict |
|---|---|
| `--pdf` | **not the shape.** Absence only chooses a temp output path; the compile leg and every PDF-derived check run either way. |
| `--docs` | **near-miss, not the shape, and NOT fixed here.** Absence falls back to `<addendum>/docs` or `../docs`. If that guess is wrong the sources do not resolve, and a reading with no source is a `NOSOURCE` FAIL naming the reading — a loud wrong answer, never a skipped check with a summary claiming otherwise. Worth knowing about, but it does not certify anything unmeasured. |
| `--plan` / `--no-plan` | already fails closed. |
| `--target` / `--no-target` | fixed by this change. |

**No other flag in `check.sh` has the defect.** Per the brief, the `--docs` observation is
reported and not acted on.

## What was not done

- No historical deliverable (`GATE-FIXES.md`, `STAR-FIX.md`, `RETRIEVAL-ROUTING.md`,
  `DIRECTIVE-FIX.md`, `HERMETIC-TESTS.md`) was edited; their pasted `check.sh` invocations are
  transcripts of past runs.
- `check-addendum.py` is unchanged: `--target` remains optional there, and the requirement is
  enforced by `check.sh`, which is the single entry point the gate uses.
- No dependency on `/home/eh/areas/secreg` was introduced into `scripts/` or `fixtures/`; the
  new tests build their fixtures from `fixtures/` like every other test.
