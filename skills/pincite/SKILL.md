---
name: pincite
description: "ALWAYS use when a law review manuscript's footnotes need page numbers, or when a page number already in one looks wrong — 'add pincites', 'pincite this draft', 'the editors want pin cites', 'my footnotes have no page cites', 'fill in the at-page for these cites', 'find the page that supports this claim', 'check my pincites', 'what page does this source say that'. STATUS: 'how many footnotes still need pincites', 'which cites are still missing page numbers', 'what's left to pincite', 'how many pin-cites are left'. WRONG PIN: 'the page number is wrong', 'this pin is off by a page', 'this pincite points at preprint pagination', 'why did this cite land on the wrong page'. Use proactively before any law review submission whose footnotes carry bare cites. NEGATIVE ROUTING: whether a PDF is the version of record, a preprint or proof, or the wrong document entirely is bib-manage — hand off rather than pinning against it, even mid-run; whether a cited source exists or says anything at all is source-verify; Bluebook FORM of a citation is bluebook or bluebook-audit; archiving URLs is permacc."
---

# Pincite

**What this skill carries** — grep `references/` for any subject the names below miss:
!`skill-toc ${CLAUDE_SKILL_DIR}`

Supplies the page number for each footnote in a law review manuscript, and then
**verifies it** — the model's own page number is never believed.

```
candidates  parse the .typ → a KIND per footnote, and for the `pdf` ones the claim
            they support plus the source PDF resolved through the BIBLIOGRAPHY
triage      per kind, what the author must actually do — including "nothing"
run         ask Gemini per candidate (Files API) for a page AND a verbatim quote
verify      re-find the quote in the PDF, derive the printed page from the
            document's own numbering, compare
report      the CONFIRMED pincites, ready to paste — plus a separate
            CONFLICTS section for rows that ALREADY carry a pin
```

## Kinds

Every footnote gets a `kind`. Classification runs on the footnote's own text
through one table at the top of `scripts/pincite.py` (`KIND_PATTERNS`, first
match wins) — except that **resolution succeeding beats every label**: a
footnote whose source is on disk is `pdf` whatever its prose looks like.

| kind | disposition |
|---|---|
| `pdf` | the Gemini pipeline — `run`, `verify`, `report` |
| `legislative` | hearings, GAO, CRS — fetchable from govinfo as a PDF, then re-run `candidates` |
| `case` | **out of scope**: needs Westlaw/Lexis STAR PAGINATION, which no PDF yields. Flag and stop |
| `book` | **stub**: needs a scan |
| `web` | nothing to fetch — the perma.cc link IS the pin; a paragraph cite only if the journal asks |
| `statute` | nothing to fetch — the section number IS the pin |
| `regulation` | nothing to fetch — the section or Fed. Reg. page IS the pin (a Fed. Reg. PDF in `--fedreg-dir` resolves and becomes `pdf`) |
| `short-form` | nothing here — inherits the parent cite's pin; `Id. at N` follows the preceding note |
| `none` | explanatory text or an internal cross-reference (`See infra Section II.B.`) |

**`none` and `short-form` are NOT gaps.** Neither is `web`, `statute` or
`regulation`. On the first manuscript those five kinds were 138 of 262
footnotes — more than half the document — and a tool that reports them as
missing pincites is reporting work that does not exist.

`triage` is the command that answers "what is left to do".

## Already pinned — two forms, three traps

A footnote can already carry a pincite in either of two shapes, and only one of
them says "at". `has_pincite()` in `scripts/pincite.py` covers both.

| form | example | pinned at |
|---|---|---|
| at-form | `Kahan & Rock, supra note 8, at 1279` | 1279 |
| journal-form | `51 Rev. Econ. Stud. 393, 394--99 (1984)` | 394–99 |
| journal-form | `68 Fed. Reg. 6585, 6587--88 (Feb. 7, 2003)` | 6587–88 |

The journal form is the STANDARD Bluebook shape — `<start page>, <pin page>`,
no marker word anywhere. Recognising only `at N` inflates the candidate set and
a bulk apply then **double-pins** footnotes that were already correct.

