---
name: law-econ-docx
description: "Use this skill to BUILD a Word manuscript from LAW AND ECONOMICS markdown — author-date citations plus a reference list, double spaced throughout, Latin Modern typography — for the Journal of Law and Economics, Journal of Legal Studies, JLEO, ALER, or an econ-flavored job market paper. NOT 'law-review-docx' (footnote/Bluebook style — different citation model), NOT the generic 'docx' skill (edits docx content), NOT 'docx-render' (docx to PDF only). Triggers: 'build the L&E paper', 'law and economics Word template', 'JLE submission docx', 'Journal of Legal Studies format', 'JLEO manuscript', 'author-date Word document', 'econ job market paper in Word', 'Chicago author-date docx', 'make the submission docx for JLE'."
user-invocable: true
---

# Law & Economics DOCX Export

Build a submission-ready Word manuscript from markdown for the Chicago-style
law-and-economics journals (JLE, JLS, JLEO, ALER) and for job market papers
written for that audience.

**These journals publish no official Word template.** Their instructions amount
to "double spaced throughout, Chicago Manual of Style, author-date with a
reference list," and every template circulating online is third-party and
mutually inconsistent. This skill is that missing template plus the pipeline
that drives it.

## Iron Law: never hand-roll the pandoc call

**NO L&E .docx WITHOUT `build_le_docx.py`.** A bare `pandoc -o out.docx` gives
Calibri, single spacing, no reference list, numbered headings that collide with
the back matter, and pandoc's grid-bordered tables — a document that looks
finished and violates four separate JLE requirements. Reaching for raw pandoc to
"just get something quickly" is the efficiency drive producing an unusable
deliverable; it is slower than the script, not faster.

Agents **without the `Skill` tool** (most workflow subagents) can't invoke this
skill — run the script directly.

