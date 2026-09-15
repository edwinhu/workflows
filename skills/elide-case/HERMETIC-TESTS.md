# Making `scripts/check.test.ts` hermetic

## The defect

`scripts/check.test.ts` line 12 held `const SRC_REPO = "/home/eh/areas/secreg"`, and `beforeAll`
read `addenda/02-addendum.typ` out of that live course repo, split it on `#pagebreak()`, and built
every temp-dir fixture from the resulting sections. `fixture()` also copied three `.txt` files out
of `secreg/docs/`.

That makes the suite a test of a coincidence between these scripts and whatever shape the user's
working file is in today. On 2026-09-09 he added three correct and deliberate
`// elide-source: <slug>.westlaw.txt` declaration lines to that addendum. The copy carried them into
each fixture, the fixture `docs/` dir held no `.westlaw.txt`, and nine tests went red with

```
reading 1/3 "...": FAIL [declared] — no source resolved in /home/eh/.tmp/elide-check-XXXX/shared/addenda/../docs (DECLARED-MISSING:SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt)
```

No script regressed. `grep -rn westlaw fixtures/ scripts/` found nothing, because the string only
ever entered the test through the copy — which is what made it invisible and why the coupling, not
the symptom, had to go. Every past green run of those nine tests carried the same weakness: the
user could as easily have made them green while the scripts were broken.

## What changed

The suite now reads only `fixtures/`. `SRC_TYP` points at a committed `fixtures/source-addendum.typ`
and `SRC_DOCS` at `fixtures/docs/`. No `.westlaw.txt` was added to the fixture `docs/` dir; the
declaration lines simply are not in the committed fixture, because the fixture carries its own
sources and does not need to declare them.

### `fixtures/source-addendum.typ` (new, 170 lines)

The suite's fixture *source*, standing in for the live addendum. `beforeAll` asserts it splits into
five parts on `#pagebreak()` (preamble + four readings) and `fixture()` asserts the preamble holds
exactly four table rows, so the file's shape is pinned by the tests that consume it.

| Part | Content | Why it is there |
|---|---|---|
| preamble | page setup, title block, a 4-row summary table with `[pp. N--M]` cells | feeds the **table-vs-PDF page check** and the **arity** leg; `calibrate()` rewrites the page cells from the compiled PDF, so the fixture table is truth rather than a guess |
| reading 1 | `SEC v. HOWEY PLACEHOLDER CO.`, one-line body | never `keep`-selected by any test; exists so the split yields five parts and the table has a fourth row |
| reading 2 | `SEC v. LIFE PARTNERS, INC.` — the D.C. Circuit excerpt, with an editors'-note line, 32 checkable sentences | the second arm of **multi-reading arity** (`keep: [2, 3]`); real court prose long enough that sentence extraction has work to do |
| reading 3 | `SEC v. MUTUAL BENEFITS CORP.` — the Eleventh Circuit excerpt, editors'-note block, block quote, retained footnote, 56 checkable sentences | the single-reading fixture (`keep: [3]`); carries the **editorial-block path** and the one sentence that **matches across a source gap** |
| reading 4 | `EDWIN HU, SEC V. RIPPLE: EVERYONE LOSES`, one-line body | never selected; the non-court fourth table row |

Readings 2 and 3 are the live addendum's own excerpts, copied once into the repo and now frozen
here — minus the `// elide-source:` lines, which named files the fixture does not ship. Readings 1
and 4 are one-line placeholders because no test ever selects them; padding them would be fixture
bulk with nothing asserting it.

### `fixtures/docs/SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt` (new, 32 lines / 16 KB)

Derived from the live `docs/` copy of the opinion, trimmed to the paragraphs reading 2 actually
quotes: the 1996 header and factual introduction (source lines 1–10), the transition sentence "We
turn next to the question whether the LPI contracts are properly characterized as securities"
(line 39), and the Part 3 efforts-of-others discussion through the holding (lines 57–75). Blank
lines mark the two omissions. 89 KB of opinion reduced to 16 KB, and `check-quotes.py` reports
`32 sentences checked, 0 not found`.