Detecting the journal form is harder than it looks, because a naive
`\d+,\s*\d+` also matches three things that are not pincites:

| trap | example | guard |
|---|---|---|
| thousands separator | `90 Fed. Reg. 58,503` reads as `58, 503` | a number with separators is ONE token, matched atomically; the pin separator is a comma plus WHITESPACE, which a thousands separator never has |
| release / order number | `Exec. Order No. 14,366`, `Release No.~89,372` | reject a pair preceded by `No.` / `No.~`; the pin must also be ≥ the start |
| date | `Mar. 23, 2024`, `(Feb.~9, 2018)` | reject a 4-digit second number in 1900–2030 |

Two further guards: the pin is never less than the start page, and the two must
be **close** (`PIN_MAX_GAP`, 1000) — numbers thousands apart are unrelated.
Never "fix" a miss by stripping commas globally: that is precisely what
manufactures the `58, 503` false pair the first guard exists to prevent.

`candidates` records the detected pin on the row (`pin`), because `cite` is
truncated at 300 characters and a Fed. Reg. pin can sit past the cut — on the
first manuscript two did.

All four stages read and write one state file (`--state`), so a rerun resumes
rather than re-uploading.

## CLI

```bash
P="${CLAUDE_SKILL_DIR}/scripts/pincite.py"

python3 "$P" candidates --root . --body paper/typst/opv-body.typ --state scratch/pincite.json
python3 "$P" triage    --root . --state scratch/pincite.json
python3 "$P" run       --root . --state scratch/pincite.json          # needs GOOGLE_API_KEY
python3 "$P" verify    --root . --state scratch/pincite.json
python3 "$P" report    --root . --state scratch/pincite.json
```

Every path is a flag, so the tool works on any manuscript: `--body`, `--bib`,
`--pdf-dir`, `--fedreg-dir`. `--bio-offset` (default 3) is how many leading
author-identification footnotes render as `*`, `†`, `‡` and take no Arabic
number — get it wrong and every reported footnote number is off by a constant.
`--only 12,40` and `--limit` scope a run; `--redo` re-asks footnotes already
answered.

`run` requires `GOOGLE_API_KEY`. So does `verify --vision-fallback`, which is
opt-in because it costs API calls — use it only on rows `verify` refuses with
"page numbering not readable".

The gate on the page-number derivation is a script, not a judgement:

```bash
python3 "${CLAUDE_SKILL_DIR}/tests/test_page_offset.py" [--corpus /path/to/repo] [--vision]
```

It asserts 11 measured offsets against real PDFs and exits non-zero on a real
failure; with no corpus it skips and exits 0. The fixtures are paywalled and are
not vendored here.

## Facts

- **"No local PDF" is not a gap — it is five different dispositions.** On the
  first manuscript that one bucket held **153 of 262** footnotes, and the
  largest group in it (`short-form`, 60) needs nothing at all. Classifying
  instead: 109 `pdf`, 60 `short-form`, 36 `none`, 21 `web`, 12 `statute`, 10
  `case`, 9 `regulation`, 4 `legislative`, 1 `book`. Of those, 138 need no
  action whatsoever.

- **Keep the `book` pattern narrow and keep it last.** A book cite's shape is
  `Author, Title Page (Year)` — a bare page against a parenthetical year — which
  is one token away from a journal cite's `Volume Reporter Page (Year)`. The
  pattern therefore requires the book shape AND the absence of any
  volume-reporter-page string. A misfire here sends a real article to the
  "needs a scan" pile, where nobody will ever look for it again.

- **`at N` is the minority pincite form, not the only one.** Matching only
  `\bat\s+\*?\d` missed **10 of 29** already-pinned footnotes on the first
  manuscript — every one of them a standard journal or Fed. Reg.
  `<start>, <pin>` cite. Three of the ten had also been asked and confirmed, and
  two of those three came back DISAGREEING with the pin already in the text
  (fn91 existing `2968--72` vs computed 2955; fn133 existing `850--52` vs
  computed 881). A bulk apply would have double-pinned all three and overwritten
  two author page choices with a machine's.

