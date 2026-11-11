---
name: expert-report-docx
description: "Use this skill to BUILD the served Word file of an EXPERT REPORT for litigation from markdown drafts — page-1 court caption, numbered paragraphs, Bluebook supra/Id./hereinafter footnotes. Triggers: 'build the expert report docx', 'export the report to Word', 'rebuttal report Word file', 'surrebuttal docx', 'make the served version of the expert report', 'the expert report caption looks wrong', 'the footnotes in the report docx look off'. NEGATIVE ROUTING: NOT 'law-review-docx' (law review articles: title page, TOC, Bluebook law-review CSL), NOT 'law-econ-docx' (author-date manuscripts for JLE/JLS/JLEO), NOT 'docx-typst' (source is Typst, not markdown), NOT the generic 'docx' skill (edits docx content), NOT 'docx-render' (renders an existing docx to PDF/PNG only)."
user-invocable: true
---

# Expert Report DOCX Export

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Builds the served form of an expert report from `drafts/*Draft*.md`: caption on page 1, text
starting under it, no running header, numbered paragraphs, real Word footnotes with Bluebook short
forms. The layout values are measured from a served reference report
(`docs/investigations/2026-11-10_expert-report-template.md`).

**This is the only correct way to build the report's .docx — never hand-roll `pandoc`.** Agents
without the `Skill` tool run the script directly:

## Usage

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/build_docx.py PROJECT_DIR [--output PATH] \
    [--caption FILE] [--bib FILE] [--draft-header] [--exhibits DIR] [--pdf] \
    [--typography smallcaps|plain]
