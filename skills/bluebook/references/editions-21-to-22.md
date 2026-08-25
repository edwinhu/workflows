# What changed between the 21st and 22nd editions

The 22nd edition shipped end of May 2025 and is the default on Bluebook Online. This file exists
because the rest of this skill was written against the 21st, and a rule that moved between editions
is the kind of error that survives review — the citation still looks valid.

**Authority:** the publisher's own
[Preface to the Twenty-Second Edition](https://www.legalbluebook.com/preface-to-the-twenty-second-edition),
read through the logged-in browser (it 403s an unauthenticated fetch). Everything in the first
table is the preface's own wording. Everything in "Verified here" was checked rule-by-rule against
both editions' live text.

## What the preface names, in its order

| Where | Change |
|---|---|
| **B1.2** | now carries the **`contrast`** signal, mirroring rule 1.2 |
| **B5.3** | now permits **`(citation modified)`** — see below, this one touches quotations |
| **B22, B23** | added, mirroring new rules 22 and 23 |
| **BT2** | updated for current local citation rules, more jurisdictions |
| **Rule 1.2** | new signal **`contrast`**, "for situations in which the contrast between authorities rather than a comparison between them will offer support" |
| **Rule 10.8.3** | language modified for clarity; addresses multi-district litigation |
| **Rule 12.4(f)** | codification information "may now be omitted depending on context" |
| **Rule 14.4** | **added** — citing state administrative materials |
| **Rule 15.1(d)** | **added** — citing pen names |
| **Rule 15.8** | expanded, more special citation forms |
| **Rule 18** | **substantially rewritten**, including new rules for **AI-generated content** |
| **Rule 20.2.4** | revised — sources in non-Roman-alphabet languages |
| **Rule 22** | **new** — citing materials from Tribal Nations |
| **Rule 23** | **new** — citing archival sources |
| **T1.3** | updated for developments in state legal systems |
| **T1.5** | **new**, online-only and free — all federally recognized Tribal Nations |
| **T2** | revised, three new jurisdictions |
| **T6** | new guidance for medical journals |
| **T10** | substantially modified and streamlined |

The preface calls this "hundreds of edits, large and small" — the table above is only what it chose
to name, so absence from it is not evidence a rule is unchanged.

## `(citation modified)` — the change that reaches this skill

B5.3 now permits `(citation modified)` where a quotation has been stripped of internal quotation
marks, brackets, ellipses, internal citations and footnote reference numbers, **and** capitalization
has been changed without brackets. It collapses a stack of parentheticals into one.

It is a **Bluepages** rule (practitioner documents), not a Whitepages rule — `references/quotations.md`
documents Rule 5, the law-review side, and does not cover it. Before using it, confirm the target
document follows the Bluepages.

## Verified here, not from the preface

Checked against both editions' live text on 2026-08-24:

- **Rule 5.1(a)(i) gained "single spaced."**
  21e: "indented on the left and right, **fully justified**, without quotation marks"
  22e: "indented on the left and right, **single spaced**, fully justified, without quotation marks"
  Zero occurrences of "single spaced" in the 21e rule; one in the 22e. The preface does not mention
  this, which is the clearest evidence that its list is partial.
- **Rule 5's structure is otherwise identical** — 5.1/5.2/5.3, same subsection lettering. All six
  corrections in `quotations.md` were re-confirmed word-for-word in the 22e.
- **Pagination moved.** Rule 5 is 22e pp. 87-91 against 21e-scan pp. 103-108. A bare page cite is
  ambiguous; name the edition.
- **Rules 22 and 23 are genuinely new.** `v22/rules/22-tribal-nations` returns rule text at p. 245;
  the same path under `v21` returns an empty body.

## Slugs are not guessable — take them from the nav

Two extractions came back empty or truncated because the URL slug was invented rather than read
off the site, and both looked like "the content is not there":

| guessed | actual |
|---|---|
| `2-typography-for-law-reviews` | `2-typefaces-for-law-reviews` |
| `t13-institutional-names-in-periodical-titles` | `t13-periodicals` |

A wrong slug returns the nav chrome with an empty body — indistinguishable from a page that has no
content, which is how T13 was recorded as "renders empty" for a day. Pull hrefs from the page and
filter, never construct them:

```js
[...document.querySelectorAll("a")].map(a => a.getAttribute("href")).filter(h => h && /t13-/.test(h))
```

Note also that some tables have **subtable pages**: T10's content lives at `t10-1-…`, `t10-2-…`,
`t10-3-…`, and the parent page carries only the headnote. A short parent capture means look for
children, not that the table is thin.

## A trap if you diff the editions yourself

**The left-hand rule list is edition-independent chrome.** It renders Rules 1-23 on `v21` pages too.
Diffing the two navs returns "no differences" and proves nothing — the difference is in the
CONTENT pages. This produced a false negative here before the empty `v21` Rule 22 body settled it.
Compare rule bodies, never the nav.

## Reading either edition

```
https://www.legalbluebook.com/bluebook/v22/rules/<n>-<slug>/<n>-<m>-<slug>
https://www.legalbluebook.com/bluebook/v21/rules/<n>-<slug>/<n>-<m>-<slug>
```

Swap `v22`/`v21` in the path; the site's dropdown does the same thing. Requires the institutional
login already held by the CDP browser on 9222.

## Status of this skill

**Rebuilt against the 22nd, and the claim is computed rather than asserted.**

```bash
bun scripts/bluebook-coverage.ts        # human-readable
bun scripts/bluebook-coverage.ts --json | jq -e .complete   # exits 0 when done
```

That command is the definition of done, and it holds all four conditions at once: every rule and
table the reference files cite is in the extracted corpus, every file carries an adversarial
verification report, and every one of those reports reads PASS. Prose status tables went stale
within a day of being written; this cannot, because it derives each fact from the corpus, the
files and the reports rather than restating them.

Current state: 145 corpus pages, rules 1-6, 10, 12-18, 20, 21, 23 and tables T1, T2, T6, T7, T8,
T10 (with T10.1-T10.3), T11, T12, T13, T14; eight reference files, seven with PASS reports plus
`quotations.md` verified against both editions.

**What it does and does not prove.** It proves no file cites a rule or table the corpus lacks, and
that an adversarial reader who re-derived every claim from the corpus found nothing substantive
left. It does not prove the corpus is the whole 22e — rules 7, 8, 9, 11, 19 and 22 and tables T3,
T4, T5, T9, T15, T16 are not extracted, and claims resting on them are marked in place.

**Getting there took three fix rounds, and the shape of the findings changed each time.** Round one
was substance: a "last visited" parenthetical documented for volatile sites when 18.2.1(b) makes it
the one for undated material, state regulations attributed to 14.3 where the corpus puts them in
14.4(a), three rows of a table captioned T8 that are not in T8. Round two was narrower. Round three
was a single illustrative citation carrying `(Am. L. Inst. 1998)` — the 21e form, zero occurrences
in the corpus against fourteen of `A.L.I.` The same defect had already been caught and documented
inside `secondary-sources.md` while still sitting uncorrected in `signals-parentheticals.md`, which
is the argument for per-file adversarial passes over one global read.

**A report that exists is not a report that passed.** The checker's first version counted reports on
disk and printed COMPLETE while two of them read FAIL. Fix agents were also given their reports as
leads rather than verdicts, and correctly rejected 8 findings across the seven files, quoting the
corpus sentence that vindicated the original text.

**The checker's own false positives outnumbered the real gaps, and each was a category.** "FAR
52.249-2(e)" read as a cite to rule 52.24, as "§ 28.501" once yielded rule 28 — retired by bounding
rule ids at 23, since Bluebook rules run 1-23 and anything above is a statute or regulation section.
A sentence listing six uncaptured tables registered as six citations to missing tables. And a marker
one line too far from the mention it governed kept failing until the exemption was scoped to the
paragraph rather than a line window — rewrapping the paragraph three ways moved which mention failed
instead of fixing any, which is what said the window was the wrong unit.

**Still genuinely open:**

- **Only Rule 5 has been diffed 21e-vs-22e.** The others were rebuilt FROM the 22e, which is not the
  same as knowing what changed. The preface names edits to 10.8.3, 12.4(f), 15.1(d), 15.8 and 18;
  those files reflect 22e text but do not record the delta.
- **Rules 7, 8, 9, 11, 19, 22 and tables T3, T4, T5, T9, T15, T16 are not extracted.** Where a
  captured rule cross-references one, the files report the cross-reference and mark the content
  unchecked — `statutes.md` does this for T9 at rule 13.3.
- **PASS means no substantive defect survived an adversarial re-derivation**, not that a human
  Bluebook editor has signed off.
