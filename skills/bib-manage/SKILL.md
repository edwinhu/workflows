---
name: bib-manage
description: "ALWAYS use when a manuscript's BIBLIOGRAPHY is the thing being fixed, or when a cite's PDF turns out to be wrong — 'link my bib entries to the PDFs', 'which sources am I missing a PDF for', 'audit my sources.bib', 'my bib entry has no file field', 'fetch the Federal Register PDFs', 'why can't pincite find this source'. WRONG FILE: 'is this PDF the published version or the preprint', 'this PDF is a book review, not the book', 'the file field points at the wrong paper', 'the PDF doesn't match the citation'. PAGE RANGES: 'does my bib have page ranges', 'my bib only has start pages', 'backfill the page ranges', 'pull the pages from the DOI', 'add DOIs to my bibliography'. Use proactively before any pincite run — pincite resolves footnotes through `file = {...}` and silently skips entries that lack one. NEGATIVE ROUTING: the page number inside a footnote is pincite, but whether that footnote's PDF is the version of record or the wrong document is THIS skill, mid-pincite-run included; whether a cited source says what the footnote claims is source-verify; Bluebook FORM is bluebook or bluebook-audit; finding or downloading a paper is fetch-paper or paperpile."
---

# Bib-manage

Owns the bibliography as an **index**: every entry pointing at the right PDF, and
that PDF being the version of record.

pincite CONSUMES this index — it resolves footnote → source through
`file = {...}` and through nothing else. So the two failures this skill exists to
prevent are both silent in pincite: an entry with no `file` is a pincite that is
never attempted, and an entry pointing at a preprint is a pincite that is
confidently wrong.

```
audit    entries with/without file, files missing on disk, entries without a
         DOI, PDFs no entry claims          <- run this first
link     citekey -> PDF, written back as file = {...}
version  is each entry's PDF the published version, or a preprint/proof?
doi      backfill missing DOIs from Crossref, verified against the bib's pages,
         and the PAGE RANGE that same verified record already carries
fedreg   fetch the Federal Register PDFs the entries cite
```

## CLI

```bash
B="${CLAUDE_SKILL_DIR}/scripts/bibman.py"

python3 "$B" audit   --root .                 # start here
python3 "$B" link    --root . --dry-run       # inspect the mapping first
python3 "$B" link    --root . --backup        # then write
python3 "$B" version --root .
python3 "$B" doi     --root . --dry-run --only aggarwal2015
python3 "$B" fedreg  --root . --dry-run
```

Every path is a flag — `--bib`, `--pdf-dir`, `--fedreg-dir` — defaulting to the
layout pincite uses, so the tool works on any manuscript. `--only` scopes
`version` and `doi` to named citekeys; `--dry-run` reports without writing;
`--backup` leaves a `.bak`; `--strict` makes `version` exit 1 on any entry that
is not the version of record.

`audit`, `link` and `version` never touch the network. `doi` and `fedreg` do.

## Facts

- **The link threshold depends on the YEAR, and that is the whole of its
  accuracy.** Two matchers run in order: PDF stem == citekey (48 of 79 on the
  test bibliography), then Paperpile-style `Author Year - Title.pdf` on
  first-author surname plus title similarity (the other 31). Same year, the year
  corroborates and **0.55** is enough. DIFFERENT year — a working paper against
  its published version, `Lund 2017` → `lund2018` — demand **≥ 0.95**, because
  only the title separates two papers by one author. At 0.55 with the year
  ignored, `alexander2010` ("Interim News and the Role of Proxy Voting Advice")
  claims the PDF "The role of advisory services in proxy voting" at **0.52**.
  That is a wrong `file` in the bib, which is the one input pincite trusts
  absolutely — a mis-link there sends a footnote to another paper and can verify
  CONFIRMED while doing it.

- **Never force a match; REPORT what stays unmapped.** On the test bibliography
  four PDFs stay unclaimed and every one is correct: `Alexander et al. 2009`
  (0.52), `Cremers and Romano 2011` whose filename is truncated mid-title by the
  filesystem (`...proxy voting on co ... ion plans...`, best match 0.89 against a
  2007 entry), and two whose filenames are not `Author Year - Title` at all. An
  unmapped PDF costs a minute of human attention. A forced one costs a wrong
  citation nobody looks at again.

- **Paperpile writes SURNAMES ONLY, so the first-author surname is the FIRST
  token.** `Barzuza et al.`, `Bebchuk and Hirst`, `Rock`. Taking the last token —
  the correct habit for a bibtex `author` field — reads "Barzuza et al." as an
  author named "al." and unmapped **14 of 83** PDFs here before it was caught.

- **A 6-digit `pages` is an Elsevier ARTICLE NUMBER, not a page.**
  `J. Fin. Econ. 154 (2024) 103810` is paginated 1–N in its own PDF and IS the
  version of record. Range-testing it reports every such entry as a preprint —
  `shu2024` and `cabezon2025` are both genuinely published and both false alarms
  without this exception.

- **A publisher's own PDF can be an ADVANCE-ACCESS PROOF.** OUP served
  `iliev2021` as pages 1–49 instead of 5581+, `v 00 n 0`, internal name
  `RFS-OP-….tex` — authenticated, current, and useless for a pincite. Flag when
  the range test fails AND page 1 carries no nonzero volume designation. A
  successful fetch never means the pagination problem is solved.

