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
this frontmatter schema:

```yaml
status: PASSED | FAILED       # FAILED iff unsupported > 0
section: <section name>
total_cites: <int>            # equals the sum of the six count fields
unsupported: <int>
partial: <int>
supported: <int>
unclear: <int>                # parse failures or unrecognised NLM status
not_in_notebook: <int>        # bibkey is not an NLM source
error: <int>                  # NLM call failed after retries
```

`total_cites = unsupported + partial + supported + unclear + not_in_notebook + error`
— any frontmatter-keyed gate must read all six count fields, not just the
first three.

The script exits 1 if any section is FAILED OR the total UNSUPPORTED
across sections is > 0, unless `--allow-unsupported` is passed.

**Cite-free sections.** Drafts with zero `[@bibkey]` references (e.g.,
Conclusion, Appendix) still get a CITES file emitted with
`status: PASSED` and all-zero counts, so the writing-revise Step 6a
"matching CITES file exists" assertion holds for every draft.

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
