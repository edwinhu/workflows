# Third-party brief — what NOT to flag in this author's prose

*Handed to a non-Claude reviewer as DATA by `beat-third-party`. It is resolved from the bare skill
name `de-ai-revise`; a reviewer reading this is not expected to open anything else, and must not run
the scorers this skill drives — a deterministic audit has already run and its output is the span
list.*

The rest of this skill is a REWRITE loop: audit, then revise flagged spans. You are not revising, so
the half that transfers is the suppression half — the corpus-gated list of things that look like AI
tells and are not. It is the most valuable half, because a second opinion's characteristic failure is
false positives on a register it has not calibrated to.

## The Iron Law of Goodhart

**The scorers guide; they do not grade.** A span flagged by a scorer is a question, not a verdict.
Mechanically chopping sentences, nuking every em-dash, or swapping every flagged word degrades prose
to win a composite. Report a span only when the change would read better to a person.

## Preserve-Human — do NOT report these

- **Em-dashes.** Real legal scholarship, including this author's published work, uses them
  deliberately. Keep the ones that set off a genuine appositive or a deliberate aside. The target is
  *fewer*, never zero, and density alone is not a finding.
- **`dropped`-tier diction** — *significant, robust, leverage, comprehensive*, and their siblings.
  These are legal/finance-normal; the audit already excludes them, and so should you.
- **Quoted text, block quotes, statutory language, party names, code, citations.** Flag at most;
  never propose rewriting someone else's words or a term of art.
- **Footnotes.** They are masked before scoring — citation and legal-normal text — so you will not
  see spans inside them. Do not go looking.
- **British spelling in a genuinely UK-register document.** The spelling check assumes US register.
  For a UK journal or an English court filing, ignore `spelling:british` entirely rather than
  "correcting" an author writing in their own dialect.

## What the flags mean when you do see them

| signal | what it catches | when it is real |
|---|---|---|
| scored AI-tics | phrase/structure tics that passed a ~0-human-rate gate against 14.3M sentences of law and finance prose | almost always — these have no honest use |
| tiered diction | fancy→plain words, tiered by corpus rate | `always_flag` on sight; `cluster` only at 2+ per paragraph; `density` only at saturation |
| stylometrics | rhythm and structure: metronomic runs, opener transitions, nominalisation, burstiness | when the passage reads flat to you, not when a number moves |

A flat number is not a defect. A sentence that made you re-read is.