```

| Flag | Default |
|---|---|
| `--output` | `PROJECT_DIR/output/expert-report.docx` |
| `--caption` | `PROJECT_DIR/caption.yaml`, then `caption:` in the frontmatter of the writing plan (`.planning/*.md` with `workflow: writing`); none → warning, no caption |
| `--bib` | `PROJECT_DIR/references/sources.bib`, else the only `references/*.bib` |
| `--draft-header` | off: no header, as served. On (or `draft_header: true` in the caption) adds "DRAFT, PRIVILEGED AND CONFIDENTIAL" |
| `--exhibits` | none. A directory, lettered in filename order (or caption `exhibits:` list); `.md` rendered (lists as Ordinal Point paragraphs), `.pdf`/`.docx` listed by name, each after an `EXHIBIT A` slip page |
| `--pdf` | off. Renders through real Word in the Windows guest (docx-render `word-remote`), never another engine; exits non-zero unless the Producer is Microsoft Word, every text font is Times New Roman, and the PDF holds this document's text (the guest has one job slot, no lock). Reports producer, fonts, page count, `[@` left, placeholders |
| `--typography` | caption `typography:`, else `smallcaps` (as served: journals, books, firm memos in small caps). `plain` = court-document style: those roman, book and memo titles italic |

The pipeline: law-review-docx's combining (section order, frontmatter strip, footnote-label
prefixes, `<!-- include: PATH -->`) → bib to CSL JSON, normalised → pandoc `--citeproc` with
`assets/bluebook-expert-report.csl` to the JSON AST → AST pass → pandoc to docx with
`references/templates/expert_report_template.docx` → OOXML pass → checks.

## Draft conventions the build reads

| In the draft | Becomes |
|---|---|
| `# I. TITLE.` / `## A. TITLE.` | Part / lettered heading, numeral + tab |
| `1\. Text` | numbered paragraph: number at 0.5", tab to 1.0" |
| `*First*, …` (unnumbered) | ordinal point: bullet, single-spaced |
| `> quote` | Block Text |
| `:::: {.continuation}` … `::::` after a block quote | the paragraph continues: Body Text, flush left (`w:firstLine="0"`), never numbered even if it opens with digits |
| `\* \* \* \*` | centred four-asterisk break |
| `[TO SUPPLY: …]` | yellow highlight, body and footnotes, counted |
| `[@key, at 4 ¶ 4]`, `[@key, at *3]` | citation with its pin printed once |
| short lines after the last numbered paragraph | signature block: lines naming the expert or "signature" at 4", the rest (date) flush left. No such lines → generated from caption `expert` and `date` |

## Caption YAML

```yaml
court: |                       # centred, bold
  UNITED STATES DISTRICT COURT
  DISTRICT OF DELAWARE
plaintiffs: [ACME WIDGET CO., ET AL.,]    # or `matter:` lines for an In re caption
defendants: [GLOBEX INDUSTRIAL CORP., ET AL.,]
plaintiffs_label: "Plaintiffs,"           # optional; default shown
defendants_label: "Defendants."
case_number: "CASE NO. 1:24-cv-00999-UNA"
report_title: |                # bold, right column
  REBUTTAL REPORT OF
  PROFESSOR JANE Q. PUBLIC
expert: "Jane Q. Public"       # typed signature name
date: "November 10, 2026"
draft_header: false
typography: smallcaps          # or plain; --typography overrides
exhibits: [exhibits/a.md]      # relative to this file
```

## Template (generated — never edit in Word)

`scripts/make_template.py` builds the template from `pandoc --print-default-data-file
reference.docx`; rerun it after changing a value. `build_docx_test.py` fails when the shipped
template is stale.

| Style / part | Value (served measurement) |
|---|---|
| Page | Letter, 1" margins, footer 0.5", page 1 numbered, no header |
| Normal | Times New Roman 12, single, 0 after |
| Body Text / First Paragraph | double (27.6 pt), justified, first line 0.5" |
| Heading 1 | bold caps, flush left, numeral at 0", text and wraps at 0.5", one blank line above and below |
| Heading 2 | bold caps, letter at 0.5", text and wraps at 1.0" |
| Block Text | single (13.8 pt), 0.5" each side, blank line after |
| Footnote Text | 10 pt, exact 11.5 pt, 0 before/after, first line 0.5", wraps at margin, justified |
| Footnote Reference | superscript (Word: 8 pt in body, 6.5 pt in notes) |
| Separators | 2" separator, full-width continuation separator, 11 pt single paragraphs; Calibri runs (Word draws the served 0.72 pt rule) |
| Footer | centred 11 pt PAGE, then an empty 11 pt paragraph |
| Caption | 2 × 4788-twip table at tblInd 0: bottom rule under the left cell + inside rule = bracket at x 66–306 |
| Compat | Word 2010 mode (14), as served: full-width continuation separator, border hung 0.075" left of the caption text |
| Placeholder, Asterisk Break, Ordinal Point, Signature (4"), Signature Date, Exhibit Title | custom styles |

## Citations

Bluebook notes from the CSL — never a hand formatter. Titles print as written; `note` and
`annote` never print; `shorttitle` drives `[hereinafter X]` (after the pin) and
`X, supra note N, at P`; `Id.` is capitalised at a sentence start. A firm memo prints firm,
title and date — a bare `type` genre label never prints. A `§` pin on a statute title that ends
in a section replaces that section. Hyphens in docket numbers become non-breaking
(`w:noBreakHyphen`) in body and notes, and so does the space after `§`/`§§` (U+00A0). The field each source type needs is in
`references/bib-conventions.md` — read it before building against a new bib. A legacy-shaped
bib (`@misc` types, `reporter`, `howpublished`, `author` on releases, captioned statute titles)
is accepted as it stands: `normalize_csl` maps it in memory, additive fields winning
("Legacy-shaped entries" there). A WL cite kept only in `note` still never prints, and nothing
looks a reporter up: a cite added to an entry is checked against the opinion's date and court. The build strips pandoc's
paren-wrap of non-initial citations in a footnote (law-review-docx: "Pandoc-Citeproc Paren-Wrap
Inside Footnotes").

## Metadata

Every build strips metadata, always (no flag; `scripts/strip_metadata.py`): empty core.xml, no app.xml statistics/Template/Application, no custom.xml, no rsids, no zip dates; `--pdf` then keeps only Creator and Producer in the Word PDF, before the Producer check. Read the printed `Metadata stripped:` and `PDF metadata stripped:` lines.

## Verification

The build exits non-zero, naming the strings, when a citation key is missing from the bib, when
any `[@` survives in `document.xml` or `footnotes.xml`, or when the Word footnote count differs
from the drafts' `[^id]:` definitions (a citation outside a footnote becomes an extra note).
Then:

1. Read the printed counts: `Footnotes: N (definitions: N)`, `Placeholders: K`.
2. Build with `--pdf`; check `PDF [@ left: 0`, `PDF producer: Microsoft® Word for Microsoft 365`
   and `PDF fonts:` all `TimesNewRomanPS*`. Word unreachable → the build fails naming the fix:
   `docker start omarchy-windows`, then wait for `ssh word@winvm` (a cold boot takes minutes).
3. Look at page 1 and one footnote page of the PDF (`look_at.sh --backend claude`).

Tests: `uv run --with pytest --with pytest-xdist --with pyyaml python3 -m pytest -q -n 2 ${CLAUDE_SKILL_DIR}/scripts/build_docx_test.py`. The Word integration test skips, saying so, when `ssh word@winvm` is unreachable.

## Red Flags

| About to | Why wrong | Do instead |
|---|---|---|
| Run `pandoc` without the template, or hand-roll the docx | Default Calibri styles, no caption, no number+tab, footnote marks and separators wrong | Run `build_docx.py` |
| Hand-format citations or post-edit footnote text | Loses `supra`/`Id.` positions; every edit desyncs on the next build | Fix the bib fields per `bib-conventions.md` and rebuild |
| Edit the bib note to make a WL cite print | `note` never prints | Put it in `volume`/`journaltitle`/`pages` |
| Attach a reporter cite matched by case name | An affirmance or reversal shares the caption | Match the opinion's date and court first |
| Serve a build with `--draft-header` on, or `draft_header: true` in the caption | The served report has no header | Build without it; check the printed `Header: none` |
| Serve with `Placeholders:` above 0 | Yellow `[TO SUPPLY]` text goes to opposing counsel | Resolve every placeholder first |
| Copy case text, party names or facts into `fixtures/` or this repo | Protective-order and case material in a shared plugin repo | Synthetic parties only (ACME WIDGET CO.) |
| Render the PDF with any engine but Word, or trust a PDF whose Producer is not Microsoft Word | Layout, footnote marks, separators and fonts differ from the served Word output; a non-Word PDF is never evidence | `--pdf` (word-remote) only; fix the guest when it is down |
| Send pages of a real report to a non-Claude vision model | Protective-order material | `look_at.sh --backend claude` only |
| Edit `expert_report_template.docx` in Word | The next `make_template.py` run silently reverts it | Change `make_template.py` and regenerate |
