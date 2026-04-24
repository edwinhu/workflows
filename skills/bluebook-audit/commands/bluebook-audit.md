---
name: bluebook-audit
description: "Start a Bluebook footnote audit on a law review DOCX manuscript"
allowed-tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Task", "AskUserQuestion"]
---

# /bluebook-audit

Start a systematic Bluebook audit of a law review manuscript.

## Step 0: Source-Level Lint (if markdown drafts are available)

If the project has `drafts/*.md` markdown sources (e.g., a writing-workflow
project), run the Bluebook source linter first. It catches issues that are
easier to fix in source than in the compiled DOCX:

- **Signal italicization** — wraps `see` / `see also` / `cf.` / `e.g.` /
  `but see` / `see generally` in `*...*` when adjacent to a Pandoc citation.
- **Stacked footnotes** — flags adjacent `[^1][^2]` references; Bluebook
  prefers merging into a single footnote.
- **Subpart syntax** — flags `Part X §Y` and `§A` style cross-references;
  recommends `Part X.Y` letter notation. Statute cites (`§ 216(1)`,
  `§ 78m(d)`) are correctly skipped.

```bash
# Rewrite signals in place + report stacked footnotes and subpart refs:
uv run "${CLAUDE_SKILL_DIR}/../../skills/bluebook-audit/scripts/bluebook_signal_linter.py" \
  drafts/*.md

# Dry run — report only, no writes:
uv run "${CLAUDE_SKILL_DIR}/../../skills/bluebook-audit/scripts/bluebook_signal_linter.py" \
  --check drafts/*.md
```

Stacked-footnote and subpart-syntax findings require human judgment;
surface them to the user for review rather than auto-fixing.

## Step 1: Identify the DOCX

If the user hasn't specified a DOCX file, ask:

```
AskUserQuestion: "Which DOCX file should I audit?"
```

## Step 2: Set Up Working Directory

Create a `scratch/` directory next to the DOCX for intermediate artifacts:
- `scratch/footnotes_data.json` - extracted footnotes with formatting
- `scratch/audit_findings.json` - all audit findings
- `scratch/AUDIT_REPORT.md` - human-readable report
- `scratch/url_inventory.json` - URLs for archiving
- `scratch/permacc_archives.json` - archiving progress

## Step 3: Begin Phase 1 (Extract)

Read and follow:
Read `${CLAUDE_SKILL_DIR}/../../skills/bluebook-audit/skills/audit-extract/SKILL.md` and follow its instructions.
