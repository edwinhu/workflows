# Bib-field conventions for the expert-report CSL

`assets/bluebook-expert-report.csl` renders from the CSL variables pandoc's biblatex reader
produces. The fields below are the ones it reads; anything else (including `note`, `annote`,
`file`, `url`, `urldate`) never prints. Titles print exactly as written: the build braces
`title`, `shorttitle`, `journaltitle`/`journal`, `shortjournal`, `booktitle`, `maintitle`,
`eventtitle` and `series` in a temporary copy, because pandoc sentence-cases unbraced biblatex
titles ("In re acme widget co.").

`shorttitle` is the switch for `[hereinafter X]` and for `X, supra note N`. Leave it off a source
that should repeat in full (statutes, a committee report cited once or twice).

## Pin cites in the drafts

Write `[@key, at 4 ¶ 4]`, `[@key, at *3]`, `[@key, at 5-6]`, `[@key, § 11(m)]`,
`[@key, pt. II.B.2]`, `[@key, slip op. at 87]`. The build turns a leading `at` into a page
locator and braces every locator, so it prints once and the CSL decides whether Bluebook wants
"at" (`, 105` after a reporter or journal page; `, at *3` after a WL cite; `Id. at 5 ¶ 6`).

## By source type

| Source | Entry | Fields | First cite | Short forms |
|---|---|---|---|---|
| Reported case | `@jurisdiction` | `title`, `shorttitle`, `volume`, `journaltitle` (reporter), `pages` (first page), `institution` (court), `date`; a docket `number` is not printed | *Smith v. Jones*, 900 F.2d 100, 105 (2d Cir. 1990) | *Smith*, 900 F.2d at 108; *Id.* at 105 |
| Unreported case | `@jurisdiction` | as above plus `number` (`No. 2019-0123-VCL`, as printed); WL cite as `volume` = year, `journaltitle` = `WL`, `pages` = WL number; full `date` | *In re Acme Widget Co. Stockholder Litigation*, No. 2019-0123-VCL, 2019 WL 1234567, at *3 (Del. Ch. Mar. 14, 2019) | *Acme Widget*, 2019 WL 1234567, at *5 |
| SEC release | `@report` | `title`, `shorttitle`, `type` = `Securities Act Release` / `Exchange Act Release`, `number` = `33-7391`, WL as for cases, `date` | Proposed Amendments to the Resale Safe Harbor, Securities Act Release No. 33-7391, 1997 WL 70601, at *4 (Feb. 20, 1997) [hereinafter Resale Release] | Resale Release, *supra* note 4, at *5 |
| Committee report | `@report` | `type` = `S. Rep.` / `H.R. Rep.` / `H.R. Conf. Rep.`, `number` = `73-47`, `date` = year; no `title` | S. Rep. No. 73-47, at 5–6 (1933) | repeats in full |
| Statute, rule | `@legislation` | `title` as cited (`15 U.S.C. {\S} 77o`, `Del. Code Ann. tit. 8, \S~144`), optional `date` | 15 U.S.C. § 77o; pin `(b)` joins: § 77o(b); a `§` pin on a title ending in a section replaces it: `[@k, § 144(d)(2)]` → tit. 8, § 144(d)(2) | repeats in full |
| Journal article | `@article` | `author`, `title`, `journaltitle`, **`shortjournal`** (Bluebook T13 abbreviation, printed in small caps), `volume`, `pages`, `date` | Alex Doe, *Shelf Registration and Due Diligence*, 87 Va. L. Rev. 1001, 1010 (2001) | Doe, *supra* note 1, at 1015 |
| Expert report, deposition | `@report` | `title` (`Expert Report of Professor Richard Roe`, `Deposition of Richard Roe`), `eventtitle` = the case name (printed italic), `number` = its docket **as printed** (`No. 1:24-cv-00999-UNA`, `C.A. No. 2019-0001-ABC`; the case name never goes here), optional `institution` = court, `date`, `shorttitle`; **no `author`** (the title carries the name). Without `shorttitle` it takes the same order, with no `[hereinafter]` | Expert Report of Professor Richard Roe in *Doe v. Example Corp.*, C.A. No. 2019-0001-ABC (Del. Ch. Nov. 2, 2021), at 38 ¶ 75 [hereinafter Roe Example Report] | Roe Example Report, *supra* note 2, at 12 ¶ 25 |
| Law-firm memo | `@report` | `author` = `{{Firm LLP}}`, `title`, `date`, optional `shorttitle`. A `type` (`Client alert`, `Firm publication`) never prints by itself; it prints only with a `number` (`type = Client Alert`, `number = 3345` → Client Alert No. 3345) | Example & Partners LLP, Who Is a Controlling Person? (May 17, 2022); with a pin and short name: … (Feb. 2025), at 2 [hereinafter Smith & Partners Guide] | Smith & Partners Guide, *supra* note 5, at 3 |
| Book | `@book` | `author`, `title`, `edition`, `date` | A. Author, Corporate Control 12 (2d ed. 2001) | Author, *supra* note 7, at 14 |
| Anything else | `@misc` | `author`, `title`, `date`, optional `shorttitle` | Author, Title (2017), at 44 | supra with `shorttitle` or `author`; otherwise repeats |

