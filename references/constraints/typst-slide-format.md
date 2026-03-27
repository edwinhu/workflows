---
name: typst-slide-format
description: Slide format — #slide[], #hide[], #pause usage conventions
applies-to: [workshop, workshop-revise]
---

## Rule

```typst
#slide[
=== Takeaway statement for this slide.

- First point about the topic

- Second point revealed after pause #pause

- Third point with supporting detail
]
```

- **`#slide[...]`** wraps each slide's content
- **`#pause`** creates animation steps (content revealed progressively)
- **`#hide[...]`** for content the presenter sees but audience doesn't (e.g., anticipated Q&A answers in pre-distributed version)
- **`===` subtitle** goes inside `#slide[...]` as the first element
- **`==` section dividers** go OUTSIDE `#slide[...]` blocks
