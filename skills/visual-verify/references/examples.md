# Visual-Verify Examples

## Example 1: Typst Slide (Non-Python Path)

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task 1: Title Slide --max-iterations 5 --completion-promise VTASK1_DONE")

[Spawn Task agent -> creates title slide in Typst]

# Render
tinymist compile presentation.typ /tmp/visual-verify.png --pages 1 --ppi 144

# Vision check — NON-PYTHON PATH (no --agentic)
LOOK_AT=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/look-at/scripts/look_at.py 2>/dev/null | sort -V | tail -1) && python3 "$LOOK_AT" \
    --file "/tmp/visual-verify.png" \
    --goal "You are reviewing a Typst presentation slide. You CANNOT run Typst.

## What This Should Be
Title: 'Quarterly Business Review Q3 2025'
Subtitle: 'Revenue Growth and Strategic Initiatives'
Author: 'Jane Smith, CFO'
University theme with 16:9 aspect ratio.

## Check These Specifically
- Title is large, centered, and not clipped
- Subtitle is smaller than title, below it
- Author visible in lower portion
- No text overlapping or running off edges

## Previous Issues
First iteration - no prior issues.

## Your Review — STRUCTURED FORMAT REQUIRED
For EACH issue: Element, Problem, Location, Severity, Direction.
Rate PASS or FAIL."

# Gemini responds: PASS
<promise>VTASK1_DONE</promise>
```

## Example 2: Matplotlib Chart (Python-Native Path)

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task 2: Revenue Chart --max-iterations 5 --completion-promise VTASK2_DONE")

# Iteration 1
[Spawn Task agent -> creates matplotlib chart]
[Render: python3 charts/revenue.py]

# Vision check — PYTHON-NATIVE PATH (--agentic)
LOOK_AT=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/look-at/scripts/look_at.py 2>/dev/null | sort -V | tail -1) && python3 "$LOOK_AT" \
    --file "/tmp/visual-verify.png" \
    --goal "You are reviewing a Python-generated chart.
You have matplotlib, seaborn, numpy, pandas in your sandbox.

## What This Should Be
Bar chart showing quarterly revenue 2020-2024 by product line.

## The Python Code
[paste relevant plotting code]

## Your Review
1. Reproduce key elements in your sandbox to verify
2. For each issue, experiment with a fix and provide EXACT code change
Rate: PASS or FAIL with verified code fixes." \
    --agentic

# Gemini responds: FAIL
# - Y-axis label missing units → verified fix: ax.set_ylabel("Revenue ($M)")
# - Legend overlaps data → verified fix: ax.legend(loc="upper left", bbox_to_anchor=(1, 1))

# Iteration 2
[Spawn Task agent with Gemini's VERIFIED code fixes]
[Re-render]
[Vision check with updated feedback]

# Gemini responds: PASS
<promise>VTASK2_DONE</promise>
```

## Example 3: Complex Typst Diagram (Reference Sketch Escalation)

```
# After 3 failed iterations on fletcher diagram label overlap...

# Escalate to reference sketch approach
LOOK_AT=$(command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/skills/look-at/scripts/look_at.py 2>/dev/null | sort -V | tail -1) && python3 "$LOOK_AT" \
    --file "/tmp/visual-verify.png" \
    --goal "This diagram has persistent label overlap issues after 3 iterations.
Draw a REFERENCE VERSION using matplotlib/networkx showing ideal positions:
- Borrower node at top
- Arranging Bank in middle
- Banks A, B, C at bottom
- Labels 'Syndicate $$' and 'Pro rata share' positioned CLEAR of all arrows
Output the x,y coordinates of each element and label." \
    --agentic

# Gemini outputs reference coordinates
# Claude translates to fletcher-diagram spacing and label-pos values
# One more iteration with precise coordinates → PASS
```
