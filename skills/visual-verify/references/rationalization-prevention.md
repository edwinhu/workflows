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
| "I should use --agentic because it's Python" | Source language doesn't matter — image complexity does. A simple bar chart doesn't need crop/zoom. | Route on image density: 5+ nodes, small labels, edge clipping → agentic. Simple/large → vision-only. |
| "I don't need --agentic for this Typst diagram" | A dense Fletcher diagram with 8 nodes and 12 arrows has fine-grained details Gemini will miss at full resolution. | Route on image density, not source language. Dense diagrams benefit from agentic crop/zoom regardless of source. |
| "Gemini's pixel measurements won't translate" | Structured measurements translate better than vague descriptions | Request the structured format |

## Red Flags -- STOP Immediately

| Thought | Do Instead |
|---------|-----------|
| "I'll skip the render, the code is obviously correct" | STOP. Render it. "Obviously correct" code produces "obviously wrong" output. |
| "Gemini won't understand this domain" | STOP. That's why you provide context. Context-enriched goals tell Gemini exactly what to check. |
| "One more code change, then I'll render" | STOP. Render NOW. Each unverified change compounds risk. |
| "The goal template is too verbose" | STOP. Verbose context = precise feedback. Terse context = useless description. |
| "I'll use Read to look at the image myself" | STOP. Use look-at. Reading images wastes context tokens. |
| "I'll use --agentic for everything to be safe" | STOP. --agentic on simple images adds latency without value. Route on image complexity, not "safety." |
| "This fletcher diagram needs 1 more iteration" (iteration 4+) | STOP. Use the reference sketch approach. Incremental fixes aren't converging. |
| "Score is 9.5 so I'm done" but you see an arrow pointing to empty space | STOP. The score is necessary but not sufficient. Check the 9 defect categories. Gemini misses structural issues. |
| "It's defect-free so I'm done" but it doesn't match the design intent | STOP. A defect-free diagram that argues the wrong thing is still wrong. Check intent first, then defects. |
| "One clean pass, ship it" | STOP. One pass catches bugs. A second pass catches composition — lopsided layout, cramped sections, inconsistent spacing. At least 2 clean passes. |
| "Let me try page N, N+1, N+2..." to find a slide | STOP. Use `Skill("teaching:find-slide-page")` — one `typst query` returns ALL heading→page mappings. Sequential page-hunting wastes 5-15 tool calls. |
| "I'll use pdftotext to search for the heading" | STOP. `find-slide-page` does this in one call with zero error. Manual pdftotext loops are the anti-pattern it was built to eliminate. |

## Drive-Aligned Framing

| Drive | Why You Skip | What Actually Happens | Drive You Failed |
|-------|-------------|----------------------|-----------------|
| **Helpfulness** | "Skip render to deliver faster" | User gets broken visual output. They see the bugs you didn't check for. | **Anti-helpful** |
| **Efficiency** | "Use --agentic everywhere, one size fits all" | Simple images waste 5-10 seconds on crop/zoom loops with nothing to find. Dense images without it miss clipping and arrow misroutes. | **Anti-efficient** |
| **Competence** | "I can infer layout from source code" | Source code is not pixels. Your inference was wrong 15 iterations ago. | **Incompetent** |
| **Thoroughness** | "3 iterations is enough, ship it" | The label still overlaps. The user sees it on the first glance. | **Sloppy** |
| **Helpfulness** | "Score hit 9.5, declare done" | Score checks checklist items but misses structural issues — arrows to empty space, inconsistent sub-diagram layout. User opens the slide and immediately sees what Gemini didn't report. | **Anti-helpful** |

**The protocol is not overhead you pay. It is the service you provide.**
