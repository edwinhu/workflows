---
name: cite-fidelity-source-inventory
description: After ACTIVE_WORKFLOW.md exists with an nlm_notebook, build references/source_summaries.md so drafting can disambiguate same-author works.
applies-to: [writing-setup]
type: convention
---

# Source inventory before drafting

If `.planning/ACTIVE_WORKFLOW.md` has an `nlm_notebook` field set, run Stage 1
of the cite-fidelity pipeline before handing off to writing-outline:

```bash
uv run ${CLAUDE_SKILL_DIR}/../../scripts/cite-fidelity/nlm_source_inventory.py
```

This produces `references/source_summaries.md` — one entry per cited bibkey
with thesis, supports, does-not-support, author, year, and anchor pages. The
file is keyed by NLM `LAST UPDATED` timestamp; running it again is idempotent
and only re-queries sources whose NLM contents changed.

## Why

The dominant cite-fidelity failure mode is misattribution: an author with
multiple cited works (Lund 2017 vs. Lund 2019; Fisch 2018 vs. Fisch 2021) gets
attached to the wrong claim because the agent associates by author + topic
rather than by source content. The inventory grounds drafting in what each
source *actually* says.

## When NOT to run

- The project has no NLM notebook (`nlm_notebook` field absent or empty)
- The notebook is empty or sources are not yet titled by their bibkeys
  (run `nlm_check_coverage --rename-matched` first if available)

## Output

`references/source_summaries.md` is consumed by writing-draft and
writing-revise as a quick lookup before composing footnotes. Treat it as
read-only — re-run the inventory script to refresh it.
