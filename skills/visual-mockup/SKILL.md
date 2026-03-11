---
name: visual-mockup
version: 1.0
description: "This skill should be used when the user asks to 'mockup the layout', 'sketch the diagram', 'show me the layout before coding', 'draft the positions', 'quick visual of the layout', 'matplotlib mockup', 'draw a rough layout', 'prototype the diagram', or when you're about to write a diagram with 4+ nodes and want to confirm spatial layout with the user first."
---

**Announce:** "I'll sketch a quick matplotlib mockup so you can see the layout before I code the real diagram."

## Why This Exists

Diagram code (CeTZ, Fletcher, TikZ) is slow to iterate on — you write coordinates, compile, discover the layout is wrong, rewrite. A 30-second matplotlib sketch lets the user see and approve the spatial layout *before* any real code gets written. This saves 3-5 compile-fix cycles on complex diagrams.

## When to Use

- Before coding a new diagram with 4+ nodes, regions, or non-trivial arrow routing
- When the user describes a layout change and you want to confirm before implementing
- When an ASCII sketch isn't enough to convey spatial relationships (overlapping regions, diagonal arrows, nested containers)
- When you and the user are iterating on where things should go

You don't need this for simple diagrams (2-3 nodes in a line). Use your judgment — if the layout is obvious, skip the mockup and go straight to code.

## The Process

### 1. Gather the Layout

From conversation context or the user's request, identify:
- **Nodes**: labeled boxes with approximate positions
- **Edges**: arrows between nodes, with labels and directionality
- **Regions**: background containers grouping nodes (dashed borders, light fills)
- **Constraints**: "X must be above Y", "no crossing arrows", "these two side by side"

### 2. Generate the Mockup

Write a Python script that uses matplotlib to sketch the layout:

- **Boxes for nodes**: `matplotlib.patches.FancyBboxPatch` with rounded corners
- **Arrows for edges**: `ax.annotate` with `arrowprops`
- **Shaded rectangles for regions**: low-alpha patches with dashed borders
- **Labels**: centered text in boxes, edge labels near midpoints
- **Consistent colors**: match the target palette if known, otherwise use sensible defaults

Output to `/tmp/visual-mockup.png` at 150 DPI, then open it:

```python
plt.savefig('/tmp/visual-mockup.png', dpi=150, bbox_inches='tight')
```

```bash
open /tmp/visual-mockup.png
```

### 2b. Gemini Sanity Check (optional)

If the layout has non-trivial spatial constraints (crossing-avoidance, region nesting, consistency across sub-diagrams), you may not catch problems from coordinates alone. Before showing the user, run Gemini `--agentic` on the mockup to check for issues:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-mockup.png" \
    --goal "Check this diagram mockup for: (1) any arrows that cross other arrows or pass through nodes, (2) inconsistent layout between sub-diagrams (e.g., left side has X on the right but right side has X on the left), (3) overlapping labels or nodes. If you find issues, fix the matplotlib code and re-save to /tmp/visual-mockup.png." \
    --agentic
```

**When to use this:** When you're uncertain the layout is clean — especially diagrams with 5+ nodes, multiple regions, or side-by-side comparisons that need consistent positioning. Skip it for simple layouts where you're confident.

**Why `--agentic` works here:** Unlike Typst/CeTZ, the mockup is Python. Gemini can see the problem AND fix the code in the same call.

### 3. Get Feedback

After opening the mockup, tell the user what the mockup shows and ask if the layout works. Common feedback:
- "Move X to the left"
- "Swap these two"
- "The arrow should go around, not through"
- "Yes, code it"

If changes needed, regenerate the mockup (overwrite the same file). When approved, proceed to the real diagram code.

## Style Guide

Keep mockups clean and readable — they're sketches, not finished products:

- `figsize=(12, 6)` for side-by-side comparisons, `(8, 6)` for single diagrams
- `boxstyle="round,pad=0.1"` for nodes
- `linewidth=0.8` for node borders, `lw=2` for important arrows (like fraud/error paths)
- Use color to distinguish categories (e.g., red for danger/fraud, blue for normal flow)
- `ax.set_aspect('equal')` to prevent distortion
- `ax.axis('off')` — no axes needed for layout sketches

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Spending 10+ minutes polishing the mockup | It's a sketch, not a deliverable. You're procrastinating on the real diagram. | Get it "good enough to discuss" and open it. 2 minutes max. |
| Adding data, formulas, or precise styling | You're building the real diagram in the wrong tool. | Boxes, arrows, labels. That's it. |
| Using look-at to *score* the mockup (0-10, BLOCKING/COSMETIC) | This isn't visual-verify. No scoring loop — the user's eyes are the judge. | Use `--agentic` only as a sanity check (Step 2b) if you're uncertain about crossing/consistency, not as a quality gate. |
| Skipping the mockup because "I know the layout" | You thought that about Morrison too. The user saw crossing arrows you didn't. | If 4+ nodes, sketch it. 30 seconds vs. 3 failed compiles. |

## What This Skill is NOT

- Not a render-verify loop (use `visual-verify` for that)
- Not a replacement for the actual diagram code
- Not for data visualization (use `ds` workflow for charts/plots)
- Not for pixel-perfect output — it's a spatial sketch for layout approval