- **Never trust the model's page number.** It reports a page and a quote; only
  the quote can be checked mechanically. `verify` finds the quote in the PDF and
  then *derives* the printed page from the document's own numbering — the modal
  `printed − pdf_index` across every page, since one page's header cannot be
  told from a year or a footnote number. Accepting the reported page caught
  nothing; deriving it caught two real errors on the first manuscript.

- **The modal offset's own confidence cannot tell a thin-but-right answer from a
  thin-and-wrong one — the bib's start page can.** Measured on 11 OPV sources,
  fisch1994's correct offset held 15 votes of 42 (conf 0.36, refused) while
  choi2009's *garbage* offset of 23 held 2 of 56 — the same symptom, six hundred
  pages apart. Loosening the threshold trades one error for the other. Instead
  `page_offset` takes `pages = {...}` from the bib: under offset k the work's
  first printed page is k+1, so the cited start page must sit at pdf index
  `start − k`, a small number inside the front matter (`FRONT_MAX`, 12 — enough
  for a HeinOnline cover and for a bib filed at 1012 on a work that prints
  1009). fisch1994 puts it on pdf page 4; choi2009's 23 puts it on page 626 of a
  56-page PDF. Requiring two pages to agree (`MIN_CORROB_HITS`) is what makes it
  safe: a CONSTANT number repeated across pages yields a different k on every
  page and can never accumulate, so only a real folio counts twice. This route
  runs FIRST and promoted 3 more footnotes; corroboration is independent
  evidence, the vote count is not.

- **A dominant offset whose printed range does not contain the bib's start page
  is numbering a different version of the work.** hayne2019 is a working paper
  paginated −1–57, cited to *J. Acct. Res.* 57:969; the old gate confirmed "page
  6" — a wrong pincite, now refused. The one exception is real and narrow:
  Elsevier records an ARTICLE NUMBER in `pages` (`154 (2024) 103810`) and
  paginates the version of record 1–N, so a `pages` value over
  `ARTICLE_NUMBER_FLOOR` is treated as no start page at all. Without that
  exemption three correct pincites read as preprints.

- **Strip `[Vol. 82:649` before reading folios.** A verso running head carries
  the volume and the work's START page, and that trailing number is not this
  page's folio — left in, it mints a spurious candidate on every verso and, on
  fisch1994, was most of the runner-up mode that sank the real offset.

- **Vision is the LAST resort, and only for the offset.** When a scan has lost
  every folio from the text layer (choi2010: the best text offset held 1 vote of
  52) `--vision-fallback` renders two pages and reads the folios off the images.
  The numbers are still not believed: they must advance in lockstep with the pdf
  index AND the offset they imply must corroborate against the bib start. On
  choi2010 that returned 867 — matching the Hein cover arithmetic — and on
  choi2009 it independently reproduced the text route's 647.

- **Resolve footnote → source through the bibliography, never through PDF
  filenames.** Each bib entry carries `file = {...}`; the manuscript cites by
  citekey. Matching a footnote's prose against filenames sent **21 of 88**
  footnotes to the wrong source, and one of those verified CONFIRMED while
  pointing at the wrong paper — a false positive, which is worse than a miss.

- **A footnote is usually a string cite; the claim belongs to the source cited
  FIRST.** The rest are "see also" support. For a full cite carrying no citekey
  label, an author-surname match requires the entry's year within ~220
  characters of the name — a footnote-wide year test pairs one work's author
  with another work's date across a string cite.

- **A NO answer is usually MIS-RESOLUTION, not a bad citation.** Check which PDF
  the footnote resolved to (`pdf` in the state file) before reporting a citation
  error to the author. All three NOs on the first manuscript were the wrong
  file: a Calluzzo & Kedia claim had been handed Albuquerque, a Li, Maug &
  Schwartz-Ziv claim had been handed Malenko. Reporting them as citation errors
  would have sent three false corrections to coauthors while leaving eighteen
  wrong pincites in place. Reporting "your source doesn't support this" about a
  source the author never cited is worse than silence.