I trimmed to 30 lines first and one sentence missed — the "We turn next" transition. That was a real
gap in my excerpt, not a bad assertion: the sentence is genuine court text on line 39 of the
opinion. I added line 39 to the fixture source rather than deleting the sentence from the `.typ`.

### `fixtures/docs/SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt` (already committed)

Unchanged. 710 lines / 29 KB. Already the source for `fixtures/mini-addendum.typ`, and it already
produces the gap match the gap test requires.

### `DOC_FILES` narrowed from three files to two

`SEC-v-Terraform-Labs-...txt` was copied into every fixture and is no longer needed: the only test
naming a Terraform caption ("the caption list is derived from the .typ") asserts only that five
`reading i/5` lines print, which holds whether or not that caption resolves to a source. Dropping it
keeps `fixtures/docs/` to the two files something actually verifies against. The gap test's
`DOC_FILES[1]` is still Mutual Benefits.

### The guard comment

`check.test.ts` now opens with a comment naming `/home/eh/areas/secreg` literally and stating that
this is the only occurrence permitted under `scripts/` or `fixtures/`. That is deliberate: it makes
the scoped grep below return exactly one line, and that line is the rule.

## Before / after

| | tests | pass | fail |
|---|---|---|---|
| before | 40 | 31 | 9 |
| after | 40 | 40 | 0 |

The nine that were failing, from the baseline run:

1. a good addendum passes every leg and exits 0
2. every leg still runs when an earlier leg fails
3. two captions resolving to one source still get checked, and the sharing fails
4. an editors'-note block is not graded as court text
5. a reading the PLAN declares non-court prints DECLARED-UNCHECKED and does not fail
6. `--no-plan` waives the leg loudly and does not fail
7. an exact caption exempts that reading and only that reading
8. a gap-matched sentence surfaces its warning even when the reading PASSES
9. `--docs` points the resolver at an arbitrary directory

No assertion was weakened, loosened, deleted, or renamed. The only edits to `check.test.ts` are the
three constants at the top, the `DOC_FILES` list, and comments. Every `expect()` in the file is
byte-identical to the baseline, and the expect count rose from 159 to 170 — the eleven additions are
assertions that previously never executed because their test aborted at an earlier failure.

## Verification

### 1. `bun test`

```
$ cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test
bun test v1.4.0 (34cbb9a40)

 40 pass
 0 fail
 170 expect() calls
Ran 40 tests across 2 files. [10.14s]
```

### 2. Hermeticity

Scoped to the code, the single hit is the guard comment:

```
$ grep -rn 'areas/secreg\|SRC_REPO' scripts/ fixtures/
scripts/check.test.ts:6:// Do NOT reintroduce a path under /home/eh/areas/secreg (the live course repo): it is the
```

Rather than assert hermeticity, I measured it at the syscall layer — `strace` across the whole suite
and every process it forks:

```
$ strace -f -qq -e trace=openat,newfstatat,stat bun test 2>&1 | grep -c 'areas/secreg'
0
```

Zero filesystem syscalls, of any kind, touch the live course repo during a full run.

**The unscoped grep over the skill directory is NOT clean, and deliberately so.** It returns 19
lines, all in prose, none reachable by the test runner:

```
$ grep -rn 'areas/secreg\|SRC_REPO' /home/eh/projects/workflows/skills/elide-case/
STAR-FIX.md:9:Evidence, `/home/eh/areas/secreg/docs/SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt`
STAR-FIX.md:88:$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
STAR-FIX.md:159:Nothing else in the repo, and nothing in `~/areas/secreg` or `~/projects/workflows`.
RETRIEVAL-ROUTING.md:6:`/home/eh/areas/secreg` was modified; secreg was read only.
RETRIEVAL-ROUTING.md:95:$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
RETRIEVAL-ROUTING.md:146:- Did not modify `/home/eh/projects/workflows` or `/home/eh/areas/secreg`. `git status` in secreg
DIRECTIVE-FIX.md:16:Observed on `/home/eh/areas/secreg/addenda/02-addendum.typ` (read-only; not edited):
DIRECTIVE-FIX.md:107:Run read-only from `/home/eh/areas/secreg`:
DIRECTIVE-FIX.md:161:`scripts/check.sh` was not modified. `/home/eh/areas/secreg/addenda/02-addendum.typ` was
SKILL.md:198:  projectDir: "/home/eh/areas/secreg",          // the COURSE directory — the tree being edited
SKILL.md:212:      cmd: "bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh --addendum /home/eh/areas/secreg/addenda/NN-addendum.typ ...
SKILL.md:224:      acceptance: "Every `## Readings In Scope` row has its retrieved text on disk under /home/eh/areas/secreg/docs/ ...
SKILL.md:244:      acceptance: "python3 .../check-quotes.py /home/eh/areas/secreg/addenda/NN-addendum-<slug>.typ ...
SKILL.md:260:      acceptance: "python3 .../check-addendum.py /home/eh/areas/secreg/addenda/NN-addendum.typ ...
GATE-FIXES.md:10:`/home/eh/areas/secreg` was read only; `git status` there shows no change to `addenda/` or
GATE-FIXES.md:34:On `/home/eh/areas/secreg/addenda/02-addendum.typ`, Ripple reading, against
GATE-FIXES.md:210:the brief forbids editing anything under `/home/eh/areas/secreg`.
GATE-FIXES.md:244:$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
GATE-FIXES.md:283:- Did not edit anything under `/home/eh/areas/secreg`, including the `// elide-source:` line that
```

Those split two ways and neither should be removed. `STAR-FIX.md`, `RETRIEVAL-ROUTING.md`,
`DIRECTIVE-FIX.md` and `GATE-FIXES.md` are historical deliverable reports whose verbatim command
blocks are their evidence; editing them would falsify a record. `SKILL.md` lines 198–260 are the
workflow's own configuration, where the course repo is the correct target — the real gate is
*supposed* to run against the user's live addendum. Hermeticity is a property of the test suite, not
of the skill's documentation, so the measurement that settles it is the scoped grep and the
`strace` count above.

### 3. The real gate, unaffected

```
$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md
--- leg plan
LEG plan: PASS — both interview answers recorded in addendum-02.md; 1 non-court reading(s) declared
--- leg compile
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
--- leg quotes
  reading 1/4 "SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA": PASS [declared] — verbatim against SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': §§ 77e(a) and (c). The SEC also alleges that Garlinghouse and Larsen aided and abetted Ripple’s Section 5 violations.
        source gap begins: am compl 9 430 35 ecf no 46 the sec also alleges ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': Tcherepnin v. Knight, 389 U.S. 332, 336 (1967); Glen-Arden Commodities, Inc. v. Constantino, 493 F.2d 1027, 1034 (2d Cir. 1974).
        source gap begins: 88 s ct 548 19 l ed 2d 564 1967 glen arden ...
      in 'SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA': In its opposition papers, the SEC pivots and argues instead that the Other Distributions were an indirect public offering because “the parties that received XRP from Ripple, such as an ‘[Xpring] recipient,’ could ‘transfer their XRP (in exchange for units of another currency, goods, or services) to another holder.’” In any event, the SEC does not develop the argument that these secondary market sales were offers or sales of investment contracts, particularly where the payment of money for these XRP sales never traced back to Ripple, and the Court cannot make such a finding.
        source gap begins: sec opp at 26 citation omitted but the sec does not elsewhere ...
  reading 2/4 "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.": PASS [declared] — verbatim against SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.txt
  reading 3/4 "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.": PASS [declared] — verbatim against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.westlaw.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.': Howey, 328 U.S. at 299, 66 S. Ct. at 1103; see also Tcherepnin v. Knight, 389 U.S. 332, 336, 88 S. Ct. 548, 553 (1967) (“[I]n searching for the meaning and scope of the word ‘security’ in the Act[s], form should be disregarded for substance and the emphasis should be on economic reality.”).
        source gap begins: 19 l ed 2d 564 1967 i n searching for the meaning ...
  reading 4/4 "SEC v. Ripple: Everyone Loses": DECLARED-UNCHECKED [plan] — a CLS Blue Sky Blog post by the instructor, not a judicial opinion; there is no retrieved source text to verify it against.
