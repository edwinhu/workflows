# Complex Diagram Strategy (Non-Python)

For complex diagrams (flowcharts, entity diagrams, state machines) that consistently fail visual-verify after 3+ iterations.

## Reference Sketch Approach

When the same issue persists across iterations, have Gemini draw a **reference layout** in matplotlib:

```bash
python3 "${CLAUDE_SKILL_DIR}/../../skills/look-at/scripts/look_at.py" \
    --file "/tmp/visual-verify.png" \
    --goal "This diagram has persistent layout issues. Draw a REFERENCE VERSION using matplotlib/networkx showing the IDEAL positions for all nodes and labels. Output the x,y coordinates of each element." \
    --agentic
```

Then translate Gemini's reference coordinates into the target language (Typst fletcher, R ggplot, etc.). This gives Claude concrete positions to aim for instead of incremental guess-and-check.

**Use this only after 3+ failed iterations on the same spatial issue.** Most diagrams resolve within 2 iterations with structured pixel feedback.

## When to Escalate

Signs that incremental pixel feedback isn't converging:
- Same element flagged in 3+ consecutive iterations
- Fixes for one overlap create new overlaps elsewhere
- Layout is fundamentally wrong (not just off by a few pixels)

## Translation Pattern

After Gemini produces reference coordinates:

1. Map Gemini's x,y coordinates to the target language's coordinate system
2. Adjust for differences in origin point (matplotlib: bottom-left, many others: top-left)
3. Apply coordinates as absolute positions rather than relative spacing
4. Run one final visual-verify iteration to confirm