- **Quote matching must tolerate text injected INTO the quote.** Publisher
  watermarks are injected MID-SENTENCE into the text stream (`Downloaded from
  https://academic.oup.com/…`, `This content downloaded from … JSTOR`), so a
  real quote splits in half. Strip them, then score `coverage` — the sum of
  difflib matching blocks over the quote's length. Never fixed-width window
  similarity: it rejected **11 of 17** real quotes on the first run. Coverage
  tolerates insertion but not reordering, which is the right discrimination.
  Two cases are neither a hit nor a miss but "check by hand": a model page given
  as a span (`1231-1232`) compares on its first number, and a short EXCERPT of a
  book has no derivable numbering at all — that is not "quote not found".

- **Page numbers sit in running headers beside other text** (`2008]   THE
  HANGING CHADS OF CORPORATE VOTING   1279`) and run to **six digits**, so a
  bare-number-line regex finds nothing. `\d{1,4}` silently excludes Federal
  Register pages, which are five digits — the range test then reports every FR
  document as unpaginated.

- **Use Flash, not Pro.** gemini-batch measured Pro as the most CONSERVATIVE
  extractor — 47% detection vs Flash's 70% on identical documents. Here
  under-extraction is the *silent* failure: a missed pincite reads as "the
  source doesn't support it". A weaker quote is not silent — `verify` catches
  it.

- **A footnote citing Fed. Reg. pagination needs a Fed. Reg. page.** Fetch from
  govinfo's link service,
  `https://www.govinfo.gov/link/fr/<vol>/<page>?link-type=pdf`, into
  `--fedreg-dir` as `fedreg-<vol>-<page>.pdf`. The SEC's own release PDF of the
  same document has different pagination. federalregister.gov bot-blocks.
  Pre-2000 volumes return the whole issue (200+ MB) — trim with `qpdf`.

- **A preprint gives the WRONG page, and so can the publisher's own PDF.** Check
  the PDF's derived page range against the bib's published start page. Two
  exceptions produced false alarms: Elsevier article-number journals (`154
  (2024) 103810`) are paginated 1–N and ARE the version of record; and a
  publisher endpoint can serve an ADVANCE-ACCESS PROOF — OUP returned `v 00 n 0
  2021`, internal name `RFS-OP-…tex`, pages 1–49 instead of 5581+, authenticated
  and still useless for a pincite. Re-run the range check on anything fetched;
  a successful fetch never means the pagination problem is solved.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Bulk-apply `report` output | Its CONFLICTS section is footnotes that are ALREADY pinned, where the computed page can disagree with the author's own. A wrong pincite is worse than a missing one | Read CONFLICTS first and hand every disagreement to the author; paste only the clean list |
| Chase a pincite for every footnote without a PDF | A third of them need none — and `case` needs star pagination this tool cannot give | Run `triage` first |
| Paste the model's `page` into a footnote | It is unverified; two were wrong on the first manuscript | Run `verify`, paste only what `report` prints |
| Match a footnote to a PDF by filename | 21 of 88 went to the wrong source, one silently CONFIRMED | Resolve through `file = {...}` in the bib |
| Report "the source doesn't support this" on a NO | NO is usually mis-resolution | Read the row's `pdf` first |
| Switch `--model` to a Pro model for "better" answers | Pro under-extracts (47% vs 70%) and the failure is silent | Stay on Flash |
| Use the SEC release PDF for a `Fed. Reg.` cite | Different pagination from the one the cite uses | Fetch via govinfo `link/fr/<vol>/<page>` |
| Trust a page from a PDF paginated 1–N | Preprint — the published pages differ | Nothing: `page_offset` now checks the bib start itself (Elsevier article-number journals excepted) |
| Loosen the offset threshold to rescue a refused footnote | A weak-and-WRONG offset looks identical from inside the vote count; choi2009's garbage was 600 pages off | Corroborate against the bib's start page — and run `tests/test_page_offset.py`, which fails if 23 or 30 is ever accepted |
| Take a folio a vision read returns | It is one unverified number, the thing this tool exists to refuse | Two pages, advancing in lockstep, corroborated against the bib start — what `--vision-fallback` already does |
| Hand-edit the state file to "fix" a page | The next `candidates` re-parse drops answers whose PDF or claim changed, so the edit is silently lost or silently kept stale | Fix the resolution or the bib, then `--redo` |
