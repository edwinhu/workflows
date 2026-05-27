# Rhythm-Pass Lessons — 7 Design Constraints

Distilled from a 7-iteration ad-hoc audit-fix run that lifted a law review introduction from **6.2/10 → 8.5/10** on the 5-dimension rhythm-and-flow rubric. Use this file as the operating manual when running the rhythm pass as a `/writing-revise` subroutine.

## When to use the rhythm pass

Run rhythm-and-flow scoring as a subroutine inside `/writing-revise` when:

- A regex sweep (`workflows:ai-anti-patterns` + Strunk + Volokh + McCloskey via `prose-lint.py`) is already clean OR has only false positives
- The user reports the draft "reads choppy" or asks for "rhythm review"
- Recent edits removed paragraph-closing sentences (roadmap deletions, sentence merges) and may have created rhythm regressions
- The draft is post-export `.docx` (regex-only review misses paragraph-level structural patterns)

Don't run this pass when:

- The regex sweep has substantial unresolved hits — fix those first; they're cheaper
- The work is at draft-only stage with structural changes still pending — rhythm fixes get undone

## The 5-dimension rubric

See `rhythm-rubric.md` — copy to `.planning/prose-rhythm/rubric.md` at pass start. Dimensions: **rhythm** (sentence-length variation), **flow** (between-sentence connective tissue), **topic sentence** (load-bearing claim vs meta-commentary), **closure** (final-sentence punch vs trailing roadmap), **sentence variety** (structural diversity). Overall = geometric mean (penalizes the worst dimension; 9.5+ requires ≥9.0 on every dim).

## The auditor brief

See `rhythm-auditor-brief.md` — the validated prompt template that produced consistent scores across 7 dispatches. Use with `workflows:writing-prose-reviewer` subagent and **read-only tools (Read, Grep, Glob)**.

## The 7 Lessons (iron-law level)

### 1. Transactional save discipline is mandatory

**Pattern:** validate ALL fix needles against the live draft → apply ALL → save exactly once at the end.

**Why:** the validation run lost 2 of 4 fixes silently in iteration 1→2. A Python script applied edits in memory, raised `SystemExit` mid-way on an unrelated needle mismatch, and the save-at-end never executed. The auditor flagged them as not-applied in iteration 2 — wasted an entire iteration.

**How to apply:** the rhythm-pass fix step uses a single-transaction approach: read all fixes, validate every `target_text` exists with count == 1 in the docx XML, then apply all in one `zipfile.ZipFile(tmp, 'w')` write, then `os.replace(tmp, doc)`. If any needle fails to validate, the entire batch aborts and surfaces to user.

### 2. Footnote/bookmark pinning is a hard constraint

**Pattern:** before proposing any fix, scan the draft for `<w:footnoteReference>` runs and `<w:bookmarkStart w:name="_Ref*"/>` ranges. Record their paragraph + sentence + run-position spans.

**Why:** `¶5` of the validation draft had three `_Ref_fn*` bookmarks pinning specific sentences (each enumeration item was footnoted). The auditor's first-iteration fix-list proposed collapsing the enumeration to lift the topic dimension — that would have orphaned three NOTEREF references. The pin scan caught it before the fixer applied.

**How to apply:** before dispatching the auditor for iteration 1, run a pre-flight pin scan and write `.planning/prose-rhythm/PINS.md` listing every (paragraph_index, sentence_idx, run_position, ref_id) tuple. The fixer cross-references every proposed `target_text` against PINS.md and refuses any fix whose span overlaps a pin without an explicit `preserve_pin: <ref_id>` field.

### 3. Rubric recalibration ≠ regression

**Pattern:** when a paragraph drops in score between iterations, distinguish:
- **Recalibration** — no targeted fix in the prior iteration's CHANGELOG entries for that paragraph. The auditor tightened its anchors. Log to SCORES.md notes column, **do not alarm**.
- **Collateral damage** — a CHANGELOG entry targeted that paragraph (or an adjacent one) in the prior iteration. The fix caused a regression. **Alarm** — surface to user, candidate for revert.

**Why:** the validation run's `¶2` dropped from 7.2 → 6.2 between iterations 2 and 3 with no fix applied. The auditor explicitly noted: "iter-2 generously scored rhythm 6 and variety 5; under strict rubric anchoring, three S-V-O sentences of 20-21 words score rhythm 4 and variety 3." That's the auditor tightening, not a real regression. A naive alarm here would have wasted iterations chasing a non-issue.

**How to apply:** the decide step reads CHANGELOG.md and compares iteration N-1 entries against iteration N score drops. Only flag REGRESSION_ALARM when both (score drop ≥1 overall) AND (targeted fix in CHANGELOG for that paragraph in prior iter) are true.

### 4. Geometric mean correctly identifies bottlenecks

**Pattern:** overall paragraph score = `(rhythm × flow × topic × closure × variety) ^ (1/5)`. Document overall = geometric mean across paragraphs.

**Why:** arithmetic mean of 9-9-9-9-3 is 7.8 (looks fine). Geometric mean is 6.7 (flags the broken dimension). The validation run consistently saw the loop fix the worst dimension on the worst paragraph (¶7 closure 3→8, ¶6 grammar fragment 4→7) rather than over-polishing strong dimensions.

