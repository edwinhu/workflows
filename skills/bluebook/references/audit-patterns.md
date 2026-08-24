# Bluebook Footnote Audit Patterns (22e)

An audit checklist for law review manuscripts, rebuilt against the **22nd edition (22e)** rule text
extracted to `scratch/bb22/corpus.txt`. Every check below names the rule it enforces and quotes or
paraphrases the 22e sentence that creates the duty. A check that could not be traced to the corpus is
kept — an unchecked heuristic is still useful — but is labelled so no one mistakes it for a rule.

**Status legend**

| Marker | Meaning |
|---|---|
| *(rule N.N)* | The check restates a sentence present in the extracted 22e text for that rule. |
| **UNVERIFIED** | Local practice, tooling advice, or a rule whose text is absent from the extraction. Do not cite it to a source-checker as Bluebook authority. |

**What the extraction does not cover.** Rule pages 10, 12, 13, 14, 15, 16, 17, 18, 1, 2 and 4 and
table T6 were captured. Rules 3, 5, 6, 8, 11, 19, 20 and 21 were **not extracted**, so where a
captured rule cross-references them (rule 3.5, rule 5.3(b), rule 6.1(a), rule 6.2(c), rule 8) this
file reports only the cross-reference itself, never the content of the referenced rule. Tables T10
and T13 **could not be extracted** — T10 came back truncated and T13 empty — so this file states only
that a rule points at them and never what they contain.

---

## A. Signals, parentheticals, and citation structure (rule 1)

| # | Check | Rule |
|---|---|---|
| A1 | Every footnote call number sits **after** the punctuation it follows — comma, semicolon, period — **except** before a dash or a colon *(rule 1.1(a))*. | 1.1 |
| A2 | A pincite is present on every citation **except** one introduced by "see generally" *(rule 1.2(f): "Pincites are required for all citations except for those introduced by 'see generally.'")*. | 1.2 |
| A3 | An explanatory parenthetical is present after every "see also", "cf.", "but cf.", "see generally", and after **each** authority in a "compare ... with" or "contrast ... with" — the 22e states the parenthetical is *required* for each of these *(rule 1.2(a)–(d), 1.5)*. | 1.2, 1.5 |
| A4 | "But" is dropped from "but see" and "but cf." when the signal follows another negative signal *(rule 1.2(c))*. | 1.2 |
| A5 | When "e.g.," is attached to another signal it is preceded by an *italicized* comma and followed by a **non**-italicized comma *(rule 1.2(a))*. | 1.2 |
| A6 | A signal used as the verb of a textual sentence is **not** italicized *(rule 1.2(e), citing rule 2.1(d))*; "cf." becomes "compare" and "e.g." becomes "for example" in that use. | 1.2, 2.1 |
| A7 | Signals appear in the order listed in rule 1.2; when "e.g.," is combined with another signal, the **other** signal's position governs *(rule 1.3)*. | 1.3 |
| A8 | Signals of the **same** basic type (supportive / comparative / contradictory / background) are strung in one citation sentence separated by semicolons; signals of **different** types are split into separate citation sentences *(rule 1.3)*. Inside a citation **clause**, mixed types in one string are permitted *(rule 1.3, 1.1)*. | 1.3, 1.1 |
| A9 | Authorities within a signal are separated by semicolons, and a markedly more helpful or authoritative source precedes the others; short-form cites are ordered as though cited in full *(rule 1.4)*. | 1.4 |
| A10 | A parenthetical that does **not** quote begins with a present participle and **never** with a capital letter; one that quotes a full sentence begins with a capital and carries closing punctuation *(rule 1.5(a)(i)–(ii))*. Omissions inside such a quote are marked per rule 5.3(b) — **UNVERIFIED**, rule 5 was not extracted. | 1.5 |
| A11 | Multiple parentheticals follow the fixed 22e order: (date) [hereinafter] (en banc) (Lastname, J., concurring) (plurality opinion) (per curiam) (alteration in original) (emphasis added) (footnote omitted) (citations omitted) (quoting ...) (citing ...), URL (last visited) (explanatory), then prior or subsequent history *(rule 1.5(b))*. | 1.5 |
| A12 | Explanatory parentheticals **precede** any subsequent-history or related-authority phrase *(rule 1.5(b), 1.6)*. | 1.5, 1.6 |
| A13 | A quoting/citing parenthetical covering several sources uses "first ...; and then ..." for two and "first ...; then ...; and then ..." for three or more *(rule 1.5(b))*. | 1.5 |
| A14 | Related-authority phrases ("reprinted in", "construed in", "quoted in") are italicized and appended without parentheses *(rule 1.6(a), (c))*; a work the primary authority itself discusses goes in a parenthetical instead *(rule 1.6(c))*. | 1.6 |

