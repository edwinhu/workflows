---
name: cite-fidelity-no-bundled
description: A single sentence must not bundle three or more distinct [@bibkey] references — bundled cites promote topic-tag citing where one of the keys is plausibly wrong.
applies-to: [writing-draft, writing-revise]
type: constraint
check: cite-fidelity-lint:bundled-cites
---

# No three-or-more cite bundles in one sentence

Every sentence in a draft (footnote body or main text) must contain at most
two distinct `[@bibkey]` references. A sentence bundling three or more cites
is almost always a topic-tag dump where the writer believes "this topic is
discussed in roughly these places" rather than "this specific claim is
supported by these specific sources."

## Mechanical check

The PostToolUse hook (`cite-fidelity-lint.py`) splits drafts on sentence
boundaries (`.!?\s+` and blank lines), counts distinct bibkeys, and warns
when the count is ≥ 3.

## Why

Topic-tag bundling is the upstream cause of cite misattribution: when three
sources are listed for one claim, the writer rarely verifies that all three
support it. Stage 3 cite-check then flags one or two as UNSUPPORTED, but the
remediation is harder than splitting the sentence in the first place. The
3-cite threshold is empirical — sentences with two cites are usually a
parallel-authority pattern (one main + one cf./see also) which is fine;
sentences with three or more are almost always topic-tagging.

## Remedies

1. **Split the sentence.** Each cite gets its own clause so the supporting
   relation is testable individually.
2. **Demote some cites to a `See, e.g., ...; see also ...` parallel-citation
   block in a footnote.** Bluebook signals make the supporting strength
   explicit.
3. **Drop the weakest cite.** If you can't articulate which specific sub-claim
   each bibkey supports, you don't need it.

This is a WARN, not an ERROR — the hook surfaces it but doesn't block. Use
judgment for parallel-citation patterns in footnotes that are intentionally
broad.
