---
name: visual-verify
version: 3.0
description: "This skill should be used when the user asks to 'verify visual output', 'check how it looks', 'render and review', 'visual verify', 'check the slide', 'does this look right', or when any task produces rendered visual output (slides, charts, documents, UI). Starts a render-vision-fix loop using Gemini vision."
user-invocable: false
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/find-slide-page-inject.py"
---

**Announce:** "I'm using visual-verify to set up a render-vision-fix loop."

<EXTREMELY-IMPORTANT>
## The Iron Law

**NO VISUAL TASK IS COMPLETE WITHOUT RENDERING, SCORING, AND MEETING THE THRESHOLD.**

Source code correctness does NOT imply visual correctness. You MUST render to PNG, score with vision (0-10) — Gemini CLI, or a subagent with Read if Gemini is unavailable — and iterate until score >= 9.5. Claiming "done" with a score below threshold delivers broken visuals to the user.

**Skipping the score check is NOT HELPFUL — the user gets a visual artifact with defects you didn't verify.**
</EXTREMELY-IMPORTANT>

## Gemini CLI Vision

Gemini CLI is inherently agentic — it can read files, crop, zoom, and re-examine regions autonomously. No special flags needed for complex vs. simple images; it handles both automatically.

## The Loop

```
0. PAGE MAP -> If Typst + Touying: Skill("teaching:find-slide-page")
       |      Returns heading → physical page mapping
       |      Skip if: single-page file, non-Typst, or page already known
       |
1. CHANGE  -> Modify source code (Task agent)
       |
2. RENDER  -> Produce PNG + PDF (see references/render-commands.md)
       |      Render fails? -> fix source, back to step 1
       |
2.5 TEXT   -> pdftotext pre-screen (Typst/PDF outputs with diagrams ONLY)
       |      Run: pdftotext -f <page> -l <page> -layout output.pdf -
       |      Check for defect #10 (adjacency violations)
       |      Any violations? -> fix source, back to step 1 (skip vision)
       |      Clean? -> proceed to step 3
       |      Skip if: non-PDF output, no diagrams on page
       |
3. VISION  -> Two-part check:
       |      a) INTENT — Does the render match the design intent?
       |         (Does the visual structure argue what it should?)
       |      b) DEFECTS — Scan for the 10 visual defect categories:
       |         1. Text clipped by or overflowing its container
       |         2. Text or shapes overlapping other elements
       |         3. Arrows crossing through elements instead of routing around
       |         4. Arrows landing on wrong element or pointing into empty space
       |         5. Labels floating ambiguously (not anchored to what they describe)
       |         6. Labels squeezed between adjacent elements without clearance
       |         7. Uneven spacing (cramped sections next to spacious ones)
       |         8. Text too small to read at rendered size
       |         9. Parallel sub-diagrams with inconsistent layout
       |        10. Edge labels fused with node text (pdftotext adjacency)
       |      Gemini CLI vision call with SCORING:
       |      → Score 0-10 against checklist items
       |      → Record in SCORES.md
       |
4. DECIDE  -> Score >= 9.5 AND exit criteria met? → DONE
              Score < 9.5 OR defects remain?      → extract fixes, back to step 1
```

### Step 2.5: pdftotext Pre-Screen (Diagrams Only)

**What it catches:** Edge labels colliding with node text in Fletcher/CeTZ diagrams. When two text elements overlap or touch horizontally in the rendered PDF, `pdftotext -layout` fuses them into a single string without whitespace — e.g., `Republic of1937 war bonds` instead of `Republic of   1937 war bonds`.

**When to run:** Any page that contains a `#fletcher-diagram` or `#cetz.canvas`. Skip for pages with only body text, tables, or bullet points.

**How to check:**
1. Extract the page: `pdftotext -f <page> -l <page> -layout output.pdf -`
2. Collect all node labels and edge labels from the source code
3. Scan the extracted text for any two labels appearing concatenated without whitespace
4. A fused pair (node text running directly into edge label text) is a **BLOCKING** defect — return to step 1 without spending a vision call

