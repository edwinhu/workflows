# Prose Rhythm & Flow Rubric

Five dimensions per paragraph, each 1–10. Overall = geometric mean across paragraphs (penalizes the worst paragraph more than arithmetic mean would).

## Dimensions

### 1. Rhythm — sentence-length variation
What it measures: variance in sentence length within the paragraph. Academic prose reads well at mean ~22 words with stdev ~10.

| Score | Pattern |
|---|---|
| 9–10 | Strong variance with purpose; long sentences carry argument, short sentences punctuate or land claims |
| 7–8  | Healthy variance; no over-long or over-short patches |
| 5–6  | Some variance, but stretches of uniform sentence length (3+ similar-length sentences in a row) |
| 3–4  | Mostly uniform — all short ("choppy") or all long ("breathless") |
| 1–2  | Every sentence the same shape; reads as a model summary |

### 2. Flow — connective tissue between sentences
What it measures: how the sentences within the paragraph connect. Whether each sentence picks up where the previous one left off, vs. starting cold.

| Score | Pattern |
|---|---|
| 9–10 | Each sentence advances a thread the prior one set up; transitions feel inevitable, not announced |
| 7–8  | Mostly smooth; one or two transitions feel abrupt |
| 5–6  | Sentences feel independent; reader has to do the connective work |
| 3–4  | Reads like a list of facts about a topic; no through-line |
| 1–2  | Sentences could be reordered without loss |

### 3. Topic sentence — does sentence 1 make a load-bearing claim?
What it measures: whether the first sentence carries the paragraph's substantive point, or editorializes about what's coming.

| Score | Pattern |
|---|---|
| 9–10 | Sentence 1 makes a falsifiable, substantive claim; the rest of the paragraph defends it |
| 7–8  | Sentence 1 carries content, with mild meta-framing |
| 5–6  | Sentence 1 introduces a topic without taking a position ("This Part examines...") |
| 3–4  | Meta-commentary ("The number deserves context", "It is striking", "Notably,...") |
| 1–2  | Pure bookmark ("In what follows, we...") |

### 4. Closure — does the final sentence land the paragraph's point?
What it measures: whether the paragraph ends on its strongest beat or trails into a roadmap, hedge, or verdict-without-follow-through.

| Score | Pattern |
|---|---|
| 9–10 | Final sentence is the paragraph's hardest beat; carries forward into the next paragraph by implication, not by announcement |
| 7–8  | Strong ending; minor improvement possible |
| 5–6  | Functional ending but missable; paragraph's strongest sentence is in the middle |
| 3–4  | Trails into a roadmap ("Part X does Y"), a hedge ("it is difficult to argue..."), or a verdict without follow-through ("The result is a system that satisfies no one.") that loses force without a hinge |
| 1–2  | Ends in mid-thought, on a fragment, or on a sentence that contradicts the paragraph's point |

### 5. Sentence variety — structural diversity
What it measures: mix of simple, compound, complex, and compound-complex constructions; subject variety; clause arrangement.

| Score | Pattern |
|---|---|
| 9–10 | Wide structural variety; subjects vary; clauses arranged for emphasis (long subordinate before short main, or vice versa, used purposefully) |
| 7–8  | Good variety with occasional repetition |
| 5–6  | Limited variety — most sentences share a structure (S-V-O, or "It is X that...", or three consecutive sentences with the same subject) |
| 3–4  | Pattern visible — every sentence the same shape (e.g., "X is Y. X is Y. X is Y.") |
| 1–2  | Mechanical repetition |

## Overall Score

```python
overall = (rhythm × flow × topic × closure × variety) ** (1/5)
```

Geometric mean. A 9-9-9-9-3 paragraph scores 6.7, not 7.8 — closure failure is the bottleneck. This pushes the loop to fix the worst dimension instead of polishing the best.

Across paragraphs, the document overall is the geometric mean of paragraph overalls. Same logic: one bad paragraph drags the doc score down more than it would under arithmetic mean.

## Threshold

- **Target:** `overall ≥ 9.5` (≈ every paragraph scores 9.0+ across all dimensions, or one paragraph at 9.5 with the rest at 9.5+)
- **Max iterations:** 3
- **Regression alarm:** any paragraph drops ≥2 points from prior iteration → pause and surface

## Why geometric mean

A paragraph with rhythm=10, flow=10, topic=10, closure=4, variety=10 has an obvious problem: the closure is broken. Arithmetic mean gives 8.8 (looks fine). Geometric mean gives 7.9 (flags the broken dimension). The loop should chase fixes that lift the worst dimension, not over-polish dimensions already at 9-10.

Same logic across paragraphs: 6 paragraphs at 9.5 and 1 paragraph at 5.0 should score lower than 6 at 9.0 and 1 at 8.0, because the broken paragraph is more visible to a reader than the merely-good ones are good.
