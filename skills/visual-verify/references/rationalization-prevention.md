# Verification Facts and Red Flags

## Verification Facts

- Compiling proves syntax, and source code is not pixels — alignment, clipping, and overflow cannot be inferred from code (that inference was wrong 15 iterations ago). Claiming visual correctness without rendering is an unverified claim presented as fact: the user gets broken output and sees the bugs you didn't check for.
- One Gemini Flash call costs <$0.001 and takes <2 seconds — "slow/expensive" is never a reason to skip it.
- Small changes cause clipping, overflow, and alignment shifts — a fine previous render says nothing about this one, and deferring verification to "the end" leaves 10 compounding issues. Render and look after every change.
- Gemini WITH CONTEXT is a reviewer, not a descriptor: generic goals produce generic descriptions, while context-enriched goals requesting the structured measurement format produce precise, actionable feedback — structured pixel measurements translate better than vague descriptions. Verbose context = precise feedback; terse context = useless description.

## Red Flags — STOP Immediately

- About to skip the render because "the code is obviously correct" → render it. "Obviously correct" code produces "obviously wrong" output.
- About to make "one more code change, then render" → render NOW. Each unverified change compounds risk.
- About to use Read to look at the image yourself → use Gemini CLI. Reading images wastes context tokens.
- About to run iteration 4+ on a fletcher diagram → incremental fixes aren't converging. Use the reference sketch approach.
- About to declare done on a 9.5 score while you can see an arrow pointing to empty space → the score is necessary but not sufficient. Check the 9 defect categories; Gemini misses structural issues the user sees on first glance.
- About to ship a defect-free diagram that doesn't match the design intent → a defect-free diagram that argues the wrong thing is still wrong. Check intent first, then defects.
- About to ship after one clean pass → one pass catches bugs; a second pass catches composition (lopsided layout, cramped sections, inconsistent spacing). At least 2 clean passes.
- About to page-hunt ("try page N, N+1, N+2...") or run pdftotext loops to find a slide → the `find-slide-page` skill returns ALL heading→page mappings in one `typst query`. Manual hunting wastes 5-15 tool calls and is the anti-pattern the skill was built to eliminate.

**The protocol is not overhead you pay. It is the service you provide.**