**Why this works:** PDF text extraction preserves spatial positions. If elements have clear space between them, whitespace appears in the output. If they overlap or touch, words concatenate. This is cheap, deterministic, and catches the most common Fletcher layout failure that vision scoring misses.

**Why this is NOT a replacement for vision:** pdftotext only catches horizontal text collisions. It cannot detect labels sitting on top of arrow lines (vertical overlap), misaligned arrows, or spacing imbalance. Vision (step 3) is still required for a full pass.

### When to Stop

The loop is done when ALL of these hold:
- Score >= 9.5
- The rendered output matches the design intent (not just defect-free but *correct*)
- No text is clipped, overlapping, or unreadable
- All arrows/lines connect to the right elements and route cleanly
- Spacing is consistent and composition is balanced
- You'd show it to someone without caveats

**Don't stop after one clean pass just because there are no critical bugs — if the composition could be better, improve it.** Conversely, don't loop forever on cosmetics — 5 iterations max before escalating to the user.

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

**Use look-at's `look_at.sh` wrapper for all vision calls.**

```bash
# Single backend (Gemini CLI, default)
"${CLAUDE_SKILL_DIR}/../../skills/look-at/scripts/look_at.sh" \
    --file "/tmp/visual-verify.png" \
    --goal "[CONTEXT-ENRICHED GOAL]"

# Consensus mode (Gemini + GPT-5.4 in parallel)
"${CLAUDE_SKILL_DIR}/../../skills/look-at/scripts/look_at.sh" \
    --file "/tmp/visual-verify.png" \
    --goal "[CONTEXT-ENRICHED GOAL]" \
    --consensus
```

Use `--consensus` for diagram pages. Use single backend for non-diagram pages.

<EXTREMELY-IMPORTANT>
### Fallback: Subagent with Read (when Gemini is unavailable)

**If Gemini CLI fails (API key unavailable, missing, or API error), DO NOT fall back to pdftotext AS A REPLACEMENT for vision. pdftotext cannot detect vertical overlap, misalignment, or spatial defects — it only extracts text. Using it as the sole visual check produces false passes.**

Instead, spawn a subagent that uses the `Read` tool directly on the rendered PNG:

```
Agent(
    prompt="Read the image at /tmp/visual-verify.png and score it. [CONTEXT-ENRICHED GOAL]. Score 0-10 against the checklist. Report BLOCKING and COSMETIC issues separately.",
    description="Vision fallback: score rendered PNG",
    subagent_type="general-purpose"
)
```

**Why this is safe:** The Iron Law against `Read` on images exists to protect the main conversation's context window (images cost 1000-5000 tokens). Subagent context is throwaway — the tokens are discarded when the agent returns its short summary. The cost rationale does not apply.

**pdftotext's role:** pdftotext is prohibited as a *replacement* for vision (the lecture 22 incident: it missed CeTZ vertical text overlap). But it is *required* as a pre-screen in step 2.5 for diagram pages — it catches horizontal adjacency violations that vision frequently misses. The two prongs complement each other: pdftotext catches fused text; vision catches spatial/vertical issues.
</EXTREMELY-IMPORTANT>

### Multi-Prong Verification

For pages containing diagrams (Fletcher, CeTZ), verification uses **two complementary prongs** that run in sequence. Neither prong alone is sufficient.

**Prong 1: pdftotext adjacency check (step 2.5) — cheap, deterministic**

Catches: edge labels fused with node text, labels running into each other horizontally.
Misses: labels sitting on top of arrows, vertical overlap, spatial imbalance.

```bash
# 1. Extract the page
pdftotext -f <page> -l <page> -layout output.pdf /tmp/vv-text.txt

# 2. Collect expected labels from source
#    Grep all node(..., [...]) and edge(..., label: [...]) content from the .typ file

# 3. Check for fused pairs
#    Scan extracted text for any two labels concatenated without whitespace
#    e.g., "Republic of1937" = node "Republic of China" fused with edge "1937 war bonds"
#    Any match = BLOCKING, return to step 1 without spending a vision call
```

**How to detect fused text:** For each edge label in the source, check whether it appears in the pdftotext output concatenated with an adjacent node label — no whitespace between the end of one and the start of another. The specific pattern is: `<end of node text><start of edge label>` or `<end of edge label><start of node text>` appearing as a single unbroken string.