---

## B. Short forms: "id.", "supra", "hereinafter" (rules 4.1, 4.2)

| # | Check | Rule |
|---|---|---|
| B1 | In law review footnotes, "id." is valid only for the immediately preceding authority **within the same footnote**, or in the immediately preceding footnote **when that footnote contains only one authority** *(rule 4.1)*. | 4.1 |
| B2 | An "id." following a multi-source footnote is an error; replace with a short form naming the source *(rule 4.1, which gives the corrected example "See Chalfin, 233 A.2d at 570." in place of "See id. at 570.")*. | 4.1 |
| B3 | **Counting authorities correctly is the whole game.** Sources appearing in explanatory parentheticals, explanatory phrases, or prior/subsequent history are **ignored** when deciding whether the preceding footnote "contains only one authority" *(rule 4.1)*. A naive source-counter that counts a `(quoting X)` or an `aff'd, Y` as a second authority will emit false positives on correct footnotes. | 4.1 |
| B4 | "Id." is never used for an internal cross-reference; "See supra text accompanying note N" is repeated instead of "See supra id." *(rule 4.1, referring to rule 3.5 — rule 3 was not extracted)*. | 4.1 |
| B5 | The period in "id." is italicized *(rule 4.1)*. | 4.1 |
| B6 | Where the first citation was to a shorter work inside a larger authority, a later citation to the **whole** authority takes "supra", not "id." *(rule 4.1, pointing to rule 4.2(a))*. | 4.1, 4.2 |
| B7 | "Supra"/"hereinafter" are **not** used for cases, statutes, constitutions, legislative materials or debates (other than hearings), restatements, model codes, or regulations, except in extraordinary circumstances such as an extremely long name *(rule 4.2)*. Flag every `Case v. Case, supra note N`. | 4.2 |
| B8 | The supra form is the author's last name; for an institutional author use the **full institutional name**; with no author, the title, or for unsigned student-written material the designation *(rule 4.2(a), citing rule 16.7.1(b))*. | 4.2, 16.7.1 |
| B9 | "Supra" carries the footnote number of the full citation **unless** the full citation is in the same footnote, where "supra" appears bare *(rule 4.2(a))*. | 4.2 |
| B10 | "Hereinafter" is placed after the first citation of the authority but **before** any explanatory parenthetical, in brackets, in the same typeface as the full citation *(rule 4.2(b))*. | 4.2 |
| B11 | "Hereinafter" is not used where a plain "supra" would do *(rule 4.2(b): "Do not use the 'hereinafter' form when a simple 'supra' form is adequate")* — but **is** used to separate two works by one author appearing in the same footnote *(rule 4.2(b))*. | 4.2 |
| B12 | Once a hereinafter form exists, later cites use that form in place of the author's name or title *(rule 4.2(b), 16.9(b))*. | 4.2, 16.9 |
| B13 | Moving a hereinafter definition earlier requires rewriting every citation between the old and new positions, and leaves no orphaned bracket. **UNVERIFIED** — a repair procedure, not a 22e rule. | — |

---

## C. Source-specific short forms

| # | Check | Rule |
|---|---|---|
| C1 | A case short form is permitted only if the case is cited in the **same footnote** or in **one of the preceding five footnotes** (in full or short form, including "id."); otherwise a full citation is required *(rule 10.9(a))*. This five-footnote window is the check most manuscripts fail. | 10.9 |
| C2 | A one-party short form must be unambiguous and is italicized; do not shorten to a geographical or government unit, a government official, or another common litigant — "Patterson", not "NAACP" or "Alabama" *(rule 10.9(a)(i))*. | 10.9 |
| C3 | A short cite to an entire decision (no pincite) keeps the shortened name, volume, reporter and first page, and **drops** the court/date parenthetical *(rule 10.9(a)(i))*. | 10.9 |
| C4 | A statute short form is permitted when the statute was cited in the same footnote or can be readily found in one of the **preceding five footnotes** *(rule 12.10(b))*. | 12.10 |
| C5 | Outside U.S. Code provisions, "section" is spelled out in law review text and footnote text; "§" is for citations *(rule 12.10(c), citing rule 6.2(c) — rule 6 was not extracted)*. | 12.10 |
| C6 | "Infra" is **never** used for books, reports and other nonperiodic materials *(rule 15.10)*. Forward references to those sources are an error, not a resolution problem. | 15.10 |
| C7 | For a shorter work in a collection: "id." only if the shorter work was the immediately preceding authority in the same footnote or the sole authority in the preceding footnote, and never "id." to the collection as a whole while citing a different work in it; the collection takes a supra form built on its **title** *(rule 15.10.1)*. | 15.10 |
| C8 | A periodical supra form always gives the page cited **except** when citing the work in its entirety *(rule 16.9(b))*. A bare `Author, supra note N` on a pincited proposition is a defect. | 16.9 |
| C9 | For online-only materials the ordinary short form applies and the URL is **not** repeated after the full citation *(rules 12.10(d), 15.10, 16.9(b))*. | 12.10, 15.10, 16.9 |

