---
name: typst-slide-format
description: Slide format — #slide[], #hidden-slide[], #hide[], #pause usage conventions
type: convention
graduated: false
applies-to: [workshop, workshop-revise, lecture-prep, slides-edit, lecture-prep-edit]
---

## Rule — Slide Structure

```typst
#slide[
=== Takeaway statement for this slide (CP 120--125)

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

Prose content is also allowed in place of bullets:

```typst
#slide[
=== Takeaway statement for this slide (CP 120--125)
Content...
#pause  // Animation step
More content revealed after pause...
]
```

Use `#hidden-slide[...]` for any content that should not appear in student-facing PDFs (cold-call questions, answer reveals, instructor notes). The entire slide is hidden in for-posting and final modes. Answers and `#pause` steps inside `#hidden-slide` work normally in presentation mode.