**Prong 2: Gemini vision (step 3) — expensive, catches spatial issues**

Catches: labels on top of arrows, vertical overlap, arrow misrouting, spacing imbalance.
Misses: subtle horizontal adjacency (Gemini often scores these 9/10 or higher).

**Prong 3: Multi-model vision consensus (step 3b) — second opinions**

For diagram pages, use look-at's `--consensus` mode (runs Gemini + GPT-5.4 in parallel) plus a Claude Opus subagent. Run all three in parallel:

```bash
# Gemini + GPT-5.4 consensus (via look_at.sh)
"${CLAUDE_SKILL_DIR}/../../skills/look-at/scripts/look_at.sh" \
    --file "/tmp/visual-verify.png" \
    --goal "[CONTEXT-ENRICHED GOAL]" \
    --consensus

# Claude Opus subagent (reads PNG natively)
Agent(
    prompt="Read the image at /tmp/visual-verify.png. [CONTEXT-ENRICHED GOAL]. Score 0-10. Report BLOCKING and COSMETIC issues.",
    description="Vision prong: Claude Opus",
    subagent_type="general-purpose",
    model="opus"
)
```

**When to use prong 3:** Always for diagram pages. For non-diagram pages (body text, tables), prong 2 alone is sufficient.

**Calibration note (from testing):** Gemini tends to underscore overlap defects — marking BLOCKING issues as COSMETIC and scoring 8/10 when Claude Opus scores 5/10 on the same image. Trust the stricter score. If any model flags BLOCKING, treat it as BLOCKING regardless of other models' severity ratings.

**Consensus rule:** If any model flags a BLOCKING issue that others missed, treat it as a real defect and fix it. A 9.5 from Gemini + a 7.0 from Claude = not clean. All models must agree the output is clean.

**The prongs feed into each other:**
- If prong 1 finds fused text → fix immediately, skip prongs 2-3 (save the vision calls)
- If prong 1 is clean → run prong 2 for spatial verification
- If prong 2 scores >= 9.5 but low confidence → run prong 3 for consensus
- If any prong finds issues → fix, then re-run ALL prongs on next iteration
- All prongs must pass for the page to be scored as clean

### Goal Assembly

**NEVER call Gemini with a generic goal.** Goals must reference the spec, checklist items, and prior feedback.

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
| Python | `uv run python3 script.py` (script saves to known path) |
| Screenshot | `screencapture -x /tmp/visual-verify.png` |

See `references/render-commands.md` for the full reference.

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Using pdftotext as the SOLE check (replacing vision) | pdftotext misses vertical overlap and spatial defects — lecture 22 false pass | pdftotext is prong 1 (pre-screen); vision is prong 2. Both required. |
| Skipping pdftotext pre-screen on diagram pages | Vision frequently misses horizontal label-node fusion (scored 9/10 on fused text) | Always run pdftotext prong first for pages with Fletcher/CeTZ diagrams |
| Declaring "only N diagrams" without grepping for all `VIS-*` items | You will miss diagrams and skip their visual check | `rg 'VIS-' file.typ` to enumerate ALL diagrams before checking any |
| Skipping visual check because "the code looks correct" | The anchor: "south" bug was syntactically valid Typst that produced severe overlap | Render and score EVERY diagram, no exceptions |
| Running vision without checking pdftotext first | Wastes an expensive Gemini call on an issue pdftotext catches for free | Prong 1 first; if it fails, fix before calling Gemini |

## When NOT to Use

- **One-off visual checks**: Use Gemini CLI directly, not the full loop
- **Text-only verification**: Use standard dev-verify
- **Compilation checks only**: Just run the compile command

## Reference Files

- `references/goal-templates.md` -- copy-paste goal templates per domain
- `references/render-commands.md` -- render commands for all supported domains
- `references/rationalization-prevention.md` -- excuses, red flags, honesty framing, drive-aligned consequences
- `references/complex-diagram-strategy.md` -- reference sketch approach for persistent layout failures
- `references/examples.md` -- worked examples (Typst slide, matplotlib chart, diagram escalation)
