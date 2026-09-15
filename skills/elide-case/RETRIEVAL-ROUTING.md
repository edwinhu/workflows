# Retrieval routing change — what changed, and what did not

Westlaw is now the first retrieval route in `elide-case`; the CourtListener/RECAP and CAP routes are
the fallback. Files touched are all inside
`/home/eh/projects/workflows/skills/elide-case/`. Nothing under `/home/eh/projects/workflows` or
`/home/eh/areas/secreg` was modified; secreg was read only.

## `references/retrieval.md`

- New opening section **"Route 1 — Westlaw, first and by default"**: to get a case, invoke the
  `workflows:westlaw` skill, which owns the export procedure and the `.westlaw.docx` /
  `.westlaw.txt` naming convention. The procedure is referenced by skill name and deliberately not
  duplicated. Records the measurement: Ripple 69 unverified sentences against OCR-corpus text vs 0
  against the Westlaw extraction; Mutual Benefits 0 misses against both.
- New **"Route 2 — the free corpora, when Westlaw cannot serve"**, one line each for the two
  conditions: Westlaw does not cover the case (→ RECAP docket-entry route, federal only), or no
  Westlaw credential is available (→ opinions corpus by citation, federal and state, falling back to
  RECAP). States that everything below that point is the fallback path.
- **"How to tell a clean source"** retitled *— a Route 2 step* and scoped explicitly: a
  `.westlaw.txt` is derived from the `.westlaw.docx` by the westlaw skill's extractor, so the
  reproduction check is re-running the script and there is nothing to adjudicate. Skip for a Westlaw
  source. The section's content (line counts, median line length, OCR tells, double-spacing, column
  handling, grep-both-files rule) is unchanged.
- **Gemini routing rule KEPT and reframed.** Reason 1 retitled "a Route 2 source that needs OCR is a
  Gemini job"; a sentence at the section head says Reason 1 arises only on Route 2 while Reason 2
  arises on either route, because the filter reacts to subject matter, not source. The "WHAT TO DO"
  paragraph now says to try Route 1 first — a Westlaw export ends the problem rather than correcting
  it — before the CAP scan/transcribe apparatus.
- **Content-filter failure/recovery section KEPT verbatim**, including the `--provider gemini`
  recovery and the partial-state recovery commands.
- Nothing was deleted from this file.

### One item in the brief that does not apply to this file — stated plainly

The brief asked me to scope "the three-tier source hierarchy (publisher-keyed text > scan plus
multimodal read corroborated by a second engine > OCR corpora)" and "the corrections-ledger
machinery (`.retrieved.txt` golden copy, `.corrections.tsv`, the read/glyph tiers, replay
verification)" to the fallback path, and not to delete it.

**None of that machinery exists in this copy of the skill.** I grepped the whole skill directory for
`corrections.tsv`, `retrieved.txt` and `tier`; the only hits are unrelated (Westlaw star-pagination
tests in `scripts/`). `references/retrieval.md` as I found it contains no tier hierarchy, no golden
copy, no corrections ledger and no replay verification. I therefore did not scope, move or delete
any of it — there was nothing there. What I did instead is scope the OCR-correction apparatus that
*is* present (the clean-source diagnosis and the CAP scan / Gemini transcription route) to Route 2,
which is the same intent applied to the text that exists. If that machinery lives in another copy of
the skill, this file was not it.

## `references/authenticity.md`

- The "What a match does and does not prove" subsection is now source-dependent, split into two
  bullets: against a publisher-keyed `.westlaw.txt` a `check-quotes.py` match **is** fidelity to the
  reporter and no page-image comparison is required; against an OCR corpus source it proves only
  fidelity to the file, with the Life Partners `'rue` / `Junctions` / `and .the` evidence retained
  and the eyeball-the-page-image requirement retained for that path.
- **Iron Law 1 (Authentic Text) and Iron Law 2 (Compile-Before-Table) are untouched**, as is the
  "Fidelity beyond verbatim matching" section.

## `references/verification.md`

- Leg 2's closing line now reads: a match proves fidelity to the file; against a publisher-keyed
  `.westlaw.txt` that is also fidelity to the reporter, against an OCR corpus source it is not.
  Everything else in the file is unchanged.

## `SKILL.md` — minimal, craft phases not restructured