`[hereinafter X]` always comes after the pin (Bluebook 4.2(b)): `…(Oct. 15, 2026), at 4 ¶ 4
[hereinafter Roe Report]`.

**Typography** (`typography:` in the caption or `--typography`): `smallcaps`, the default and
what the served footnotes use, sets journal abbreviations, book authors and titles, and firm
memos (author, title and short name) in small caps. `plain` (court-document style) sets all of
those roman, except book and memo titles, which turn italic. Case names, article titles and
signals are italic in both.

Reporter and WL citations sit in `volume` / `journaltitle` / `pages`. A legacy `reporter` field
is read when `journaltitle` is absent (below). A WL number kept only in `note` never prints.

## Legacy-shaped entries

A bib written for an older builder renders as it stands: `build_docx.py` converts the bib to CSL
JSON with pandoc, then `normalize_csl` rewrites each entry in memory before citeproc reads it.
The bib file is never changed. Precedence, applied in this order:

1. `note` and `annote` are dropped. Nothing is ever read out of them.
2. An additive field beats the legacy field it duplicates: `journaltitle` > `reporter`;
   `type`/`number` > `howpublished`. `reporter` fills the reporter only when `journaltitle` is absent.
3. A `@misc` takes its CSL type from its fields, first match wins:

   | Fields present | Type | Also |
   |---|---|---|
   | `eventtitle` | report (expert report, deposition) | `author` dropped (the title carries the name) |
   | a court (`institution`/`court`) and `reporter`, or `journaltitle`+`volume`+`pages` | case | |
   | `type` + `number` | report (release, committee report) | |
   | `title` opening with a U.S.C., C.F.R. or `Code Ann. tit. N, §` cite | statute | `author` dropped |
   | `author` + `howpublished` | firm memo | `howpublished` → `type`; `Client Alert No. 3345` → `type` + `number` |
   | none of these | generic (`@misc` as before) | |

   On a converted `@misc` the date parenthetical carries only the court (`institution`/`court`):
   `organization` and `howpublished` never print there.
4. Whatever the entry type:
   - A release or committee report (`type` ending `Release` or `Rep.`) prints no `author`.
   - A `title` that only restates `type No. number` (`S. Rep. No. 73-47 (1933) (Regulation of
     Securities)`) is dropped.
   - A statute `title` is cut to the cite (`17 C.F.R. § 230.405`), dropping a section caption and a
     `current through` date.
   - A case with a reporter other than WL/LEXIS prints no docket.
   - A docket `number` with no `type` and no `No.` gets `No. ` in front.

`fixtures/sample/references/sources.bib` pairs each legacy shape with its clean twin, and
`build_docx_test.py` asserts that both render the same footnote XML.

## Reporter citations: verify date and court

A reporter or WL citation attached to an entry must be checked against the opinion's **date and
court**, not against the case name alone. An affirmance or a reversal shares the caption: the
later opinion of a higher court on the same caption has a different reporter cite, year and
court. Before adding `volume`/`journaltitle`/`pages`, confirm that a source citing that reporter
cite gives the same court and year as the entry's `institution` and `date`. A cite in a `note`
is usually subsequent history (`aff'd, … (Del. 2022)`) and must not be copied into the entry.

The skill has **no automated reporter lookup**. `normalize_csl` never derives a citation from
`note` or from any other source, and a test pins that. Every reporter cite in a build is one a
person put in the bib.