## Usage

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/build_le_docx.py PAPER.md [-o OUT.docx] [--pdf]
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/build_le_docx.py PROJECT_DIR      # drafts/*.md in numeric order
```

| Flag | Effect |
|------|--------|
| `--acknowledgement "..."` | Injects the unnumbered `*` acknowledgment note. **JLE requires one**, placed before note 1. |
| `--bibliography FILE` | Default: `references/sources.bib`, `references.bib`, or `sources.bib` beside the source. |
| `--csl FILE` | Default: the vendored `assets/chicago-author-date.csl` (CMOS 18e author-date). |
| `--spacing onehalf\|single` | **Internal circulation only.** Double is the JLE submission requirement and the default. |
| `--pdf` | Renders via `doc_render.convert` after building. |

The build: assembles sources (first file's YAML frontmatter becomes the document
metadata, later files' footnote labels are namespaced), resolves
`<!-- include: /abs/path.md -->` sentinels, guarantees a `::: {#refs}` reference
list, runs pandoc with `--citeproc` + `pandoc-crossref` + the L&E reference doc,
then retags back-matter headings, forces widow control, and restyles tables to
booktabs.

## Metadata (YAML frontmatter of the first file)

```yaml
---
title: "Deterrence without Detection"
author:
  - "Isabelle Marchand, University of Chicago Law School, imarchand@uchicago.edu"
  - "A. N. Coauthor, Northwestern University, coauthor@northwestern.edu"
date: "January 2026"
abstract: |
  ... 150 words maximum, strictly enforced by the journal ...
---
```

JLE requires the title page to carry names, e-mail addresses, **and**
affiliations — put all three in each `author` entry. The build warns if the
abstract exceeds 150 words.

## What the template encodes

Full editorial spec — subhead ladder, citation forms, table/figure rules,
appendix numbering — is in **`references/jle-house-style.md`**. Read it before
answering any "how should X be formatted" question; do not answer from memory.

| Style | Use | Formatting |
|-------|-----|------------|
| `Title` / `Author` / `Date` | Title page | Centered; 14pt bold title |
| `Abstract Title` / `Abstract` | Abstract block | Bold centered head; indented body |
| `Heading 1` | `1.` Section | **Bold**, auto-numbered |
| `Heading 2` | `1.1.` Subsection | *Italic*, auto-numbered |
| `Heading 3` | `1.1.1.` Sub-subsection | Roman, auto-numbered |
| `Heading 4` | Run-in head | *Italic*, keepNext |
| `Unnumbered Heading` | Abstract / References / Appendix | Bold, **no** section number |
| `Body Text` / `First Paragraph` | Body | First-line indent; no indent after a heading |
| `Footnote Text` | Footnotes | 12pt, **double spaced** |
| `Bibliography` | Reference list | Hanging indent, double spaced |
| `Table Note` | Note under a table | Double spaced |

Everything is Latin Modern Roman at 12pt, double spaced, on US Letter with 1-inch
margins and a centered page-number footer. Math is OMML with `Latin Modern Math`
as the math font, so `$...$` and `$$...$$` render as real Word equations.

**Section numbers come from Word list numbering.** Write `# Introduction`, never
`# 1. Introduction`.

## Provenance of the typography — and what survived

The typography comes from **WordTeX** (`tomwildenhain.com/wordtex`). Its
`WordTeX Template.dotx` turned out to be a **pandoc-shaped style set already** —
`Compact`, `Author`, `Abstract`, `BlockText`, `FootnoteText`, `TableCaption`,
`CaptionedFigure`, `SourceCode`, `VerbatimChar` are all pandoc styleIds, and the
theme fonts are LM Roman 10 / Latin Modern Math. So the styles extracted
cleanly; no hand-rebuild fallback was needed.

What we did **not** take: the `.dot`/VSTO plugin, glossary/AutoText, and
autocorrect macros. Those are for *authoring* in Word; pandoc needs a plain
`.docx` that merely *carries* style definitions.

Where JLE and WordTeX conflict, **JLE wins**, and the divergence is commented in
`scripts/make_le_template.py`:

| WordTeX (LaTeX look) | Template (JLE) | Why |
|---|---|---|
| `w:line="204"` (tight LaTeX leading) | `w:line="480"` (double) | "double spaced throughout" |
| 11pt body, 8pt footnotes, 10pt abstract | 12pt everywhere | "including footnotes, tables, and figure legends" |
| Justified (`jc=both`) | Flush left | Chicago manuscript prep; justified + double spaced opens rivers |
| Numbered `Bibliography` list | Hanging-indent reference list | Author-date, not numbered references |

## Regenerating the template

The `.docx` is **built, not hand-edited**, so every choice is auditable in one file:

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/make_le_template.py
```

It starts from `pandoc --print-default-data-file reference.docx` (guaranteeing
every part and styleId pandoc's writer emits is present), transplants the
Latin Modern typography, adds the JLE heading numbering and page-number footer,
and self-verifies. Output:
`${CLAUDE_PLUGIN_ROOT}/references/templates/law_econ_template.docx`.

**Never open the template in Word and save it.** Change `make_le_template.py`
and regenerate.

## Round-trip check

`examples/sample/` is a small paper exercising headings, a table with a note, a
figure, display + inline math, footnotes, and author-date cites:

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/build_le_docx.py \
    ${CLAUDE_SKILL_DIR}/examples/sample/paper.md -o /tmp/sample.docx --pdf
```

## Known limitation: math in the headless PDF path

The build stamps `Latin Modern Math` in **both** places it has to go —
`settings.xml`'s `m:mathPr/m:mathFont` (what Word uses; run properties do *not*
override it) and an explicit `w:rFonts` on every OMML run (for LibreOffice/x2t,
which ignore `m:mathFont`). Both are required: pandoc regenerates
`settings.xml` and drops the template's copy, so without the re-injection Word
renders math in Cambria Math even though the body text is correct.

**LibreOffice ignores the run font too** — it converts OMML to its own formula
objects and uses its configured math font, so a LibreOffice render shows Latin
Modern body text next to Liberation Serif math. x2t is worse (it misses Latin
Modern entirely and falls back to Liberation Sans).

