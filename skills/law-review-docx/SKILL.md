---
name: law-review-docx
description: "Use this skill when the user asks to 'generate a docx', 'create the Word file', 'export to docx', 'apply the law review template', 'build the document', 'make a Word version', or wants to convert their law review markdown drafts into a formatted .docx file."
user-invocable: true
---

# Law Review DOCX Export

Convert markdown drafts into a properly formatted Word document using the law review template via pandoc.

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
6. Optionally runs the docx-footnotes repair script (`--fix-footnotes`)

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

## After Export

Report the output path, section count, footnote count, and approximate word count. If the user needs further formatting (NOTEREF cross-references, footnote repair from cloud editing), suggest `--fix-footnotes` or the `docx-footnotes` skill.

## Red Flags

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Running `pandoc -o output.docx` without `--reference-doc` | Produces default Calibri formatting that violates journal requirements | Always use the template |
| Manually constructing the DOCX with python-docx or docx-js | Reinvents what the template + pandoc already handle | Run the script |
| Combining markdown without prefixing footnote labels | Causes footnote collisions when multiple sections use `[^1]` | The script handles this automatically |
