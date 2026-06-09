---
name: writing-topic-sentences
description: Topic sentences must state substance — no meta-commentary or throat-clearing openers
applies-to: [writing-draft, writing-review, writing-revise]
---

## Rule

Every paragraph's opening sentence must state the point directly. Topic sentences that describe the paragraph, announce what's coming, or tell the reader how to react are meta-commentary and must be cut or rewritten.

## Rationale

AI drafting agents produce formulaic topic sentences that comment on the content rather than delivering it. The user flagged this as the single biggest prose quality problem: "the topic sentences are just so bad." These sentences waste the reader's time and signal AI generation.

Observed failure modes (all from the same drafting run):
- "The headline result is stark."
- "The number deserves context."
- "Two structural features of Table 2 deserve emphasis."
- "This is not an overstatement."
- "The comparison to full abstention makes the point sharper."
- "This pattern intensifies as the investor block broadens."
- "A natural concern is that..."
- "The empirical evidence confirms that..."
- "This structural result has an intuitive explanation."
- "The distinction between X and Y matters."
- "The temporal dimension reinforces this interpretation."

Pattern: these all describe the *paragraph's role* rather than making the *paragraph's point*.

## Examples

Wrong → Right:

| Meta-commentary opener | Substantive opener |
|------------------------|-------------------|
| "The headline result is stark." | (Cut — go straight to the result.) |
| "The number deserves context." | (Cut — give the context directly.) |
| "Two structural features deserve emphasis." | "Mirror pro-rata is the only scenario in which..." |
| "This is not an overstatement." | (Cut entirely.) |
| "The comparison makes the point sharper." | (Cut — state the comparison.) |
| "A natural concern is that X." | State X directly, or state the data that addresses X. |
| "The empirical evidence confirms that..." | "[Author] show that..." or state the finding. |
| "This structural result has an intuitive explanation." | State the explanation. |

## Detection Heuristic

Flag paragraph-initial sentences containing:
- "deserves context/emphasis/attention/mention/noting"
- "is striking/remarkable/notable/worth underscoring"
- "is not an overstatement"
- "makes the point"
- "is instructive/telling/revealing"
- "has [a/an] [intuitive/structural/simple] explanation"

These are high-confidence indicators. Not exhaustive — review should also apply judgment to catch variants.

## Topic-Sentence Facts

- Meta-commentary openers are a textbook/AI register, not good academic writing — Volokh ch. 4 covers cutting this filler. Signposting is done with substance: the topic sentence IS the frame, and a frame without substance is filler.
- The opening sentence sets the reader's expectation for the paragraph; it should be the strongest sentence in it, not throat-clearing.