The .docx is correct; only the LibreOffice *preview* is off. On Linux, render
with **`word-render`** (below) — verified fully correct. Verified on the sample
via LibreOffice: body text is `LMRoman10-Regular/Bold/Italic`, math is the only
fallback.

**Do not try to fix this by installing fonts or configuring LibreOffice — both
have been tested and neither works.**

| Attempted fix | Result |
|---|---|
| Install Latin Modern Math system-wide | No effect. The font is typically **already installed** (TeX/LaTeX pulls it in) and `fc-match "Latin Modern Math"` resolves to the real `latinmodern-math.otf`. Availability was never the problem. |
| Override LO's Math module default fonts (`/org.openoffice.Office.Math/Font` → `Variables`, `Functions`, `Numbers`, `Text`) | No effect. Re-rendered with those forced to `Latin Modern Math` in a clean LO profile; **byte-identical font list**. The OOXML import fixes formula fonts at import time and consults neither `m:mathFont` nor the Math defaults. |

To confirm the fallback is math-only rather than a document-wide problem, map
glyphs to fonts instead of trusting `pdffonts` (which ignores `-f`/`-l` and
reports the whole document for every page) or a vision check (which misjudges
double spacing):

```bash
uv run --with pdfplumber python3 -c "
import pdfplumber, collections
for i, pg in enumerate(pdfplumber.open('OUT.pdf').pages, 1):
    d = collections.defaultdict(str)
    for ch in pg.chars: d[ch['fontname'].split('+')[-1]] += ch['text']
    print(i, {f: (len(t) if 'LMRoman' in f else t[:60]) for f, t in d.items()})"
```

Expected: `LiberationSerif` carries **only** math glyphs (`π ρ ∂ > = +` etc.) and
appears **only** on pages with equations. `OpenSymbol` on page 1 is the `*`
acknowledgment marker, not a fallback. If Liberation shows up on a page with no
math, something else is wrong — that is a real bug, not this limitation.

Spacing is likewise verified from the XML, not by eye: every relevant style
(`BodyText`, `FirstParagraph`, `FootnoteText`, `Bibliography`, `Abstract`,
`TableNote`) must carry `w:line="480"` (double); `240` would be single.

### Getting a correct-math PDF from a Linux box

Use **`word-render`** — the QEMU Windows guest driven over SSH (nix module
`programs.wordRender`, see `~/nix/modules/shared/word-render/README.md`). It is
the only path on Linux that gets body text *and* math right:

```bash
word-render OUT.docx OUT.pdf
```

Verified on the sample: `LMRoman10-{Regular,Bold,Italic}` +
`LatinModernMath-Regular`, no Cambria/Calibri.

**A fresh guest renders Cambria/Calibri and needs a one-time font install** —
`word-render-install-fonts`. Stock `lmodern` does *not* work: Word will not
render CFF-flavoured OpenType, and it matches families on name ID 1, where
Latin Modern stores the optical size (`LM Roman 10`) rather than the
typographic family. Nix builds a converted/renamed set; the README has the full
diagnosis.

Other options:

- **Ship the .docx.** JLE/JLS/JLEO take Word submissions and the file is
  correct, so the editor's Word renders it properly regardless of your preview.
- **A Mac with Word** — but **not over SSH**: macOS TCC blocks it and cmux
  dispatch can't rescue a remote invocation. See the **docx-render** skill,
  "Driving the Mac's Word from another machine over SSH." Prefer `word-render`.
- **LaTeX preview for reading only.** `tectonic` via pandoc gives faithful Latin
  Modern on Linux, but it is **not** the submission artifact and diverges from
  the .docx.

## Figures: vector, via `svgBlip`

Reference the **PNG** in markdown — `![caption](~/figures/fig1.png)` — and keep a
same-stem `.svg` beside it. After pandoc, the build finds each embedded raster,
matches it to its SVG **by content hash** (pandoc rewrites media to `rIdN.png`,
so the filename is gone by then), and attaches the vector:

```xml
<a:blip r:embed="rIdPng">
  <a:extLst>
    <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
      <asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"
                    r:embed="rIdSvg"/>
    </a:ext>
  </a:extLst>
</a:blip>
```