LEG quotes: PASS — 3 of 4 reading(s) verified verbatim, 1 declared unchecked
--- leg addendum
  PASS arity: 4 table row(s) == 4 caption block(s)
  PASS table: all 4 stated page range(s) match the PDF

  Computed table rows (paste these):
    [7],
    [_SEC v. Ripple Labs, Inc._, 682 F. Supp. 3d 308 (S.D.N.Y. 2023) (insert at p. 157)],
    [pp. 2--9],
    [7],
    [_SEC v. Life Partners, Inc._, 87 F.3d 536 (D.C. Cir. 1996) (insert at p. 158)],
    [pp. 10--11],
    [7],
    [_SEC v. Mutual Benefits Corp._, 408 F.3d 737 (11th Cir. 2005) (insert at p. 158)],
    [pp. 12--15],
    [7],
    [Edwin Hu, _SEC v. Ripple: Everyone Loses_, CLS Blue Sky Blog (July 18, 2023)],
    [pp. 16--18],
LEG addendum: PASS — arity, table page ranges and length all hold
--- verdict
PASS: every leg passed
EXIT=0
```

All three `// elide-source:` declarations resolve and pass, which is the point: the markers are
correct, the gate agrees, and they were never the bug.

## Tests I could not make hermetic

None. All 40 are hermetic and all 40 pass with their assertions intact.

One test is worth naming because it was the hardest to keep honest. The gap test
("a gap-matched sentence surfaces its warning even when the reading PASSES") is only meaningful if
the fixture source genuinely produces a gap match *and* exits 0 — it asserts both, so a fixture that
quietly stopped producing a gap would fail rather than vacuously pass. The committed Mutual Benefits
excerpt and its committed source still produce it:

```
$ python3 scripts/check-quotes.py fixtures/mini-addendum.typ fixtures/docs/SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt --skip-editorial
matched across a source gap (likely a footnote block) — verify:
  in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.': If MBC underestimated the insureds’ life expectancy, the chances increased that the investors would realize less of a profit, or no profit at all.
    source gap begins: as judge wald pointed out in her life partners dissent i f ...

56 sentences checked, 0 not found
RC=0
```

## What I did not do

- No file under `/home/eh/areas/secreg` was written. `git status` there after my run shows only the
  user's own pre-existing modifications and untracked files; `addenda/02-addendum.typ` is untouched
  and its three `// elide-source:` lines are exactly as he left them.
- Nothing under `/home/eh/projects/workflows` was touched.
- I did not add a `.westlaw.txt` to the fixture `docs/` dir. That would have restored green while
  leaving the coupling, and the next edit to his addendum would break it again.
- `check.sh`, `check-quotes.py`, `check-addendum.py` and `check-quotes.test.ts` are unmodified. The
  defect was in the test's fixture source, not in any script, so no script needed a change.
- Pre-existing TypeScript diagnostics in `check.test.ts` ("Cannot find module 'bun:test'",
  "Property 'dir' does not exist on type 'ImportMeta'") are unresolved. They predate this work, come
  from there being no `tsconfig.json` or `bun-types` in `scripts/`, and do not affect `bun test`. I
  left them alone rather than expand scope.
