# Gate fixes: elide-case check scripts

Three reported defects. **Two were real and are fixed. One (Defect 2) was not a defect** — the
feature was already implemented and already tested. Details and evidence below.

Baseline before any edit: `bun test` in `scripts/` → **32 pass, 0 fail**.
After the work: **36 pass, 0 fail** (4 tests added).

Nothing outside `/home/eh/projects/workflows/skills/elide-case/` was modified.
`/home/eh/areas/secreg` was read only; `git status` there shows no change to `addenda/` or
`docs/` attributable to this work.

---

## Defect 1 — check.sh never passed `--skip-editorial` — REAL, FIXED

### What I changed

`scripts/check.sh`, the per-reading invocation in the quotes leg:

```bash
    # --skip-editorial: an editors' note is authored commentary, never a quotation, so
    # grading it against the reporter reports the editor's own prose as missing court text.
    q_out="$(python3 "$SCRIPTS_DIR/check-quotes.py" "$ADDENDUM" "$src" --caption "$caption" --skip-editorial 2>&1)"
```

`check-quotes.py` already had the flag and a working `drop_editorial_blocks()`; only the caller
was missing it. This is not a loosening of the fidelity check — an editors' note is authored
commentary and can never be a quotation, so grading it against the reporter is a category error,
not a check.

### Measurement that confirmed the defect

On `/home/eh/areas/secreg/addenda/02-addendum.typ`, Ripple reading, against
`docs/SEC-v-Ripple-874-opinion.txt`:

```
without --skip-editorial:  136 sentences checked, 15 not found
with    --skip-editorial:  128 sentences checked, 7 not found
```

8 of the 15 reported misses were the editor's own prose, exactly as reported.

### Test added

`scripts/check.test.ts` → `"an editors'-note block is not graded as court text"`. It appends a
`#text(10pt)[ ... *[Editors' note --- ...]* ... ]` block carrying two sentences that appear in no
reporter to the body of an otherwise-verbatim reading, then asserts the quotes leg passes and the
editorial sentence is never echoed as a MISS.

### Verbatim output — BEFORE the fix (fails)

```
239 |     const { out } = run(["--addendum", typ]);
240 |     expect(out).not.toContain("This paragraph is the editor's own commentary");
                          ^
error: expect(received).not.toContain(expected)

Expected to not contain: "This paragraph is the editor's own commentary"
Received: "--- leg plan\nLEG plan: NOT CHECKED — --no-plan was given; NOBODY IS CHECKING THE INTERVIEW ANSWERS\n  this addendum was graded on its text alone; the doctrinal target it was cut for is unverified\n--- leg compile\nLEG compile: PASS — editorial.typ builds to editorial.pdf\n--- leg quotes\n  reading 1/1 \"SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.\": FAIL [derived] — against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt\n    MISS in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.':\n      typ: This paragraph is the editor's own commentary and appears nowhere in the reporter, which is precisely why grading it against the opinion is a category error.\n ... LEG quotes: FAIL — at least one of 1 reading(s) is not verified\n ..."

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check.test.ts:240:21)
(fail) check.sh > an editors'-note block is not graded as court text [287.05ms]
```

### AFTER the fix

Passes; see the full-suite output at the end (36 pass, 0 fail).

---

## Defect 2 — `// elide-source:` "has NO implementation" — NOT A DEFECT

**I did not fix this, because there was nothing broken to fix.** Reporting that plainly rather
than claiming a success I did not have.

The brief states "grep shows NO implementation of elide-source anywhere in the skill." That is
incorrect. It is implemented in `check.sh`'s own caption-resolver heredoc, and every property the
brief asks for already held before I touched anything:

| Required behaviour | Where it already lived | Verified |
|---|---|---|
| `// elide-source: <basename>` in the reading's block declares the source | `check.sh` resolver, `re.finditer(r"//\s*elide-(source\|unchecked):\s*([^\n]*)")`, attached to the following caption via `cap_offsets` | yes |
| resolved inside `--docs` | `cand = docs_dir / value` | yes |
| named file must exist or the leg FAILS naming it | `else: rows.append((cap, "", f"DECLARED-MISSING:{value}", "declared"))` → falls to check.sh's default case → `fail_quotes=1` | yes |
| output line says `[declared]` not `[derived]` | `mode` field is the literal `"declared"` | yes |
| derived-from-caption remains the fallback | the `scored`/`AMBIGUOUS`/`NOSOURCE` branch below it | yes |

