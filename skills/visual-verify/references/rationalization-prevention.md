# Rationalization Prevention

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The code compiles, so it looks right" | Compiling proves syntax, not visual correctness | Render and look at it |
| "I checked the source code carefully" | Source code is not pixels. You cannot infer alignment from code. | Render and look at it |
| "Gemini just describes images, not useful" | Gemini WITH CONTEXT is a reviewer, not a descriptor | Assemble context, then look |
| "Vision API calls are slow/expensive" | One Gemini Flash call costs <$0.001 and takes <2 seconds | Call it. Every time. |
| "I'll visually verify at the end" | You'll have 10 issues compounding. Verify each change. | Render and look after every change |
| "The previous render looked fine, this small change won't break it" | Small changes cause clipping, overflow, and alignment shifts | Render and look. Every time. |
| "A generic look-at goal is sufficient" | Generic goals give generic descriptions | Assemble full context |
| "I should use --agentic for this Typst diagram" | Gemini can't run Typst. --agentic just adds PIL overhead. | Use vision-only with structured pixel feedback |
| "I don't need --agentic for this matplotlib chart" | Gemini CAN reproduce and fix Python charts in its sandbox. | Use --agentic for Python. Always. |
| "Gemini's pixel measurements won't translate" | Structured measurements translate better than vague descriptions | Request the structured format |

## Red Flags -- STOP Immediately

| Thought | Do Instead |
|---------|-----------|
| "I'll skip the render, the code is obviously correct" | STOP. Render it. "Obviously correct" code produces "obviously wrong" output. |
| "Gemini won't understand this domain" | STOP. That's why you provide context. Context-enriched goals tell Gemini exactly what to check. |
| "One more code change, then I'll render" | STOP. Render NOW. Each unverified change compounds risk. |
| "The goal template is too verbose" | STOP. Verbose context = precise feedback. Terse context = useless description. |
| "I'll use Read to look at the image myself" | STOP. Use look-at. Reading images wastes context tokens. |
| "I'll use --agentic for everything to be safe" | STOP. --agentic on non-Python adds latency without value. Route correctly. |
| "This fletcher diagram needs 1 more iteration" (iteration 4+) | STOP. Use the reference sketch approach. Incremental fixes aren't converging. |

## Honesty Framing

<EXTREMELY-IMPORTANT>
**Claiming a visual task is complete without rendering and reviewing the output is LYING.**

When you say "slide is done" or "chart is correct", you are asserting:
- You rendered the output to an image
- You reviewed the image against the spec
- The image matches the spec

If you did not render AND review, you are not "moving on" -- you are LYING about the visual state.

**"Still rendering and checking" is honest. "Done" without visual evidence is fraud.**
</EXTREMELY-IMPORTANT>

## Drive-Aligned Consequences

| Drive | Why You Skip | What Actually Happens | Drive You Failed |
|-------|-------------|----------------------|-----------------|
| **Helpfulness** | "Skip render to deliver faster" | User gets broken visual output. They see the bugs you didn't check for. | **Anti-helpful** |
| **Efficiency** | "Use --agentic everywhere, one size fits all" | Typst tasks waste 5-10 seconds per call on useless PIL code. Python tasks miss the sandbox advantage. | **Anti-efficient** |
| **Competence** | "I can infer layout from source code" | Source code is not pixels. Your inference was wrong 15 iterations ago. | **Incompetent** |
| **Thoroughness** | "3 iterations is enough, ship it" | The label still overlaps. The user sees it on the first glance. | **Sloppy** |

**The protocol is not overhead you pay. It is the service you provide.**
