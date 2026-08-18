# D. Presentation hygiene (hyperlinks + spacer paragraphs)

Two defects that are **invisible in Word** and only surface in the rendered PDF,
so they survive every proofread of the source and reach a submission intact.

```bash
# hyperlinks: tracking params, SSRN forms, stray wrappers
"$SKILL_DIR/scripts/docx_links.py" paper.docx --all --in-place
"$SKILL_DIR/scripts/docx_links.py" paper.docx --all --check      # gate a build

# manual spacer paragraphs — let the stylesheet do the spacing
"$SKILL_DIR/scripts/docx_spacers.py" paper.docx --in-place
```

### `docx_links.py`

**A hyperlink in OOXML is two facts in two parts** — the run text a reader sees
and the relationship `Target` the click follows — and nothing keeps them in
sync. Fix one and the footnote PRINTS one URL while NAVIGATING to another,
invisible on the page *and* in any prose diff. Every pass here rewrites both.

| pass | what it fixes |
|---|---|
| `--strip-tracking` | analytics params (`utm_*`, `fbclid`, …). Only known analytics keys — `?abstract_id=` and `?doc=` are load-bearing in legal citation, so a blanket "drop everything after `?`" breaks the cites it meant to tidy |
| `--canonical-ssrn` | `papers.ssrn.com` / `http://` → bare `https://ssrn.com/abstract=N` |
| `--unwrap-footnotes` | stray `w:hyperlink` wrappers in footnotes, for templates where a URL is plain text |

**Why the wrappers matter.** They are invisible in Word when the wrapped runs
carry no colour, underline or `Hyperlink` character style of their own — but
**LibreOffice renders any hyperlink with its own "Internet Link" styling**, so
they appear as blue underlined text in a LibreOffice-produced PDF the `.docx`
never asked for. In one real submission a pasted wrapper's anchor spanned the
*wrong* citation entirely: the link targeted a DOL release while the visible
text was a different author's article.

`--unwrap-footnotes` touches **footnotes only**. A body `w:hyperlink` is
usually an internal TOC or cross-reference link and is load-bearing.

### `docx_spacers.py`

Deletes manual empty paragraphs so heading spacing comes from the stylesheet
alone. Hand-maintained whitespace drifts: an audit of one submission found a
heading with a doubled blank and two with none — ±15pt against a 38pt norm,
invisible in the `.docx`, obvious in the PDF.

> **A text-empty paragraph is not necessarily empty.** In that same file four of
> sixty-nine carried real content — one held the `w:drawing` for the article's
> only **figure**, two held `bookmarkStart` anchors the TOC targeted, one held a
> `w:br`. A blanket "strip every empty paragraph" deletes the figure. The script
> refuses any paragraph carrying a structural child and reports what it kept.
> It also skips paragraphs nested in tables, text boxes and content controls —
> a Word TOC lives inside a `w:sdt`.

**Removing spacers can collapse a title page.** Headings survive because
`Heading1–4` carry their own spacing; front matter usually does not — title,
author line, "Abstract" are often unstyled `Normal`, which defines *no* spacing,
so the blanks were the only thing separating them. After running this, render
and look at page one. Giving those paragraphs real styles is the fix; law review
title-page norms are in `law-review-docx`.

### Both edit bytes, never the tree

ElementTree re-emits only the namespaces it sees in use, silently dropping the
two dozen `w14`/`w15`/`w16*` declarations a real Word file carries and leaving
`mc:Ignorable` pointing at undeclared prefixes — invalid OOXML that Word
rejects. The structural passes edit bytes; the URL passes use lxml, which
preserves the full nsmap (verified: 35 declarations in, 35 out). After any
edit, assert the declaration count and `mc:Ignorable` still agree.