**How to apply:** SCORES.md uses geometric mean explicitly. The auditor brief enforces it as the only legitimate aggregation.

### 5. The 9.5 threshold is too aggressive as a default

**Pattern:** default threshold = **8.5**, not 9.5. Configurable via `--threshold`.

**Why:** across 7 iterations on existing prose with structural constraints (footnotes, established voice, citation attachments), the realistic ceiling without paragraph-architecture rewrites was 8.7. Reaching 9.5 requires conceptual rewrites that change the author's argumentative framing — e.g., ¶1 needs a falsifiable-claim opener instead of a dated-event catalog; ¶4 needs a non-enumeration topic frame. Those are author judgment calls, not rhythm fixes.

**How to apply:** when running the rhythm pass, default the threshold to 8.5. Use 9.0 only for new prose with no footnote/citation constraints. Document the ceiling in REPORT.md if the loop converges below threshold.

### 6. Targeting matters — use structured fix tuples

**Pattern:** every fix in AUDIT.md is a structured YAML tuple, not a natural-language description:

```yaml
fixes:
  - paragraph_index: 6
    sentence_idx: 2
    dimension: rhythm
    action: "split at first semicolon"
    target_text: "It would have flipped 12 of 644,954 items; full abstention's flip count is 166 times higher,..."
    new_text: "It would have flipped 12 of 644,954 items. Full abstention's flip count is 166 times higher;..."
    rationale: "9w short claim breaks the S2-S3 38w/38w length pair"
```

**Why:** iter 6 of the validation mis-applied a "split S5" fix because the auditor's natural-language description didn't specify which paragraph's S5. The constraint was actually `¶6 S2-S3`, not `¶6 S5`. One wasted iteration.

**How to apply:** the auditor brief mandates structured tuples. The fixer refuses any unstructured fix. The CHANGELOG records the tuple verbatim for revert.

### 7. Auditor independence is real (and self-correcting)

**Pattern:** every iteration spawns a fresh `workflows:writing-prose-reviewer` subagent with read-only tools. The main session (the fixer) never scores its own work.

**Why:** consistent scores across 7 dispatches (¶1 stable at 8.0-8.8 throughout) prove the rubric is well-defined and the auditor is independent. More importantly, **the auditor caught the fixer's silent fix-drops in iteration 2** by re-scoring the same prose at the same number — main session would have rationalized the missing edits as "applied but didn't help."

**How to apply:** always dispatch via `Agent(subagent_type="workflows:writing-prose-reviewer", allowed_tools=["Read", "Grep", "Glob"], ...)`. Never run the audit inline.

## Practical invocation pattern (inside /writing-revise)

When the rhythm pass is invoked as a `/writing-revise` subroutine:

```
1. Setup: extract draft → CURRENT.md, scan pins → PINS.md, copy rubric+brief to .planning/prose-rhythm/
2. Set /goal pinned to "latest SCORES.md overall ≥ threshold. Stop after max_iter turns."
3. Loop:
   a. Dispatch fresh writing-prose-reviewer (read-only, structured fix tuples)
   b. Read latest SCORES.md, check threshold + iter + regression alarm
   c. If CONTINUE: apply fixes transactionally (validate-all → apply-all → save-once); cross-check PINS.md; log to CHANGELOG.md; re-extract → CURRENT.md
   d. End turn — /goal refires
4. Exit on COMPLETE (overall ≥ threshold) or ESCALATE (iter ≥ max_iter < threshold)
```

## What this is NOT

- **Not a full workflow.** Don't run as `/prose-rhythm`. Invoke from `/writing-revise` only.
- **Not for first-draft work.** Run after regex sweep is clean. Rhythm tweaks get undone by structural rewrites.
- **Not a replacement for substantive review.** Rhythm/flow is one of many quality dimensions. Run the cite-fidelity, AI-anti-patterns, and Volokh/Strunk/McCloskey passes alongside.

## Reference state files (project-local)

When the rhythm pass runs, it creates these in the target project's `.planning/prose-rhythm/`:

| File | Purpose | Lifetime |
|------|---------|----------|
| `rubric.md` | Copied from `rhythm-rubric.md`; can be project-customized | Pass lifetime |
| `auditor-brief.md` | Copied from `rhythm-auditor-brief.md`; can be customized | Pass lifetime |
| `SCORES.md` | Append-only per-iteration score table | Pass lifetime + audit trail |
| `AUDIT.md` | Append-only per-iteration findings + structured fix-list | Pass lifetime + audit trail |
| `CHANGELOG.md` | Append-only per-fix log with (paragraph, sentence, dim, before/after) | Pass lifetime + revert ledger |
| `CURRENT.md` | Snapshot of the draft for the auditor (regenerated per iteration) | Per-iteration |
| `PINS.md` | Footnote/bookmark pin spans (from setup) | Pass lifetime (invalidated if draft edited outside pass) |
| `REPORT.md` | Final summary on COMPLETE/ESCALATE exit | Pass exit |
