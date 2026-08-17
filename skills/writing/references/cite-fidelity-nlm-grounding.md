---
name: cite-fidelity-nlm-grounding
description: When ACTIVE_WORKFLOW.md has an nlm_notebook, every new [@bibkey] should be preceded by a Stage 2 NLM evidence pull and a paste-ready nlm-quote comment.
applies-to: [writing-draft, writing-revise]
type: convention
---

# Ask before you cite

If `.planning/ACTIVE_WORKFLOW.md` declares an `nlm_notebook`, the workflow is
inverted from write-then-cite to **ask-then-write**:

1. Compose the *claim* you intend to make.
2. Identify candidate bibkeys (use `references/source_summaries.md` if Stage 1
   has been run).
3. Run Stage 2 to get the actual supporting passage:

   ```bash
   uv run ${CLAUDE_SKILL_DIR}/../../scripts/cite-fidelity/nlm_footnote_pull.py \
     --claim "TEXT" --keys k1,k2,k3
   ```

4. For SUPPORTED / PARTIAL hits, paste the emitted
   `<!-- nlm-quote @key (anchor): "..." -->` block above the footnote.
5. Write the footnote prose around the *actual* quote, not around what the
   source "probably says."
6. For UNSUPPORTED candidates, do not cite that source for that claim.

## Why

A historical run on a 615-cite legal article showed 39% UNSUPPORTED + 30%
PARTIAL when cites were attached by author/topic association. The same
article post-grounding had ~3% UNSUPPORTED. The Stage 2 round-trip costs
about 10 seconds per claim; the audit-fix cycle for a hallucinated cite
costs hours of rework.

## Iron Law

**No bibkey enters a draft without grounding evidence in scope.** If the NLM
notebook is set and a source isn't in the notebook, either add it or pick a
different source — do not paper over the gap with a hand-typed Bluebook
citation (see `cite-fidelity-no-handtyped`).

## Exceptions

- The project has no NLM notebook (`nlm_notebook` empty) — fall back to
  conventional source-anchored citation.
- The cite is to a primary legal source already in the bib (statute, case,
  regulation) where the source's text is the source itself.
