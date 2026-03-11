---
name: audit-archive
description: "Phase 6: Archive URLs via perma.cc"
---

# Phase 6: Archive

Archive all non-permanent URLs in footnotes via perma.cc API.

## What This Phase Does

1. Extract URL inventory from footnotes data
2. Deduplicate URLs (same URL across multiple footnotes)
3. Archive each URL via perma.cc API
4. Write perma.cc links back to DOCX footnotes
5. Save progress after each successful archive

## Prerequisites

- Perma.cc API key in `.env` file (at `../../../../../.env` (relative to this skill's base directory) or workflow-level `.env`)
- For institutional accounts: organization folder ID (unlimited archives)
- Free accounts: 10 links/month limit

## Script

Run: `python3 ../../../../../scripts/permacc_archive.py --docx <path> --data scratch/footnotes_data.json`

## Institutional Account Setup

```bash
# Find your organization and folder ID
curl -H "Authorization: ApiKey YOUR_KEY" https://api.perma.cc/v1/organizations/
```

Use the `folder` parameter when creating archives:
```python
requests.post("https://api.perma.cc/v1/archives/", json={
    "url": url,
    "folder": FOLDER_ID,  # enables institutional limits
})
```

## Gate: Exit Archive

- [ ] All non-perma.cc URLs archived
- [ ] perma.cc links written to DOCX
- [ ] `scratch/permacc_archives.json` contains all mappings

## Next Phase

```
Read("../audit-crossrefs/SKILL.md")
```