A pre-existing test already pinned the happy path:
`check.test.ts` → `"a declared source overrides the heuristic and is reported as declared"`,
asserting `/reading 1\/1 "[^"]*": PASS \[declared\]/`. It was green in the 32-pass baseline.

The grep in the brief probably searched only `check-quotes.py`, or matched on a literal that the
resolver splits across an alternation group (`elide-(source|unchecked)`), which is why a plain
`grep 'elide-source'` over the scripts finds the comment and the test but not the code.

### What I did add

The one branch that genuinely had no test: the fabricate-a-pass guard.
`check.test.ts` → `"an elide-source naming a missing file FAILS and names the file"`, asserting
`DECLARED-MISSING:NO-SUCH-SOURCE.txt`, `reading 1/1 ...: FAIL [declared]`, and a non-zero exit.

**Disclosed honestly: this test passes both before and after my changes.** It cannot fail-then-pass
because the behavior it pins was already correct. It closes a coverage gap; it does not demonstrate
a fix, and I am not presenting it as one.

---

## Defect 3 — star-pagination markers not stripped — REAL GAP, FIXED, but the cited measurement does NOT reproduce

### What I changed

`scripts/check-quotes.py`, new page-furniture rule plus its application:

```python
# Westlaw star pagination, interleaved mid-sentence: "the vast *329 majority of". Anchored
# to an asterisk IMMEDIATELY followed by digits and then a non-digit, so an emphasis or
# footnote asterisk ("* * *", "see note *") keeps its meaning. One trailing space goes with
# it, since the marker sits between two words that are contiguous in the reporter.
STAR_PAGE = re.compile(r"\*\d+\b ?")
```

```python
def strip_furniture(text: str) -> str:
    text = text.replace("\f", "\n")
    text = ECF_HEADER.sub("", text)
    text = PAGE_NUMBER_LINE.sub("", text)
    # Before FOOTNOTE_MARKER: that rule would otherwise eat the digits of a 1-2 digit
    # star page and leave a bare asterisk behind.
    text = STAR_PAGE.sub("", text)
    text = FOOTNOTE_MARKER.sub("", text)
    return text
```

Ordering matters: `STAR_PAGE` must run before `FOOTNOTE_MARKER`, which would otherwise consume the
digits of a short star page (`*5`) and strand the asterisk. The module docstring was updated to
list star pagination among the furniture it strips.

The pattern is anchored to an asterisk immediately followed by digits and a word boundary, so
`* * *` separators, `see note *`, and `*word*` emphasis all survive — pinned by assertions in the
test below.

### Test added

`scripts/check-quotes.test.ts`, two tests:

- `"the furniture stripper eats Westlaw star pages but never an emphasis asterisk"` — calls
  `strip_furniture()` directly, asserting `*329`/`*738` are removed and `* * *`, `note *`,
  `*word*` are untouched.
- `"a sentence split by a star-page marker in the source is not reported as a miss"` — the
  brief's own example sentence, verbatim excerpt vs. a source carrying `*329` mid-sentence.

### Verbatim output — BEFORE the fix (both fail)

```
115 |   test("the furniture stripper eats Westlaw star pages but never an emphasis asterisk", () => {
116 |     expect(stripFurniture("the vast *329 majority of individuals")).toBe(
                                                                          ^
error: expect(received).toBe(expected)

Expected: "the vast majority of individuals"
Received: "the vast *329 majority of individuals"

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check-quotes.test.ts:116:69)
(fail) check-quotes.py > the furniture stripper eats Westlaw star pages but never an emphasis asterisk [22.73ms]
```

```
133 |     const { code, out } = run("starpage", reading("SEC v. RIPPLE LABS, INC.", excerpt), source);
134 |     expect(out).not.toContain("MISS");
                          ^
error: expect(received).not.toContain(expected)

Expected to not contain: "MISS"
Received: "MISS in 'SEC v. RIPPLE LABS, INC.':\n  typ: Therefore, the vast majority of individuals who purchased XRP did so with an expectation of profit derived from the efforts of Ripple and its agents.\n  matched source through: ...therefore the vast\n  diverges at: majority of individuals who purchased xrp did so with an expectation of\n\n1 sentences checked, 1 not found\n ..."

      at <anonymous> (/home/eh/projects/workflows/skills/elide-case/scripts/check-quotes.test.ts:134:21)
(fail) check-quotes.py > a sentence split by a star-page marker in the source is not reported as a miss [32.81ms]
```

### AFTER the fix

Both pass; see the full-suite output below.

### Correction to the brief's measurement — this did not reproduce

