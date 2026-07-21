# JLE / Chicago house style — what the template encodes

Source: *Journal of Law and Economics* author instructions
(`https://www.journals.uchicago.edu/journals/jle/instruct`) and the University
of Chicago Press Manuscript Preparation Guidelines
(`https://press.uchicago.edu/resource/emsguide.html`).

**Both URLs sit behind Cloudflare and 403 automated fetches — including a
headless Chromium on CDP, which stalls on the interstitial.** Read them through
`web.archive.org` (that is how this file was compiled) or ask the user to paste.
JLS and JLEO publish no separate Word template either; JLS is the same Chicago
house style, JLEO (Oxford) is author-date with a reference list too, so this
template serves all three.

There is **no official Word template** for any of these journals. Submission is
a PDF built by Editorial Manager from whatever you upload (Word preferred).

## Manuscript order (JLE, verbatim)

1. Title page
2. Abstract (**strict** 150-word limit)
3. Text and citations
4. Footnotes
5. Appendixes
6. Reference list
7. Tables
8. Figure legends
9. Figures

`build_le_docx.py` keeps 1–6 in one file, with Word footnotes at the page foot
rather than a separate section — Chicago's EMS guide requires notes created with
"Word's 'Footnote and Endnote' feature without changing any of the preset
options," and "files with unlinked notes will be rejected." Items 7–9 are the
print-production layout; for Editorial Manager submission, in-place tables and
figures are accepted, and the ordering matters at the copyediting stage.

## Global

- **Double spaced throughout — including footnotes, tables, and figure legends.**
  This is the single hardest requirement and the one every third-party template
  gets wrong.
- Title page carries the names, e-mail addresses, and affiliations of all authors.
- *The Chicago Manual of Style* (JLE cites the 16th ed.; the vendored CSL is the
  18th, which differs only in details the copyeditor fixes) and *Webster's
  Collegiate*.
- Do **not** use "etc.," "e.g.," or "i.e." — spell them out ("and so on," "for
  example," "namely"/"that is").
- Latin phrases in common use (*ceteris paribus*, *res ipsa loquitur*, *in situ*,
  *ex post*) are **not** italicized.

## Subheads

| Level | Form | Template style |
|-------|------|----------------|
| 1 | `1.` Arabic, **boldface**, cap and lower case | `Heading 1` |
| 2 | `1.1.` Arabic, *italic*, cap and lower case | `Heading 2` |
| 3 | `1.1.1.` Arabic, roman, cap and lower case | `Heading 3` |
| 4 | Run-in text, *italic*, cap and lower case. | `Heading 4` |

If only three levels are used, omit level 3.

The numbers come from Word list numbering (`numId 900`), so **never type "1." into
the markdown heading** — you would get "1. 1. Introduction". Back-matter heads
(Abstract, References, Appendix …) are retagged to the custom `Unnumbered
Heading` style by the build so they stay out of the count.

## Citations — the big divergence from law review style

**Author-date in the text, reference list at the back.** Not footnote citations.

- `(Becker 1968)`, `Becker (1968)`, `(Hovenkamp 1994, 366–69)`,
  `(see, for example, Corcoran 2004; Mullen 2000)`,
  `(see Polinsky and Shavell [1979, 1984], for a discussion)`.
- Four or more authors → `Turner et al. (2002)` in text, all names in the list.
- **Cases are cited in the text and do NOT go in the reference list**:
  `In International Salt Co. v. United States (332 U.S. 392 [1947]), …`, then
  short form `(International Salt, 332 U.S. at 398)`. Keep cases out of the .bib.
- Chicago's EMS guide: pick notes **or** author-date and never blend them.

In markdown: `[@becker1968]` → `(Becker 1968)`; `@becker1968` → `Becker (1968)`;
`[see, for example, @a; @b]` → `(see, for example, A 2004; B 2000)`. Writing
literal parentheses around a bare `@key` produces `(Becker (1968))` — use the
bracket form.

## Footnotes

- The **acknowledgment note comes first**, before note 1. `--acknowledgement
  "..."` injects it as a symbol-marked (`*`) note so it stays outside the
  numbered run.
- "Footnotes must be substantive and cannot contain purely bibliographic
  material. Simple citations must be in the text." The build warns on any
  footnote whose body is nothing but citations.
- Appendix footnotes continue the main numbering (the template sets
  `numRestart="continuous"`).

## Tables

- Chicago Manual chapter 13. **No more than one table per page**; all elements,
  including the notes, double spaced; a table may run more than one page.
- Brief titles. All explanatory material goes in notes **below** the table — no
  cross-references to footnotes elsewhere in the article.
- Identify every quantity, unit, and abbreviation.
- Sources identified in full at the bottom of each table.
- Significance legend, exactly: `+ P < .10; * P < .05; ** P < .01`.

Use the `Table Note` custom style for the note block:

```markdown
::: {custom-style="Table Note"}
Note. — ... + *P* < .10; \* *P* < .05; \*\* *P* < .01.
:::
```

## Figures

- Finished figures are **4.5 inches wide**; set `width=4.5in` on the image.
- **Times Roman lettering, no type smaller than 7 points.**
- **No color, no shading** — use hatching/cross-hatching for visual distinctions.
- No boxes or rules around the figure.
- Figure legends belong together on a separate double-spaced page (production
  stage); the build leaves them attached to the images, which Editorial Manager
  accepts.

## Appendixes

Equations, tables, and figures restart numbering per appendix: Equation A1,
Table A1, Figure A1 for Appendix A; B1 … for Appendix B. `pandoc-crossref`
numbers continuously, so **appendix objects must be numbered by hand** if you
have more than one appendix. The build warns when appendix sub-headings still
carry body section numbers.

## Data policy

Accepted empirical papers must supply data, programs, and computational details
sufficient for replication before publication; flag proprietary data in the
cover letter.
