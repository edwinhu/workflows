# Auditor Brief — Prose Rhythm & Flow

This is the agent prompt template for each iteration of the audit-fix loop. Append the iteration number and the extracted draft path before sending.

---

## Brief

You are auditing the prose rhythm and flow of `{DRAFT_PATH}`. Score each paragraph against the rubric at `.planning/prose-rhythm/rubric.md` (a copy is included below for self-containment).

**Iteration:** {ITERATION}
**Scope:** {SCOPE} (e.g., "Introduction, paragraphs 1–7")
**Threshold:** 9.5/10 overall
**Prior scores file:** `.planning/prose-rhythm/SCORES.md` (read first if it exists, to check for regressions)

### Required output

**One table per iteration, appended to `.planning/prose-rhythm/AUDIT.md`. Format must be machine-parseable.**

For each paragraph in scope:

```markdown
### Paragraph N

| dim | score | notes |
|---|---|---|
| rhythm | 8 | sentence-length stdev 9.3; healthy variance |
| flow | 7 | smooth except sentence 3 starts cold |
| topic | 8 | sentence 1 makes a load-bearing claim |
| closure | 6 | ends on a functional sentence, but the middle sentence is stronger |
| variety | 7 | mostly S-V-O; one subordinate-leading sentence |
| **overall** | **7.2** | geometric mean |

**Diagnosis (1 line):** {biggest single weakness in this paragraph}

**Diagnosis (1 line):** {biggest single weakness in this paragraph}

**Fix suggestion (prose, for human review):** {concrete edit — sentence to move, clause to add, hedge to cut, etc.}
```

After the per-paragraph tables, write an iteration summary:

```markdown
## Iteration {ITERATION} Summary

- **Document overall:** {overall_score} / 10 (geometric mean across paragraphs)
- **Biggest weakness across paragraphs:** {dimension that drags the doc score most}
- **Regressions from prior iter (if applicable):** {paragraphs that scored ≥2 points lower than prior iter, AND a fix was targeted at them last iter; recalibration without targeted fix is NOT a regression}
- **Fix priorities for this iteration:** see structured `fixes:` YAML block below
```

**Required: structured fix-tuple block.** After the summary, emit a YAML code block with `fixes:` for the fixer engine. **The fixer ONLY applies fixes from this block — prose descriptions above are advisory and ignored by the engine.** This is non-negotiable: a prior iteration mis-applied a natural-language "split S5" instruction to the wrong sentence because there was no structured target.

```yaml
fixes:
  - paragraph_index: 6              # 1-based, matches the ### Paragraph N header
    sentence_idx: 2                  # 1-based, optional (use null if insertion)
    dimension: rhythm                # one of: rhythm, flow, topic, closure, variety
    action: "split S2 at first semicolon"  # verb-phrase for human readability
    target_text: "EXACT existing text to replace (must occur exactly once in the docx XML — verify before emitting)"
    new_text: "EXACT replacement text (use \"\" for deletion)"
    rationale: "9w short claim breaks the S2-S3 38w/38w length pair"
    preserve_pin: null               # If target_text overlaps a footnote/bookmark span in PINS.md, set this to the ref_id (e.g. _Ref_fn13) AND describe in rationale how the citation is preserved. Otherwise the fixer REFUSES the edit.

  - paragraph_index: 7
    sentence_idx: 3
    dimension: closure
    action: "tighten dash clause"
    target_text: "the least disruptive of the proposed reforms would have changed almost nothing"
    new_text: "the least disruptive reform would have changed almost nothing"
    rationale: "removes 'of the proposed reforms' to sharpen the beat"
```

**Rules for fix tuples:**

1. `target_text` MUST be present exactly once in the live docx XML. If you cannot verify uniqueness, use a longer context window in the needle. The fixer aborts the entire iteration if any needle is ambiguous.
2. `new_text` may be empty (deletion) but must NEVER contain text that wasn't in the auditor's recommendation.
3. If the target overlaps a footnote/bookmark span in `PINS.md`, `preserve_pin` must name the ref_id AND `rationale` must explain how the citation survives. Otherwise the fixer refuses.
4. Emit at most 4 fixes per iteration. Targeting the 2-3 lowest-scoring paragraphs is plenty — over-fixing risks regressions.
5. If overall ≥ threshold and no regressions detected, emit an empty `fixes: []` list and let the loop COMPLETE via /goal.

**Also append to `.planning/prose-rhythm/SCORES.md`** in this format (parseable):

```yaml
## Iteration {ITERATION} — {ISO date}

| P | rhythm | flow | topic | closure | variety | mean |
|---|--------|------|-------|---------|---------|------|
| 1 | 8 | 7 | 8 | 7 | 7 | 7.4 |
| 2 | 7 | 7 | 8 | 6 | 6 | 6.8 |
| ... |

OVERALL: {score}
```

### How to read paragraphs

The draft is split into numbered paragraphs at `{DRAFT_PATH}`. Each paragraph is delimited by a `### Paragraph N` header. Treat each paragraph as the unit of analysis. Footnotes (`fn-LN` blocks if present) are NOT in scope unless explicitly listed.

### Scoring discipline

- **Be objective.** Two runs with the same rubric should produce the same scores ±0.5.
- **Anchor your scores.** If a paragraph scores 9.5 on closure, the final sentence should be the paragraph's hardest beat. If you'd write "could be improved by adding...", it's not a 9.5.
- **No mean ≥ 9 with a dimension ≤ 7.** The geometric mean enforces this arithmetically; if your scores violate it, you're scoring inconsistently.
- **For prior-iteration regressions:** read `.planning/prose-rhythm/SCORES.md` BEFORE scoring. If a paragraph scored 8.5 last iteration and you're scoring it 6.5 now, that's a regression — flag it explicitly in the summary. The fixer may have introduced collateral damage.

### Scoring anchors

**A 9–10 paragraph reads like this:** A claim-bearing topic sentence; sentence lengths varying purposefully (e.g., 28 / 41 / 33 / 12 words); each sentence picks up a thread from the prior one; the final sentence is the paragraph's strongest beat and creates the conditions for the next paragraph without announcing them. Example markers: a short sentence used for emphasis after a long one; subordinate clauses arranged to defer the strongest noun phrase to the end of the sentence; transitions implicit, not lexical.

**A 5–6 paragraph reads like this:** Stretches of uniform-length sentences (e.g., 5 consecutive sentences all 15–20 words); transitions announced rather than implicit ("Furthermore,", "In addition,"); topic sentence introduces a topic but does not stake a claim ("This Part examines X"); final sentence ends on a roadmap ("Part Y takes up the question") or on a strong claim that has no follow-through hinge.

**A 3–4 paragraph reads like this:** Choppy: many short sentences with no rhythmic purpose; OR breathless: every sentence over 35 words; topic sentence is meta-commentary; closure is broken (grammatical fragment, trailing hedge, abandoned thought); sentences could be reordered without loss.

### Critique-over-comfort

Score honestly. A 9.5 means the paragraph is publishable as-is in a top-tier law review. If the paragraph is publishable-but-could-be-better, score it 7–8, not 9. The threshold (9.5) is intentionally demanding because the user is pushing for top-tier publication; rubber-stamping wastes the iteration budget.

### Cap

500 words for the per-paragraph diagnoses and fix suggestions in total. The TABLES (scores) must be exhaustive; the prose around them must be tight.

---

## Rubric (inlined for self-containment)

{INLINE RUBRIC FROM rubric.md HERE — the orchestrator will splice it in at dispatch time}