- **Do NOT identify the version of record by matching the journal name against
  page 1.** Bib journal names are Bluebook abbreviations ("Rev. Fin. Stud.")
  that never appear in a masthead ("The Review of Financial Studies"). That test
  flagged **46 of 61** entries and is worthless. The derived printed-page range
  against the bib's start page is the test that works: 5 of 79 flagged, all five
  real preprints.

- **The page derivation is pincite's, imported not copied.** `pages_of`,
  `page_numbers` and `page_offset` are pure functions and pincite does nothing at
  import time. Copying them lets the two skills' notion of "what page is this"
  drift, and a `version` verdict that disagreed with pincite's own would be worse
  than no verdict.

- **A bibliographic title query returns the SSRN PREPRINT DOI.** Measured on
  `aggarwal2015`: title alone returns `10.2139/ssrn.2120797`,
  `10.2139/ssrn.1688993`, `10.2139/ssrn.2023480` — the top three hits are all
  SSRN, none carries a page. Query with title **+ journal + volume + pages**, then
  VERIFY the returned record's start page equals the bib's `pages` before
  accepting: that yields `10.1111/jofi.12284`, page 2309–2346 against the bib's
  2309. A DOI that fails the page check is reported, never written — it is
  usually the preprint of the very work the entry means.

- **The verified Crossref record already carries the END page; `doi` writes it.**
  The match test was always `record start page == bib start page`, so the range
  that passes it is the same work's own span — `10.1111/jofi.12284` returns
  `2309-2346` against a bib holding `2309`. Written as `pages = {2309--2346}`.
  Four guards, and each blocks a different way of destroying a value that was
  already right: **`@article` only** (a `@misc` press release's `pages = {1}` is
  not an article span); **a bare start page only**, so a Bluebook pincite
  someone recorded there survives — on OPV `easterbrook1991` (`66-67`) and
  `jackson2019` (`849, 851--52`) are the only range-like values in 197 entries
  and BOTH are pincites, not spans; **never an `ARTICLE_NUMBER`**; and **the
  Crossref range must START at the bib's page**, re-checked at write time so the
  DOI test and the range test can never disagree. Measured on OPV: 55 of the 64
  bare start pages were eligible, **30 resolved**, and the 25 that did not are
  law reviews, which Crossref indexes thinly.

- **An end page turns `version` from one test into three.** With only a start
  page the derived span can be asked one question, `lo <= start <= hi`. With
  the end page it answers whether the span's BOTH endpoints fall inside, and
  whether the PDF's page count can hold the printed span at all — `n < span` is
  impossible for a version of record, and `n > span + 2` (beyond a cover sheet)
  is a different artifact. `aggarwal2015` is a 57-page PDF claiming a 38-page
  span, `ertimur2018` 64 pages for 21, `hayne2019` 59 for 43; each now fails on
  three counts instead of one, with no header parsing. Entries with no end page
  keep the start-only path unchanged — on OPV that is still most of them, and
  all 77 verdicts were byte-identical before and after the backfill.

- **federalregister.gov bot-blocks every request** and lands on
  unblock.federalregister.gov. Fetch from govinfo's link service,
  `https://www.govinfo.gov/link/fr/<vol>/<page>?link-type=pdf`, into
  `--fedreg-dir` as `fedreg-<vol>-<page>.pdf`. Pre-2000 volumes return the WHOLE
  ISSUE, 200+ MB — trim with `qpdf --empty --pages IN a-b -- OUT`. The SEC's own
  release PDF of the same document has different pagination, so it is the wrong
  source for a Fed. Reg. pincite.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Run pincite on a bib you have not audited | Entries with no `file` are skipped silently; here that was 118 of 197 | `audit` first |
| Lower the 0.95 cross-year threshold to map "just one more" PDF | At 0.55 `alexander2010` claims the wrong paper at 0.52 | Leave it unmapped and link it by hand |
| Hand-add a `file` to make an unmapped PDF go away | The unmapped list is the output, not a failure | Read the reason it prints first |
| Report a 6-digit `pages` entry as a preprint | It is an Elsevier article number; the PDF is the version of record | Trust the `article-number` skip |
| Check the version of record by finding the journal name on page 1 | Bluebook abbreviations never match mastheads — 46 of 61 flagged | Range-test the derived pages against the bib's start page |
| Accept a Crossref DOI because the title matched | Title-only returns the SSRN preprint; 6 of 7 test entries | Require the start page to equal the bib's `pages` |
| Write a page range over a `pages` that already holds one | It is a Bluebook pincite, not a span — both such values on OPV were | Leave it; `doi` reports it as SKIPPED |
| Give a `@misc` or `@book` entry an article span | `pages = {1}` on a press release is not page 1 of an article | The `@article` guard; read the SKIPPED list |
| Trust a freshly fetched publisher PDF | It can be an advance-access proof paginated 1–N | Re-run `version` on anything fetched |
| Use the SEC release PDF for a `Fed. Reg.` cite | Different pagination from the one the cite uses | `fedreg` via govinfo `link/fr/<vol>/<page>` |
| Run `link` without `--dry-run` on a bib you have not inspected | It writes into 197 entries | `--dry-run` first, then `--backup` |