---

## D. Abbreviation and typeface

| # | Check | Rule |
|---|---|---|
| D1 | In citations, abbreviate any word listed in **T6** even when it is the first word of a party's name — unless that word is part of a state, country or other geographical unit that is the **entire** name of the party ("South Dakota v. Dole", not "S. Dakota v. Dole") *(rule 10.2.2)*. | 10.2.2, T6 |
| D2 | Geographical units in case names are abbreviated as indicated in **T10**, unless the geographical unit is the whole party name — including "United States" *(rule 10.2.2)*. The contents of T10 **could not be extracted**; verify individual abbreviations against the printed table. | 10.2.2, T10 |
| D3 | Other words of eight letters or more may be abbreviated where substantial space is saved and the result is unambiguous *(rule 10.2.2; T6's introduction states the same allowance)*. | 10.2.2, T6 |
| D4 | Case names in **text** follow rule 10.2.1 only; the further abbreviation of rule 10.2.2 applies to citations. "Southern Pacific Co. v. Jensen" in text, "S. Pac. Co. v. Jensen" in a citation *(rule 10.2)*. An audit that abbreviates textual case names is introducing the error. | 10.2, 10.2.1 |
| D5 | Where the textual sentence names the case in full, the case name may be omitted from the citation *(rule 10.2.2)*. | 10.2.2 |
| D6 | Possessives abbreviate as "Emps.'" (plural) and "Emp.'s" (singular); plurals otherwise add "s" *(T6 introduction)*. | T6 |
| D7 | For periodical titles only: "University" abbreviates to "U."; "a", "at", "in", "of" and "the" are omitted but "on" is retained; and if one word survives that omission it is **not** abbreviated *(T6 introduction)*. | T6 |
| D8 | Periodical names are set in small capitals and abbreviated per **T6**, **T13** and **T10** *(rule 16.1)*. T13 and T10 **could not be extracted**; their contents are unchecked here. | 16.1, T6, T13, T10 |
| D9 | An institutional author is abbreviated **only if the result is completely unambiguous**, using T6 and T10, dropping "Inc." / "Ltd." where a word like "Ass'n" or "Co." already marks it a firm *(rule 15.1(e))*. Note the tension an auditor must respect: T6 says abbreviate any listed word, 15.1(e) subordinates that to unambiguity. | 15.1, T6, T10 |
| D10 | A book or report author's full name is given on first citation, in small capitals, keeping "Jr." or "III" and dropping "Dr.", "Prof.", "Judge", "Justice" *(rule 15.1)*. | 15.1 |
| D11 | Website main page titles are in small capitals, abbreviated per T6, T10 and T13 *(rule 18.2.2(b)(i))*. | 18.2.2, T6 |
| D12 | Law reviews run two typeface conventions — one for citations *(rule 2.1)* and one for textual material *(rule 2.2)*; Bluebook examples follow the law review **footnote** convention *(rule 2)*. The subsections' own text was **not extracted**, so per-source typeface calls (which sources take small caps versus italics) must be checked against the printed rule 2.1. | 2.1, 2.2 |
| D13 | Procedural phrases in a case name are always italicized regardless of the rest of the name *(rule 10.2.1)*; the parentheses in a citation are never italicized *(rule 2.1(f), as stated in rule 10.2)*. | 10.2.1, 2.1 |
| D14 | Spacing of abbreviations follows rule 6.1(a) *(so stated in the T6 introduction)*. Rule 6 was **not extracted** — spacing calls are unchecked here. | T6 |

---

## E. Internet sources and archiving (rule 18.2)

| # | Check | Rule |
|---|---|---|
| E1 | **All** online content cited is captured and stored permanently — via an archival tool, or by saving a fixed copy such as a PDF on file *(rule 18.2.1(d))*. This is a requirement, not a courtesy. | 18.2.1 |
| E2 | An archive URL is appended to the full citation **in brackets**; a source saved on file instead gets a parenthetical after the URL saying where it lives *(rule 18.2.1(d))*. | 18.2.1 |
| E3 | The archival link immediately **follows** the URL *(rule 1.5(b), 18.2.1(d))*. | 1.5, 18.2.1 |
| E4 | Where an authenticated, official, or exact copy (e.g. a paginated PDF) is available online, cite as if to the print source with **no URL appended** *(rule 18.2.1(a))*. | 18.2.1 |
| E5 | Where an online source merely shares print characteristics, cite as the print source and append the URL *(rule 18.2.1(b)(ii))*; the URL then immediately precedes the explanatory parenthetical *(rule 1.5(b))* and follows format and related-authority parentheticals *(rule 18.2.1(c))*. | 18.2.1, 1.5 |
| E6 | A DOI may be appended in brackets as a rule 18.2.1(d) archival tool *(rule 16.8)*. | 18.2.1, 16.8 |
| E7 | Public open-source repositories are exempt: no archival parenthetical or permanent URL is required *(rule 18.11)*. | 18.11 |
| E8 | A web-based source's citation carries title, pagination and publication date as they appear on the page, and points at the most stable location available *(rule 18.2.2)*; an institutional author is abbreviated per rule 15.1(e) and omitted where domain ownership is obvious from the title *(rule 18.2.2(a))*. | 18.2.2, 15.1 |

---

## F. Known false positives — do not "fix" these

| # | Pattern | Why it is correct |
|---|---|---|
| F1 | "id." after a footnote that visibly names several cases | Sources in parentheticals, explanatory phrases and history do not count toward the one-authority limit *(rule 4.1)*. |
| F2 | A bare "supra" with no note number | Correct when the full citation is in the same footnote *(rules 4.2(a), 16.9(b))*. |
| F3 | An unabbreviated case name in the running text | Rule 10.2.2's further abbreviation applies to citations, not text *(rule 10.2)*. |
| F4 | "Compare ... with ..." carrying a parenthetical on every authority | Required, not redundant *(rule 1.2(b))*. |
| F5 | A print-form citation to an online PDF with no URL | Correct for an authenticated, official, or exact copy *(rule 18.2.1(a))*. |
| F6 | A signal-as-verb set in roman | Signals are not italicized when used as verbs *(rule 1.2(e))*. |

---

## G. Pipeline and tooling — **UNVERIFIED** (local practice, no Bluebook authority)

Everything in this section is operational experience with the audit toolchain. None of it is a 22e
rule and none of it was traced to the corpus; it is kept because it is useful, and marked because an
unmarked heuristic is what this file exists to eliminate.

**Stage order.** Mechanical regex and chain checks first; per-footnote model audit second;
cross-footnote registry pass third; DOCX XML corrections fourth; archiving last. Each stage catches a
different error class, and the later stages are expensive.

**Formatted text is essential for a model audit.** Plain-text footnotes produce mass false positives —
in one run, 414 flagged issues from 239 footnotes, the great majority spurious. Without typeface
information the model cannot tell an italicized case name from roman text, small caps from roman, or
an italicized signal from the same word used in a sentence. Convert runs to inline markup first:
`*text*` italic, `[SC]text[/SC]` small caps, `**text**` bold, `***text***` bold italic. Pandoc is not
a substitute — Markdown has no small-caps representation, and the typeface distinction is exactly
what checks A6, D8, D10, D11 and D12 depend on.

**Per-footnote prompt.** Send the formatted footnote, its number, and the preceding footnote's
formatted text (B1 and C1 cannot be judged without it), and request structured JSON —
`{issue, rule, severity, suggested_fix}`. A five-footnote lookback window is needed for C1 and C4.

**Cross-footnote registry.** Build a map of hereinafter definitions and of author to cited works
before resolving any supra. Where one author has several works, an author-plus-note match is not
enough — the note number must resolve to the right title. Grade matches high / medium / low and
auto-fix only the high tier.

**Perma.cc.** Free accounts are capped (10 links/month) and unusable for a law review manuscript;
institutional accounts archive into an organization folder, and the folder id must be passed on
creation or the request falls back to the personal cap. Deduplicate URLs before archiving, persist
the `{url: guid}` map after every success so a mid-run failure resumes, and space requests about a
second apart. Insert as `https://www.example.com/report.pdf [https://perma.cc/ABCD-1234].` — bracket
placement is the part that is a rule, and it is E2, not this section.
