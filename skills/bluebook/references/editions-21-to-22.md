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

Written against the **21st**. Only `references/quotations.md` has been verified against a rule text,
and only Rule 5 has been compared across editions. Rules 1, 2, 4, 10, 12, 15-17 — where the other
seven reference files live — have **not** been diffed, and the preface names changes in 10.8.3,
12.4(f), 15.1(d), 15.8 and 18 that those files cannot know about.