- The `refs` table row for `retrieval.md` now names `workflows:westlaw` as the first route and
  describes the corpus routes as the fallback.
- The `retrieve` task's `work` string now says to retrieve through `workflows:westlaw` first, and to
  fall back to `scripts/fetch-opinion.sh` only when Westlaw lacks coverage or no credential is
  available; the 404/RECAP rule is retained, now marked as a fallback-path fact.
- The `retrieve` task's `acceptance` now accepts either artifact pair —
  `<name>.westlaw.docx` + `<name>.westlaw.txt`, or `<name>.pdf` + `<name>.txt`.
- No phase, wave, task graph, `mechanicalChecks`, `scoredChecks` or red-flag row was restructured.

## Verification

### Test suite — verbatim

```
$ cd /home/eh/projects/workflows/skills/elide-case/scripts && bun test
bun test v1.4.0 (34cbb9a40)

 36 pass
 0 fail
 156 expect() calls
Ran 36 tests across 2 files. [10.29s]
```

Same as the pre-edit baseline (36 pass, 0 fail).

### Gate — verbatim, read-only, after the edits

```
$ cd /home/eh/areas/secreg && bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh \
    --addendum addenda/02-addendum.typ --docs docs --plan .claude/plans/addendum-02.md
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
  reading 2/4 "SECURITIES AND EXCHANGE COMMISSION v. LIFE PARTNERS, INC.": PASS [derived] — verbatim against SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.txt
  reading 3/4 "SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.": PASS [derived] — verbatim against SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.txt
    matched across a source gap (likely a footnote block) — verify:
      in 'SECURITIES AND EXCHANGE COMMISSION v. MUTUAL BENEFITS CORP.': If MBC underestimated the insureds’ life expectancy, the chances increased that the investors would realize less of a profit, or no profit at all.
        source gap begins: as judge wald pointed out in her life partners dissent i f ...
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
```

Exit code 0. Identical to the pre-edit baseline run, leg for leg.

## What I did not do

- Did not scope or preserve a three-tier hierarchy or a corrections ledger — neither exists in this
  skill; see the section above.
- Did not modify `references/editing-marks.md`, any script, any test, or any fixture.
- Did not modify `/home/eh/projects/workflows` or `/home/eh/areas/secreg`. `git status` in secreg
  shows modifications under `notes/`, `slides/` and `templates/` that predate this work and are not
  attributable to it; `addenda/` and `docs/` show no change.
- Did not add a test for the routing change. The routing lives entirely in context-loaded prose and
  the `retrieve` task's `work`/`acceptance` strings, none of which the test suite executes, so there
  is no exit code that could hold red then green for it.

---

## SUPERSEDED IN PART — 2026-09-10, the docx became the single source of truth

Everything above is left as written; it is the record of the 2026-09-09 routing change and
rewriting it would falsify what was measured then. One thing it says is no longer true.

**Where this file says the Westlaw route yields `.westlaw.docx` AND `.westlaw.txt`, and that the
`.txt` is what the elision reads, it is superseded.** The `.westlaw.docx` is now the only stored
source. Its text is a projection read IN MEMORY: `check-quotes.py` accepts the `.docx` directly and
projects it with `workflows:westlaw`'s own extractor, preserving italic runs as Typst emphasis
(`_..._`).

The `.txt` twin was not merely redundant, it was lossy. It discarded every italic run, and because
the cut read only the twin, a 27-page casebook excerpt reached a compiled reader with **every case
name in roman**. Persisting a derived copy is what made the loss invisible — the diff-the-extractor
reproduction check this file relied on compares the projection to itself and cannot see a field the
projection never carried.

Three things above still hold exactly as stated:

- **Route 2 keeps its PDF.** The CourtListener/RECAP fallback still saves `<name>.pdf` plus
  `<name>.txt`, and is how Tornetta II was obtained on 2026-09-10 with the Westlaw session expired.
  A court PDF has no formatting layer, so on that route italics are **unrecoverable**, not merely
  unchecked — the gate now prints an explicit ITALICS NOT CHECKED line per reading rather than
  passing silently.
- **A `.txt` remains fully resolvable.** Derivation, `// elide-source:` and an existing plan all
  still find one. The three secreg pairs and their addenda were re-run after this change and the
  verdict did not move.
- The OCR apparatus, the Gemini routing rule and the content-filter recovery are untouched.
