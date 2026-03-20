---
name: visualization-integrity
description: Charts must not mislead — no truncated axes, no dual-axis tricks, no 3D distortion
applies-to: [ds-delegate]
---

## Rule

Charts must not mislead. Common visualization errors that look professional but lie:

| Anti-Pattern | What's Wrong | Fix |
|-------------|-------------|-----|
| Truncated y-axis | Exaggerates small differences | Start at 0 or clearly label break |
| Dual y-axes with different scales | Suggests correlation where none exists | Separate panels or normalize |
| Pie charts for comparison | Human perception of angles is poor | Bar chart |
| 3D charts | Depth distorts proportions | 2D always |
| Smoothed trend hiding volatility | Hides variance that matters | Show raw + trend, or confidence band |
| Cherry-picked time window | Period selection bias | Show full available period |

## Rationale

**Why this exists** — A misleading chart is worse than no chart. The user's eye trusts visual patterns before checking axes and labels. A truncated axis makes a 2% difference look like a 200% difference.

## Examples

### Correct
```python
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.bar(categories, values)
ax.set_ylim(0, max(values) * 1.1)  # Start at 0
ax.set_title("Revenue by Category")
```

### Incorrect
```python
ax.set_ylim(990, 1010)  # Truncated axis — tiny differences look huge
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The differences are hard to see at full scale" | Then the differences are small. Show them honestly. | Use full scale, add annotations for differences |
| "Dual axes make it easier to compare" | Dual axes manufacture visual correlation | Separate panels or normalize to same scale |
| "3D looks more professional" | 3D distorts proportions and obscures values | 2D always |

## Red Flags

- **Truncated y-axis** → STOP. Start at 0 or clearly label the break.
- **Dual y-axes** → STOP. Use separate panels.
- **Smoothed line without raw data** → STOP. Show both or add confidence band.
