# Title-page spacing, measured from published law review typesets

Front matter — title, author line, "Abstract", "Table of Contents" — is usually
unstyled `Normal` in a Word manuscript, and `Normal` defines **no** spacing. So
the vertical rhythm ends up carried by manual empty paragraphs, which drift.
If you strip those spacers (see `docx-repair`'s `docx_spacers.py`), the title
page collapses and you need real numbers to rebuild it from the stylesheet.

## The measurements

Baseline-to-baseline gaps, in multiples of the body line height, from published
typesets. Normalising by body line makes the figures portable across documents
with different type sizes.

| gap | Kahan & Rock | Griffin | Sharfman | Tuch | Choi/Fisch/Kahan | Hayden & Bodie |
|---|---|---|---|---|---|---|
| title → author | 2.0 | 2.0 | 2.3 | 2.1 | 3.9 | 2.5 |
| author → ABSTRACT | 3.9 | 2.0 | 4.0 | 4.0 | 4.5 | — |
| ABSTRACT → body | 1.3 | 2.0 | 1.5 | 1.3 | 2.2 | — |
| title internal (multi-line) | 1.2 | — | 1.3 | 1.2 | 1.7 | 1.3 |

## Which one to copy

**Griffin, not the average.** Most of these are *journal-set pages* carrying
furniture a submission manuscript does not have — a running "ARTICLES" head, an
issue line, a volume rule — and their ~4× break before ABSTRACT exists to
balance that furniture. Copy the average into a bare manuscript and the author
line ends up stranded in a band of whitespace.

Griffin (Wash. U. L. Rev., forthcoming) is the one laid out **as a manuscript**,
and it uses a uniform **2.0×** for every front-matter gap. That is the right
default.

## Then check it fits

Law review first pages carry the author acknowledgment footnotes, which are
often enormous. In one real submission the three bio footnotes consumed roughly
**430pt of a 792pt page**, leaving only ~317pt of body — and at a full 2.0×
the abstract overran onto page two by two lines.

Each gap is worth one body line (~15.6pt at 12pt Garamond), so the three gaps
are the entire budget. Recovering ~31pt meant half-lines on title→author and
author→ABSTRACT plus no gap at all after the ABSTRACT heading, landing at
1.7× / 1.6× / 1.0×. Kahan and Tuch also set the heading close to its text
(1.3×), so a tight heading is well within convention.

**Fitting the abstract on page one outranks the last half-multiple of rhythm.**
After any retune, render and confirm page one still ends with the abstract.

## Measuring your own

`pdftotext -bbox` gives word boxes; group them into lines by `yMin`, take the
median consecutive delta as the body line, and read the gaps off the top of the
page. Do not eyeball it and do not ask a vision model — spacing judgments from
a rendered image proved unreliable in both directions here, calling a 23.6pt
gap "extra" and a corrected page "still too wide". The line boxes are ground
truth.

## Applying it

Word spacing is in twips: **20 twips = 1pt**, so one 15.6pt body line = 312
twips. Put the space in named paragraph styles rather than on the paragraphs
themselves — direct formatting overrides the stylesheet, and a `before=0
after=0` on the Title paragraph will silently defeat the Title style's own
spacing.