The brief states: "Measured: stripping `/\*[0-9]+ ?/` from the Ripple Westlaw text turned 3
reported misses into matches." **I could not reproduce that on any file in `secreg/docs/`.**
Disclosing rather than quietly adjusting:

- `docs/SEC-v-Ripple-874-opinion.txt` (the file the caption heuristic actually resolves to) is not
  a Westlaw export. It contains exactly three `*N` occurrences — `*5`, `*7`, `*9` — which read as
  footnote symbols, not star pages. Stripping them changed nothing:
  `128 sentences checked, 7 not found` both with and without the rule.
- `docs/SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt` is the genuine Westlaw export and does
  carry 22 star markers. But the Ripple reading scores `128 sentences checked, 0 not found`
  against it **both with and without** the star rule — no excerpted sentence happens to span a
  marker.

So the fix is correct and unit-tested against the exact shape the brief describes, but the
specific "3 misses became matches" number is not one I observed, and I am not asserting it.

### Incidental finding (reported, not acted on)

Reading 1 fails against the *derived* source `SEC-v-Ripple-874-opinion.txt` with 7 misses, yet
scores **0 misses against `SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.txt`**. That is a
source-*mapping* problem, not a fidelity problem: the caption heuristic is picking the wrong one of
two Ripple files. The intended remedy is a `// elide-source:` declaration in the `.typ` — the very
feature Defect 2 claimed was missing. I did **not** apply it, because that file is the user's and
the brief forbids editing anything under `/home/eh/areas/secreg`.

---

## Full suite — AFTER all changes (verbatim)

```
$ cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test
bun test v1.4.0 (34cbb9a40)

 36 pass
 0 fail
 156 expect() calls
Ran 36 tests across 2 files. [10.26s]
```

Full suite with the two source fixes temporarily reverted, showing all three new
fail-then-pass tests failing and nothing else regressing (verbatim tail):

```
 33 pass
 3 fail
 148 expect() calls
Ran 36 tests across 2 files. [10.28s]
```

The three failures were exactly the new Defect 1 and Defect 3 tests. The new Defect 2 test passed
in this reverted run too, which is the disclosure made above.

---

## End-to-end run — per-reading lines, verbatim

```
$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
    --addendum addenda/02-addendum.typ --docs docs --target 4-6 --no-plan
```

```
  reading 1/4 "SECURITIES AND EXCHANGE COMMISSION v. RIPPLE LABS, INC., BRA": FAIL [derived] — against SEC-v-Ripple-874-opinion.txt
  reading 2/4 "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.": PASS [derived] — verbatim against SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt
  reading 3/4 "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.": PASS [derived] — verbatim against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt
  reading 4/4 "SEC v. Ripple: Everyone Loses": FAIL [derived] — against SEC-v-Ripple-874-opinion.txt
```

Surrounding leg and verdict lines from the same run:

```
LEG plan: NOT CHECKED — --no-plan was given; NOBODY IS CHECKING THE INTERVIEW ANSWERS
LEG compile: PASS — 02-addendum.typ builds to 02-addendum.pdf
LEG quotes: FAIL — at least one of 4 reading(s) is not verified
LEG addendum: FAIL — check-addendum.py rejected the table, arity or length
FAIL: plan=NOT-CHECKED compile=PASS quotes=FAIL addendum=FAIL
```

### Reading the two remaining quotes failures

Both are conditions outside the three defects, and neither is something these fixes were meant to
clear:

- **Reading 1** — 7 residual misses (down from 15). As above, this is a source-mapping error: the
  same reading scores 0 misses against the Westlaw export. Fix is a `// elide-source:` line in the
  user's `.typ`, which I did not write.
- **Reading 4, "SEC v. Ripple: Everyone Loses"** — `51 sentences checked, 51 not found`. This is a
  blog post, not court text. By the skill's own design the instructor must declare it in the plan's
  `## Non-court readings` section; the run above passed `--no-plan`, so nothing declared it. This is
  the gate working as intended, not a bug.

The addendum leg's failure is likewise untouched by this work (table page ranges / length).

## What I did not do

- Did not fix Defect 2 — there was no defect; see above.
- Did not edit anything under `/home/eh/areas/secreg`, including the `// elide-source:` line that
  would clear reading 1.
- Did not make the end-to-end run pass. It still exits non-zero for the two reasons above, both
  outside the scope of the three defects.
- Did not touch `check-addendum.py`, `fetch-opinion.sh`, `SKILL.md`, or the fixtures.
