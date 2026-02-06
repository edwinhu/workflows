---
name: visual-verify
version: 1.0
description: "Internal skill for visual output verification loops. NOT user-facing - invoked by dev-implement, ds-implement, or writing-draft when tasks involve rendered visual output. Uses context-enriched Gemini vision calls inside a ralph-loop structure."
---

**Announce:** "I'm using visual-verify to set up a render-vision-fix loop."

## Where This Fits

```
Main Chat (orchestrator)
  |
  v
visual-verify (this skill) <- replaces ralph-loop for visual tasks
  |
  +-- Spawn Task agent  -> makes source code changes
  +-- Render step        -> produces PNG from source
  +-- Vision step        -> look-at with enriched context
  +-- Parse + decide     -> PASS (promise) or FAIL (iterate)
```

**This skill IS the loop for visual tasks.** Do not wrap it inside a plain ralph-loop -- that creates redundant nesting.

## Contents

- [The Iron Law](#the-iron-law-of-visual-verification)
- [The Loop](#the-visual-verify-loop)
- [Context Assembly](#context-assembly)
- [Render Step](#render-step)
- [Vision Step](#vision-step)
- [Parsing Feedback](#parsing-gemini-feedback)
- [Integration](#integration)
- [Rationalization Prevention](#rationalization-prevention)
- [Examples](#examples)

<EXTREMELY-IMPORTANT>
## The Iron Law of Visual Verification

**NO VISUAL TASK IS COMPLETE WITHOUT RENDERING AND LOOKING AT THE OUTPUT.**

For ANY task that produces visual output (slides, charts, documents, UI), you MUST:
1. RENDER the output to an image
2. LOOK AT it with context-enriched Gemini vision
3. PARSE the feedback
4. FIX or CONFIRM

You CANNOT claim a visual task is done by:
- Reading the source code and deciding "it looks correct"
- Trusting that the code compiles without errors
- Assuming the layout is right because the content is right
- Checking only that no errors were thrown

**Source code correctness does NOT imply visual correctness.**
</EXTREMELY-IMPORTANT>

## The Visual-Verify Loop

### Invocation

Load this skill, then start a ralph loop:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/visual-verify/SKILL.md")

Skill(skill="ralph-loop:ralph-loop", args="Visual Task N: [TASK NAME] --max-iterations 5 --completion-promise VTASKN_DONE")
```

### Inside Each Iteration

```
1. CHANGE  -> Spawn Task agent to modify source code
       |
2. RENDER  -> Produce PNG image from source
       |      render fails? -> fix source, back to step 1
       |
3. VISION  -> Context-enriched look-at call
       |      Gemini gets: spec + source intent + checklist + prior feedback
       |
4. DECIDE  -> PASS: output promise
              FAIL: extract suggestions, feed back into step 1
```

### Step 1: Make Changes

For the first iteration, the Task agent implements the visual feature from scratch. For subsequent iterations, it receives Gemini's feedback as instructions.

```
Task(subagent_type="general-purpose", prompt="""
Implement/Fix: [TASK NAME]

## What to Build
[spec text / requirements]

## Render Command
After making changes, render the output:
[render command]

## Previous Visual Feedback -- iteration [N]
[Gemini's feedback from previous iteration, or "First iteration - no feedback yet"]

## Suggested Fixes from Visual Reviewer
[extracted fix suggestions from Gemini, or "N/A"]

Report: what was changed and why.
""")
```

### Step 2: Render

Execute the render command. See `references/render-commands.md` for domain-specific commands.

**If render fails:** Do NOT proceed to vision step. Fix the source code first. A compile error is not a visual issue.

### Step 3: Vision Check

This is the key step. Gemini is not just describing what it sees -- it is reviewing the output against known criteria and providing actionable suggestions back to the Claude orchestrator.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "[ASSEMBLED CONTEXT-ENRICHED GOAL]" \
    --model "gemini-3-flash"
```

**Model selection:**
- Default: `gemini-3-flash` (visual review needs stronger reasoning than flash-lite)
- Complex layouts: `gemini-3-pro-preview` (highest accuracy for detailed comparison)
- Tasks requiring measurement or counting: add `--agentic`

### Step 4: Decide

Parse Gemini's response:
- If response contains "PASS" and no issues listed -> output the promise
- If response contains "FAIL" or lists issues -> extract suggestions, iterate

## Context Assembly

<EXTREMELY-IMPORTANT>
## The Iron Law of Context

**NEVER CALL look-at WITH A GENERIC GOAL FOR VISUAL VERIFICATION.**

Generic goals produce generic descriptions. Context-enriched goals produce actionable reviews.

| Generic (WRONG) | Context-Enriched (RIGHT) |
|-----------------|-------------------------|
| "Describe this image" | "Review this Typst slide against these criteria: [spec]. Check alignment of the 2x2 grid. Previous issue: title was clipped." |
| "What does this chart show?" | "This matplotlib chart should show quarterly revenue 2020-2024 with bars. The y-axis should be in millions. Check legend colors: blue=Q1, red=Q2." |
| "Analyze this screenshot" | "This Typst document footer should have page numbers. Section headers should be 18pt. Check the table on page 2 has proper borders." |

**If your goal doesn't reference the spec, you're doing image description, not visual verification.**
</EXTREMELY-IMPORTANT>

### Goal Assembly Template

Assemble the goal string from workflow context:

```
You are a visual reviewer. Provide ACTIONABLE suggestions for the implementer.

## What This Should Be
{spec_text -- from SPEC.md, PLAN.md task description, or user request}

## Source Intent
{what the code is trying to produce -- e.g., "A slide with a 2x2 grid showing quarterly revenue"}

## Check These Specifically
{domain-specific checklist items -- see references/goal-templates.md}

## Previous Issues -- iteration {N}
{feedback from prior iteration, or "First iteration - no prior issues."}

## Your Review
1. Does the render match the spec description above? If not, what SPECIFICALLY is wrong?
2. Are there visual issues? Check:
   - Text readability -- size, contrast, clipping
   - Layout alignment -- spacing, centering, margins
   - Data accuracy -- if chart: do values look reasonable?
   - Color/styling consistency
3. For each issue, suggest a SPECIFIC code change.

Rate: PASS -- all criteria met, or FAIL -- list each issue with fix suggestion.
```

### Where Context Comes From

| Context Piece | Source | How to Get |
|---------------|--------|-----------|
| `spec_text` | SPEC.md, PLAN.md task, or user request | Read the relevant doc, paste visual requirements |
| `source_description` | The source code being rendered | Brief summary of what the code produces |
| `checklist_items` | Domain + task specific | See `references/goal-templates.md` |
| `previous_feedback` | Gemini's output from prior iteration | Direct paste from previous look-at call |

## Render Step

See `references/render-commands.md` for the full reference. Quick summary:

| Domain | Command |
|--------|---------|
| Typst | `tinymist compile input.typ /tmp/visual-verify.png --pages N --ppi 144` |
| Python | `python3 script.py` (script saves to known output path) |
| Screenshot | macOS: `screencapture -x /tmp/visual-verify.png` |
| Custom | Any command producing a PNG at known path |

### Render Failure Handling

```
Render command executed
    |
Exit code 0?
    +-- NO  -> Compile/syntax error. Fix source code. Do NOT call look-at.
    +-- YES -> Proceed to vision step
                |
Output file exists and is non-empty?
    +-- NO  -> Render silently failed. Check command and paths.
    +-- YES -> Proceed to vision step
```

## Parsing Gemini Feedback

Gemini's response will be structured thanks to the goal template. Parse it:

1. **Look for PASS/FAIL verdict** at the end
2. **If FAIL, extract numbered issues** and their suggested fixes
3. **Feed issues + fixes into next iteration's Task agent prompt**

Example Gemini response:
```
1. The title "Q3 Revenue" is partially clipped at the top. Top margin too small.
   Fix: Increase #set page(margin: (top: 2cm)) to (top: 3cm).

2. Bar chart legend overlaps with the last data point.
   Fix: Add legend.position = "outside right" or increase chart width.

3. Body text readable. Colors consistent. Grid alignment correct.

Rate: FAIL (2 issues found)
```

Feed back as:
```
## Previous Visual Feedback -- iteration 2
1. Title "Q3 Revenue" clipped at top - increase top margin to 3cm
2. Bar chart legend overlaps last data point - move legend outside or increase width
```

## Integration

### Dev Workflow

When a task in PLAN.md involves visual output, use visual-verify instead of plain ralph-loop:

```
For task N (visual):
    1. Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/visual-verify/SKILL.md")
    2. Start visual-verify loop
    3. Inside loop: delegate -> render -> vision check -> decide
    4. Promise when PASS -> move to task N+1
```

**Detection:** If PLAN.md task mentions "render", "slide", "chart", "figure", "layout", "UI", or "visual" -> use visual-verify.

### DS Workflow

When generating charts or visualizations in a data science pipeline:

```
For visualization task:
    1. Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/visual-verify/SKILL.md")
    2. After chart code runs: render to PNG
    3. Vision check with context (expected data, trends, axis labels)
    4. Fix or confirm
```

### Writing Workflow

When working with Typst documents:

```
After drafting a section with Typst rendering:
    1. Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/visual-verify/SKILL.md")
    2. Render the Typst document
    3. Vision check against outline/precis requirements
    4. Fix layout/formatting issues
```

### Standalone

For any ad-hoc visual task outside a workflow:

```
1. Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/visual-verify/SKILL.md")
2. Implement the visual artifact
3. Run the visual-verify loop
```

## Rationalization Prevention

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The code compiles, so it looks right" | Compiling proves syntax, not visual correctness | Render and look at it |
| "I checked the source code carefully" | Source code is not pixels. You cannot infer alignment from code. | Render and look at it |
| "Gemini just describes images, not useful" | Gemini WITH CONTEXT is a reviewer, not a descriptor | Assemble context, then look |
| "Vision API calls are slow/expensive" | One Gemini Flash call costs <$0.001 and takes <2 seconds | Call it. Every time. |
| "I'll visually verify at the end" | You'll have 10 issues compounding. Verify each change. | Render and look after every change |
| "The previous render looked fine, this small change won't break it" | Small changes cause clipping, overflow, and alignment shifts | Render and look. Every time. |
| "A generic look-at goal is sufficient" | Generic goals give generic descriptions | Assemble full context |
| "I can describe the expected output in words" | Words are not pixels. "Centered" means different things in code vs. reality. | Render to see reality |

### Red Flags -- STOP Immediately

| Thought | Do Instead |
|---------|-----------|
| "I'll skip the render, the code is obviously correct" | STOP. Render it. "Obviously correct" code produces "obviously wrong" output. |
| "Gemini won't understand this domain" | STOP. That's why you provide context. Context-enriched goals tell Gemini exactly what to check. |
| "One more code change, then I'll render" | STOP. Render NOW. Each unverified change compounds risk. |
| "The goal template is too verbose" | STOP. Verbose context = precise feedback. Terse context = useless description. |
| "I'll use Read to look at the image myself" | STOP. Use look-at. Reading images wastes context tokens. |

### Honesty Framing

<EXTREMELY-IMPORTANT>
**Claiming a visual task is complete without rendering and reviewing the output is LYING.**

When you say "slide is done" or "chart is correct", you are asserting:
- You rendered the output to an image
- You reviewed the image against the spec
- The image matches the spec

If you did not render AND review, you are not "moving on" -- you are LYING about the visual state.

**"Still rendering and checking" is honest. "Done" without visual evidence is fraud.**
</EXTREMELY-IMPORTANT>

## Examples

### Example 1: Typst Slide

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task 1: Title Slide --max-iterations 5 --completion-promise VTASK1_DONE")

[Spawn Task agent -> creates title slide in Typst]

# Render
tinymist compile presentation.typ /tmp/visual-verify.png --pages 1 --ppi 144

# Vision check with context
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "You are reviewing a Typst presentation title slide.

## What This Should Be
Title: 'Quarterly Business Review Q3 2025'
Subtitle: 'Revenue Growth and Strategic Initiatives'
Author: 'Jane Smith, CFO'
University theme with 16:9 aspect ratio.

## Check These Specifically
- Title is large, centered, and not clipped
- Subtitle is smaller than title, below it
- Author visible in lower portion
- No text overlapping or running off edges

## Previous Issues
First iteration - no prior issues.

## Your Review
Rate PASS or FAIL with specific issues and fix suggestions." \
    --model "gemini-3-flash"

# Gemini responds: PASS
<promise>VTASK1_DONE</promise>
```

### Example 2: Chart with Iteration

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task 2: Revenue Chart --max-iterations 5 --completion-promise VTASK2_DONE")

# Iteration 1
[Spawn Task agent -> creates matplotlib chart]
[Render: python3 charts/revenue.py]
[Vision check with spec context about expected data, axis labels, colors]

# Gemini responds: FAIL
# - Y-axis label missing units (should be "Revenue ($M)")
# - Legend overlaps data in Q3

# Iteration 2
[Spawn Task agent with Gemini's feedback as instructions]
[Re-render]
[Vision check with updated previous_feedback]

# Gemini responds: PASS
<promise>VTASK2_DONE</promise>
```

### Example 3: Quick One-Off Check (No Loop)

For a single visual check outside a loop:

```
tinymist compile document.typ /tmp/quick-check.png --pages 3 --ppi 144

python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/quick-check.png" \
    --goal "Check this Typst document page: table should have 4 columns with alternating row shading. Headers should be bold. Check alignment and readability." \
    --model "gemini-3-flash"
```

## When NOT to Use Visual-Verify

- **Text-only verification**: If the output is purely textual (test output, CLI output), use standard dev-verify.
- **Compilation checks**: If you only need "does it compile?", just run the compile command.
- **Exact pixel matching**: This is not a pixel-diff tool. It checks semantic visual correctness.
