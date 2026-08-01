---
name: law-review-docx
description: "Use this skill to BUILD a formatted Word document from law review / legal MARKDOWN drafts via the law_review_template + pandoc (footnotes, TOC, styled tables) — NOT the generic 'docx' skill (which edits docx content) and NOT 'docx-render' (which only converts an existing .docx to PDF). Triggers: 'generate a docx', 'create the Word file', 'export to docx', 'build the document', 'compile/finalize the draft', 'build the law review document', 'make a Word version', 'turn my markdown draft into Word', 'make the submission docx', 'apply the law review template'."
user-invocable: true
---

# Law Review DOCX Export

Convert markdown drafts into a properly formatted Word document using the law review template via pandoc.

**This is the ONLY correct way to build a law-review .docx — never hand-roll
`pandoc`/`soffice`; the template, footnote handling, TOC, and table styling all
live in `build_docx.py`.** Agents **without the `Skill` tool** (most workflow
subagents) can't invoke this skill — run the script below directly:

## Usage

```bash
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/build_docx.py PROJECT_DIR [--output PATH] [--fix-footnotes]
```

The script:
1. Detects title/author from `.planning/ACTIVE_WORKFLOW.md` or `PRECIS.md`
2. Combines all `drafts/*Draft*.md` files in section order (Introduction → Parts → Conclusion → Appendix)
3. Strips YAML frontmatter and prefixes footnote labels to avoid cross-section collisions
4. Resolves `<!-- include: PATH -->` sentinels by inlining file contents (paths must be absolute or `~`-expanded)
5. Runs pandoc with `--reference-doc` pointing to the law review template
6. Optionally runs the docx-repair repair script (`--fix-footnotes`)

## Compile-Time Includes

To embed externally generated tables or fragments at build time, place a sentinel in the draft:

```markdown
<!-- include: ~/projects/mirror/data/tables/paper/table2_body.md -->
```

The preprocessor expands `~`, reads the file, and splices its contents inline before pandoc runs. Missing or non-absolute paths emit a visible `<!-- MISSING: ... -->` placeholder instead of failing silently. For images, use plain pandoc markdown (`![caption](~/path/to/figure.png)`) — no sentinel needed.

## Detecting the Project Directory

If the user doesn't specify a path, detect it from context:
1. Check if current working directory has `drafts/` and `.planning/`
2. Check if `.planning/ACTIVE_WORKFLOW.md` exists and read `project_dir` from it
3. Follow symlinks (e.g., `paper` → actual project directory)

## Template

The reference template lives at:
```
${CLAUDE_SKILL_DIR}/../writing-legal/templates/law_review_template.docx
```

This template defines all styles that pandoc applies:

| Style | Use | Formatting |
|-------|-----|------------|
| **Title** | Article title | Bold, small caps, centered |
| **Heading 1** | Part titles (I., II., III.) | Bold, left-aligned |
| **Heading 2** | Sections (A., B., C.) | Bold, left-aligned |
| **Heading 3** | Subsections (1., 2., 3.) | Italic, left-aligned |
| **Body Text** | All body paragraphs | First-line indent |
| **First Paragraph** | After headings | No indent |
| **Footnote Text** | Footnotes | 10pt, single-spaced |

## Figures: vector, via `svgBlip`

Reference the **PNG** in markdown — `![caption](~/figures/fig1.png)` — and keep a
same-stem `.svg` beside it. After pandoc, `build_docx.py` finds each embedded
raster, matches it to its SVG **by content hash** (pandoc rewrites media to
`rIdN.png`, so the filename is gone by then), and attaches the vector:

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

## After Export

Report the output path, section count, footnote count, and approximate word count. If the user needs further formatting (NOTEREF cross-references, footnote repair from cloud editing), suggest `--fix-footnotes` or the `docx-repair` skill.

### Typographic Widows

`build_docx.py` sets Word's paragraph-level `widowControl`, which prevents a
paragraph's last line from landing alone on the next *page* — it does nothing
about a last *line* holding one or two stray words. Two companion scripts
handle that, after compiling to PDF:

```bash
# Report widows (paragraph last lines of 1-2 short words, main column only)
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/check_widows.py OUTPUT.pdf [--max-words N] [--verbose]

# Same detection, then bind the last two words in the offending drafts/*.md
# paragraph with a pandoc non-breaking space. Recompile afterwards.
uv run python3 ${CLAUDE_SKILL_DIR}/scripts/fix_widows.py OUTPUT.pdf PROJECT_DIR [--dry-run]
```

Run `--dry-run` first: `fix_widows.py` edits source markdown, and the fix is
only meaningful against the PDF it was measured on. Iterate compile → check →
fix → recompile.

