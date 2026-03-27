---
name: typst-no-subtitle-echo
description: Slide title (===) must NOT repeat as the first bold/italic body line — double-prints the same sentence
applies-to: [workshop, workshop-revise]
---

## Rule

**The slide title (`===`) must NOT repeat as the first bold/italic body line.** This double-prints the same sentence on the rendered slide.

```typst
// WRONG: echo
=== Proxy advisors emerged to fill this governance gap.

*Proxy advisors emerged to fill this governance gap.* #pause
```

```typst
// CORRECT: subtitle frames, body answers
=== Proxy advisors emerged to fill this governance gap.

- *ISS* founded in 1985, *Glass Lewis* in 2003

- Today these two firms control >90% of the market
```

**"Almost the same" counts.** If subtitle and body differ only by punctuation or articles, it's still an echo.
