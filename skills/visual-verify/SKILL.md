---
name: visual-verify
version: 2.2
description: "This skill should be used when the user asks to 'verify visual output', 'check how it looks', 'render and review', 'visual verify', 'check the slide', 'does this look right', or when any task produces rendered visual output (slides, charts, documents, UI). Starts a render-vision-fix loop using Gemini vision."
---

**Announce:** "I'm using visual-verify to set up a render-vision-fix loop."

<EXTREMELY-IMPORTANT>
## The Iron Law

**NO VISUAL TASK IS COMPLETE WITHOUT RENDERING, SCORING, AND MEETING THE THRESHOLD.**

Source code correctness does NOT imply visual correctness. You MUST render to PNG, score with context-enriched Gemini vision (0-10), and iterate until score >= 9.5. Claiming "done" with a score below threshold delivers broken visuals to the user.

**Skipping the score check is NOT HELPFUL — the user gets a visual artifact with defects you didn't verify.**
</EXTREMELY-IMPORTANT>

## Domain Routing

**Detect the domain BEFORE choosing the verification path.**

| Domain | Path | `--agentic`? | Why |
|--------|------|-------------|-----|
| Python (matplotlib, seaborn, plotly) | Python-native | YES | Gemini can execute and fix plotting code in sandbox |
| Typst, R, JS, HTML, LaTeX, other | Non-Python | NO | Gemini can't run these; `--agentic` just adds PIL overhead |

Detection: `.py` / matplotlib / seaborn / plotly -> Python-native. Everything else -> Non-Python (vision-only).

## The Loop

```
0. PAGE MAP -> If Typst + Touying: Skill("teaching:find-slide-page")
       |      Returns heading → physical page mapping
       |      Skip if: single-page file, non-Typst, or page already known
       |
1. CHANGE  -> Modify source code (Task agent)
       |
2. RENDER  -> Produce PNG (see references/render-commands.md)
       |      Render fails? -> fix source, back to step 1
       |
3. VISION  -> Domain-routed look-at call with SCORING
       |      Python? -> --agentic (Gemini executes code)
       |      Non-Python? -> vision-only (structured pixel feedback)
       |      → Score 0-10 against checklist items
       |      → Record in SCORES.md
       |
4. DECIDE  -> Score >= 9.5? → output promise (DONE)
              Score < 9.5?  → extract suggestions, back to step 1
```

### Invocation

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task N: [TASK NAME] --max-iterations 5 --completion-promise VTASKN_9_5")
```

### Score Tracking

Initialize SCORES.md before the first iteration:

```markdown
# Visual Verify Scores

| Iteration | Score | Threshold | BLOCKING | COSMETIC | Delta |
|-----------|-------|-----------|----------|----------|-------|
```

Each vision call must score the output 0-10:
- 10.0 = all checklist items pass, zero issues
- 9.5 = 95% pass, 1-2 cosmetic issues remain (default threshold)
- < 9.0 = BLOCKING issues present

The score reflects the fraction of checklist items that pass. Gemini counts BLOCKING and COSMETIC issues against the domain-specific checklist, and the score = (items passing / total items) * 10.

### Vision Calls

**Python-native** (`--agentic`):
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "[CONTEXT-ENRICHED GOAL]" \
    --agentic
```

**Non-Python** (vision-only, no `--agentic`):
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "[CONTEXT-ENRICHED GOAL]"
```

### Goal Assembly

**NEVER call look-at with a generic goal.** Goals must reference the spec, checklist items, and prior feedback.

| Context Piece | Source |
|---------------|--------|
| `spec_text` | SPEC.md, PLAN.md task, or user request |
| `checklist_items` | Domain + task specific |
| `previous_feedback` | Gemini's output from prior iteration |

**For diagrams (fletcher, CeTZ): use describe-first strategy**, NOT judgment prompts.
- Step 1: Ask Gemini to transcribe all text elements with `[FULL | PARTIAL]` annotations
- Step 2: Claude diffs transcription against expected elements from source code
- Step 3 (optional): Run spatial/overlap check for non-clipping issues
- **Why:** Judgment prompts ("is X visible?") invite yes-man answers. Transcription forces the model to report what it actually sees — clipping becomes objectively detectable via text mismatches.

See `references/goal-templates.md` for full copy-paste templates per domain.

### Translating Non-Python Feedback

**Before editing Typst source to apply fixes, load the tinymist skill:** `Skill(skill="tinymist:typst")`
It has Fletcher/CeTZ reference docs with correct parameter names (label-side, label-pos, spacing, inset). Without it, you will guess at parameter names and waste iterations.

Gemini returns structured pixel measurements. Claude translates to source code:

| Gemini says | Claude translates to (Typst example) |
|-------------|--------------------------------------|
| "Move label 15px left" | Adjust `label-pos` or node coordinates by ~0.5em |
| "Text clipped at right edge" | Increase `inset` or reduce `scale()` percentage |
| "Node/diagram cut off at edge" | Reduce canvas `length`, node `inset`, or `spacing`; or shift coordinates toward center |
| "Elements overlap vertically" | Increase `spacing` parameter |
| "Font too small to read" | Increase `#set text(Npt)` value |

### Complex Diagrams (3+ Failed Iterations)

If the same spatial issue persists after 3 iterations, escalate to the reference sketch approach: have Gemini draw an ideal layout in matplotlib and translate coordinates.

See `references/complex-diagram-strategy.md` for the full approach.

## Quick Render Reference

| Domain | Command |
|--------|---------|
| Typst | `tinymist compile input.typ /tmp/visual-verify.png --pages N --ppi 144` (use `/find-slide-page` to get N) |
| Python | `python3 script.py` (script saves to known path) |
| Screenshot | `screencapture -x /tmp/visual-verify.png` |

See `references/render-commands.md` for the full reference.

## When NOT to Use

- **One-off visual checks**: Use `look-at` directly, not the full loop
- **Text-only verification**: Use standard dev-verify
- **Compilation checks only**: Just run the compile command

## Reference Files

- `references/goal-templates.md` -- copy-paste goal templates per domain
- `references/render-commands.md` -- render commands for all supported domains
- `references/rationalization-prevention.md` -- excuses, red flags, honesty framing, drive-aligned consequences
- `references/complex-diagram-strategy.md` -- reference sketch approach for persistent layout failures
- `references/examples.md` -- worked examples (Typst slide, matplotlib chart, diagram escalation)