## Rendering to PDF (Word fidelity, incl. from background jobs)

`build_docx.convert_to_pdf()` delegates to `doc_render.convert(renderer="word")`,
which uses Microsoft Word's engine for line-exact layout (best for widow detection)
and faithful tables.

Note on table fidelity: for tables this skill *builds*, the `wrap_cell` pass (see
`style_tables`) already pre-breaks cells with explicit `<w:br/>` so soffice and
x2t render the grid too (commit `ec349c5`), and x2t kerning is corrected by
`doc_render`'s GPOS/kern injection + EB-Garamond substitution. So all three
engines are grid-faithful for build-generated tables; Word is preferred for
polish, not required for table integrity. Word matters most for *hand-authored*
docx whose tables never pass through `wrap_cell` — LibreOffice collapses such a
table to a single stacked column whenever a cell must auto-wrap (Word/x2t keep the
grid).

Word is GUI-driven, so a **detached Claude background job** can't drive it directly
(AppleEvents fail with -600 — it's in a non-console GUI session without Word's TCC
grant). `doc_render` handles this transparently by dispatching the render into a
**cmux pane** (which lives in the console GUI session and is TCC-granted). One-time
host prerequisites:

- cmux socket control enabled: `automation.socketControlMode` ≠ `"cmuxOnly"` in
  `~/.config/cmux/cmux.json`, then `cmux reload-config`.
- Microsoft Word granted to cmux under System Settings → Privacy & Security →
  Automation, and Word in Full Disk Access.

Set `$DOC_RENDER_NO_CMUX=1` to disable the cmux path (then background jobs fall
back to x2t/LibreOffice). See `docs/investigations/2026-06-22_word-render-cmux-dispatch.md`.

## Known Gotcha: Pandoc-Citeproc Paren-Wrap Inside Footnotes

**Symptom.** In the compiled DOCX, some footnotes read with a doubled space
and wrapping parens around a citation:

```
see  (Griffin, supra note 12; Macey, supra note 12). For proponents...
```

(note the two spaces before `(`).

**Root cause.** Pandoc-citeproc wraps any bracketed parenthetical citation
`[@key]` or `[signal @key]` in parens with a leading space when it appears
*mid-paragraph inside a footnote body*. At the paragraph start the wrap is
suppressed; mid-paragraph it is not. This is native pandoc behavior for
note-style CSLs and cannot be fixed at the CSL level.

**Why the natural-looking fix doesn't work.** Rewriting source to bare
textual form (`@key` without brackets) renders cleanly *only if* every
citation has a locator. For bib entries without locators (books, misc,
many articles), pandoc-citeproc with a note-style CSL emits just a stray
number (`1.`) because the full cite is supposed to go into a footnote and
there is no footnote to host it (we're already inside one).

**Fix.** The `docx-repair` skill's `fix_footnotes.py` detects and strips
these wraps post-compile. The detector keys on the distinctive XML
signature:

```xml
<w:r><w:t xml:space="preserve"> </w:t></w:r>     <!-- natural space -->
<w:r><w:t xml:space="preserve"> </w:t></w:r>     <!-- EXTRA space -->
<w:r>…<w:t>(Author,</w:t></w:r>                  <!-- open paren run -->
… citation content …
<w:r>…<w:t>)</w:t></w:r>                         <!-- close paren (standalone or attached) -->
```

Author-written explanatory parentheticals (`(describing X)`, `(documenting Y)`)
appear as a single `<w:t> (…)</w:t>` run and lack the double-whitespace
signature, so they are preserved. `build_docx.py` runs `fix_footnotes.py`
automatically when `--fix-footnotes` is set (the default).

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Running `pandoc -o output.docx` without `--reference-doc` | Produces default Calibri formatting that violates journal requirements | Always use the template |
| Manually constructing the DOCX with python-docx or docx-js | Reinvents what the template + pandoc already handle | Run the script |
| Combining markdown without prefixing footnote labels | Causes footnote collisions when multiple sections use `[^1]` | The script handles this automatically |
| Referencing a bare `.svg` from markdown | Pandoc writes no `svgBlip`, so Word renders nothing — blank space under the caption, no error | Reference the PNG; keep the `.svg` beside it and let the build attach it |
| Converting SVG→EMF with LibreOffice to get vector into Word | Its SVG importer silently drops facet rows, row labels, axis labels and reference lines from complex figures | Use the `svgBlip` path the build already implements |
| Confirming figures embedded by counting `word/media/` entries | A media part exists for formats Word cannot draw | `pdfimages -list` the rendered PDF |
| Declaring the figure pipeline verified after checking one figure | Converters that mangle complex figures handle simple ones fine | Verify the most structurally complex figure |
