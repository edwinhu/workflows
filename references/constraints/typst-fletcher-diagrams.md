---
name: typst-fletcher-diagrams
description: Fletcher diagram conventions — syntax, colors, spacing, edge labels, no duplicate nodes
applies-to: [workshop, workshop-revise]
---

## Rule

Fletcher diagrams are used for flowcharts, timelines, and decision trees. **Diagrams must represent the paper's logic, timeline, or decision structure** — not synthesized content from training knowledge. Every node label and edge label must trace to a specific concept in the paper.

```typst
#fletcher-diagram(
  node-stroke: 1pt, edge-stroke: 1pt, spacing: (2em, 2em),
  node((0, 0), [*Node A*], name: <a>, fill: rgb("#b8c9e8"), inset: 0.5em),
  node((2, 0), [*Node B*], name: <b>, fill: rgb("#c8e6c9"), inset: 0.5em),
  edge(<a>, <b>, "-|>", label: [Label]),
)
```

Colors: Blue `#b8c9e8`, Green `#c8e6c9`, Orange `#ffe0b2`, Red `#ffcdd2`, Gray `#e8e8e8`.

### Spacing

Start tight. The driver is **edge label length**, not node count.

| Edge labels | Spacing | When |
|-------------|---------|------|
| None or single-word | `(2em, 2em)` | Default for all diagrams |
| Multi-word (2-3 words) | `(4em, 2em)` | Only when labels clip or crowd at 2em |

Do NOT use `(5em, 3em)`, `(6em, 3em)`, `(8em, 3em)` — these create unnecessarily wide diagrams that waste slide space.

### Rules

- **No duplicate nodes:** Never create two nodes with the same text/label. If multiple edges need the same outcome, use a single shared node and route all edges to it.
- **Edge routing with `udlr`:** When a direct edge would overlap other nodes or arrows, use vertex-based routing or direction strings (e.g., `"d,r,u"`) to route around obstacles with right-angle turns.
- **Storytelling comment required:** Every `#fletcher-diagram(` must be preceded by a `// Storytelling:` comment.
- **Visual-verify loop required:** Same as CeTZ — compile, render, score, iterate.
