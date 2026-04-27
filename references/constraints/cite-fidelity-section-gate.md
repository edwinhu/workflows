---
name: cite-fidelity-section-gate
description: Before writing-revise declares COMPLETE, every drafts/*.md must have a corresponding .planning/CITES-{section}.md with status PASSED — Stage 3 hard gate.
applies-to: [writing-revise]
type: convention
---

# Stage 3 cite-check hard gate

If `.planning/ACTIVE_WORKFLOW.md` declares an `nlm_notebook`, writing-revise
MUST run Stage 3 of the cite-fidelity pipeline before marking the workflow
COMPLETE:

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/scripts/cite-fidelity/check_section_cites.py --all
```

The script writes `.planning/CITES-{section}.md` per draft section with
frontmatter `status: PASSED` (zero UNSUPPORTED) or `status: FAILED` (any
UNSUPPORTED). It exits 1 on FAILED unless `--allow-unsupported` is passed.

## Iron Law: NO COMPLETE WITHOUT CITES-PASSED

writing-revise's Step 6 verdict logic must check, for every `drafts/*.md`:
- Corresponding `.planning/CITES-{slug}.md` exists
- Frontmatter shows `status: PASSED`

If any section is missing or FAILED, the verdict cannot be COMPLETE — push
back to revise to fix UNSUPPORTED cites. This is a per-section hard gate,
not a soft block.

## Why

Stage 1 (source inventory) + Stage 2 (per-claim grounding) + Stage 4 (lint)
catch most cite-fidelity issues during drafting. Stage 3 is the
belt-and-suspenders check: a fresh per-section NLM round-trip that catches
anything that slipped through. The mirror_voting baseline run dropped from
39% UNSUPPORTED to ~3% after Stage 3 was wired into revise.

## When NOT to gate

- Project has no `nlm_notebook` field — there is no notebook to verify
  against; skip the gate and rely on conventional review.
- User explicitly opts out via `--allow-unsupported` (record the override
  in `.planning/REVIEW_STATE.md` notes).

## What writing-revise should do

1. Read `.planning/ACTIVE_WORKFLOW.md` — does it have `nlm_notebook`?
2. If yes, before declaring COMPLETE:
   - Run `check_section_cites.py --all`
   - For each `drafts/*.md`, verify `.planning/CITES-{slug}.md` shows
     `status: PASSED`
   - If any FAILED → return to Step 4 (Fix Issues), addressing UNSUPPORTED
     cites
   - If all PASSED → proceed to COMPLETE
3. If no notebook, skip the gate and continue with the existing flow.
