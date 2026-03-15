---
name: bluebook-audit
description: "Start a Bluebook footnote audit on a law review DOCX manuscript"
allowed-tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Task", "AskUserQuestion"]
---

# /bluebook-audit

Start a systematic Bluebook audit of a law review manuscript.

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
Discover and read the extract phase skill:
```bash
command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/bluebook-audit/lib/skills/audit-extract/SKILL.md 2>/dev/null | sort -V | tail -1
```
Use the output path with `Read()`.