Word 2016+ draws the SVG with its own renderer; everything older falls back to
the PNG. No sibling `.svg`, no change — raster-only projects are unaffected.

The SVG is looked for beside the **source files** (the L&E layout keeps
`figure1.png` next to `paper.md`) as well as under the project's `figures/` and
`drafts/`, so both the single-file and the `PROJECT_DIR` invocation find it.

**Never reference a bare `.svg` from markdown.** Pandoc embeds it as an image
part with no `svgBlip`, `unzip -l` shows the media happily, and Word renders
*nothing* — blank space under the caption, no error at any stage.

**Never convert SVG→EMF with LibreOffice as a substitute.** EMF is a real vector
format and Word draws it, so the route looks correct. It is not: LibreOffice's
SVG importer silently corrupts complex figures. A five-facet histogram came back
missing an entire facet row, every row label, both axis labels, the tick numbers
and the zero line — still a plausible-looking chart, so nothing downstream
flagged it. Simple one-panel figures convert fine, which is what makes it
dangerous: verifying one figure proves nothing about the rest.

**Verification** — count images in the RENDERED PDF, never in the DOCX:

```bash
pdfimages -list manuscript.pdf | tail -n +3 | wc -l   # 0 == every figure is vector
```

A media part exists for formats Word cannot draw, so a `word/media/` count is not
evidence the figure reached the page. Check the most structurally complex figure
against its source, not the first one.

## Verification gate — before you claim the build is done

IDENTIFY the output → RUN the render → READ the pages → VERIFY → CLAIM.

1. Render: `python3 scripts/doc_render.py OUT.docx OUT.pdf` (`--renderer word`
   for anything a human reads — see the **docx-render** skill's Iron Law).
2. Rasterize: `pdftoppm -r 110 -png OUT.pdf pg`.
3. **Look at the pages** with the **visual-verify** skill. Check: body font is
   Computer Modern (not a Times fallback); lines are double spaced; sections read
   `1.`, `1.1.`; References and Appendix headings carry **no** number; the table
   is a real grid with booktabs rules and no word broken mid-token; the figure
   rendered; the `*` acknowledgment note is on page 1.
4. Only then report the path.

**`pandoc` exiting 0 is not verification.** It exits 0 on a document with a
missing figure, a collapsed table, and Calibri fallback.

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| About to run `pandoc -o out.docx` yourself → **STOP** | No template, no citeproc, no reference list; wrong on four JLE requirements at once | `build_le_docx.py` |
| About to use `law-review-docx` for an L&E paper → **STOP** | Footnote/Bluebook citations, small caps, TOC — wrong discipline and wrong citation model | This skill |
| About to write `# 1. Introduction` → **STOP** | Word adds its own number: "1. 1. Introduction" | `# Introduction` |
| About to put a bare citation in a footnote → **STOP** | JLE: footnotes must be substantive; simple citations go in the text | `[@key]` inline |
| About to add cases to the `.bib` → **STOP** | JLE: "Do not include cases in the reference list" | Cite in text: `(332 U.S. 392 [1947])` |
| About to build with `--spacing single` for a submission → **STOP** | Desk-reject risk; double spacing is explicit and non-negotiable | Default `double` |
| About to report success on "pandoc exited 0" → **STOP** | Exit 0 hides missing figures and collapsed tables | Run the verification gate |
| About to edit the template in Word → **STOP** | Next regeneration silently reverts it | Edit `make_le_template.py` |

## Related skills

Part of the **[document skill group](../../references/document-skills.md)**:

- **law-review-docx** — same *machinery*, law review *policy* (Bluebook footnote
  citations, TOC, Times/small caps). `build_le_docx.py` imports its helpers;
  see that script's header for why this is a sibling and not a `--style` flag.
- **docx-render** — .docx → PDF (`--renderer word` for deliverables).
- **docx-repair** — repairs a cloud-editor-damaged .docx.
- **docx** (generic) — edits docx content (tracked changes, comments).
- **visual-verify** — required by the verification gate above.
