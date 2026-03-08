---
name: visual-verify
version: 2.0
description: "This skill should be used when the user asks to 'verify visual output', 'check how it looks', 'render and review', 'visual verify', 'check the slide', 'does this look right', or when any task produces rendered visual output (slides, charts, documents, UI). Starts a render-vision-fix loop using Gemini vision."
---

**Announce:** "I'm using visual-verify to set up a render-vision-fix loop."

## Where This Fits

```
Main Chat (orchestrator)
  |
  v
visual-verify (this skill) <- replaces ralph-loop for visual tasks
  |
  +-- Detect domain       -> Python-native or non-Python?
  |
  +-- PYTHON PATH          (matplotlib, seaborn, plotly)
  |   +-- Agentic mode    -> Gemini executes + fixes the actual Python code
  |   +-- Full code loop   -> Gemini can reproduce, tweak, and verify in sandbox
  |
  +-- NON-PYTHON PATH      (Typst, R, JS, HTML, custom)
      +-- Vision-only mode -> Gemini reviews the rendered PNG
      +-- Pixel feedback   -> structured measurements, coordinates, overlap detection
      +-- Claude translates -> converts pixel feedback into source code changes
```

**This skill IS the loop for visual tasks.** Do not wrap it inside a plain ralph-loop -- that creates redundant nesting.

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

<EXTREMELY-IMPORTANT>
## The Iron Law of Domain Routing

**DETECT THE DOMAIN BEFORE CHOOSING THE VERIFICATION PATH.**

| Domain | Path | `--agentic`? | Why |
|--------|------|-------------|-----|
| Python (matplotlib, seaborn, plotly) | **Python-native** | YES | Gemini can execute and fix the actual plotting code |
| Typst, R, JS, HTML, LaTeX | **Non-Python** | NO | Gemini cannot run these languages; code execution adds latency for PIL crops that don't help |

**If you use `--agentic` for Typst/R/JS, you are wasting time.** Gemini's code execution sandbox only runs Python. For non-Python domains, it falls back to PIL image manipulation (cropping, measuring) which adds latency without producing actionable fixes.

**If you skip `--agentic` for Python plots, you are leaving value on the table.** Gemini can reproduce the chart in its sandbox, experiment with layout changes, and verify fixes before suggesting them.
</EXTREMELY-IMPORTANT>

## Domain Detection

```
Source file extension or render command?
    |
    +-- .py, matplotlib, seaborn, plotly, pandas plot
    |   → PYTHON-NATIVE PATH
    |
    +-- .typ, typst, tinymist, fletcher
    |   → NON-PYTHON PATH (Typst)
    |
    +-- .R, .Rmd, ggplot
    |   → NON-PYTHON PATH (R)
    |
    +-- .js, .jsx, .tsx, .html, .css, playwright
    |   → NON-PYTHON PATH (Web/UI)
    |
    +-- .tex, pdflatex, xelatex
    |   → NON-PYTHON PATH (LaTeX)
    |
    +-- Unknown
        → NON-PYTHON PATH (default to vision-only)
```

## The Visual-Verify Loop

### Invocation

Load this skill, then start a ralph loop:

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")

Skill(skill="ralph-loop:ralph-loop", args="Visual Task N: [TASK NAME] --max-iterations 5 --completion-promise VTASKN_DONE")
```

### Inside Each Iteration

```
1. CHANGE  -> Spawn Task agent to modify source code
       |
2. RENDER  -> Produce PNG image from source
       |      render fails? -> fix source, back to step 1
       |
3. VISION  -> Domain-routed look-at call
       |      Python? -> --agentic (Gemini executes code)
       |      Non-Python? -> vision-only (structured pixel feedback)
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

### Step 3: Vision Check (Domain-Routed)

#### Python-Native Path (`--agentic`)

For matplotlib, seaborn, plotly, and other Python visualization code:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "[PYTHON-NATIVE GOAL - see below]" \
    --agentic
```

**Why agentic works here:** Gemini's sandbox has matplotlib, seaborn, numpy, pandas, PIL, and scipy. It can:
- Reproduce the chart from the data
- Experiment with layout changes (legend position, margins, font sizes)
- Verify its fixes produce correct output before suggesting them
- Measure pixel-precise positions using actual matplotlib coordinate systems

**Python-native goal template:**

```
You are reviewing a Python-generated data visualization.
You have access to matplotlib, seaborn, numpy, pandas, and PIL.

## What This Should Be
{spec_text}

## The Python Code That Generated This
{paste the relevant plotting code}

## Check These Specifically
{checklist items}

## Previous Issues -- iteration {N}
{prior feedback}

## Your Review
1. Reproduce the key elements in your sandbox to verify measurements
2. For each issue found, experiment with a fix in your sandbox
3. Provide the EXACT Python code change (not "try adjusting X")
Rate: PASS or FAIL with specific code fixes.
```

#### Non-Python Path (vision-only)

For Typst, R, JS, HTML, LaTeX, and all other non-Python domains:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "[STRUCTURED PIXEL FEEDBACK GOAL - see below]"
```

**No `--agentic` flag.** Gemini cannot run Typst/R/JS code. The `--agentic` flag would only let it run PIL image analysis, which adds latency without producing actionable source-language fixes.

**Non-Python goal template (structured pixel feedback):**

```
You are reviewing a rendered image. You CANNOT run the source language ({language}).
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
{spec_text}

## Check These Specifically
{checklist items}

## Previous Issues -- iteration {N}
{prior feedback}

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue (e.g., "label 'Pro rata share'")
2. **Problem**: What's wrong (e.g., "overlaps with arrow between Bank A and Arranging Bank")
3. **Location**: Approximate position (e.g., "center-left of image, ~40% from top")
4. **Severity**: BLOCKING (prevents reading) or COSMETIC (readable but ugly)
5. **Direction**: Which direction to move/resize (e.g., "move label 15-20px left and 10px down")

Do NOT suggest source code changes — you don't know the language.
Do NOT run Python code to analyze the image — just look at it and report.

Rate: PASS (all criteria met) or FAIL (list each issue in structured format above).
```

**Why this works better for non-Python:** Instead of Gemini producing vague feedback like "labels overlap," it produces structured measurements that Claude can translate into precise coordinate changes. The structured format eliminates the "Gemini says X, Claude guesses Y" translation problem.

### Step 4: Decide

Parse Gemini's response:
- If response contains "PASS" and no issues listed -> output the promise
- If response contains "FAIL" or lists issues -> extract suggestions, iterate

**For Python-native path:** Feed Gemini's suggested Python code changes directly to the Task agent.

**For non-Python path:** Claude translates pixel measurements into source code changes:

| Gemini says | Claude translates to (Typst example) |
|-------------|--------------------------------------|
| "Move label 15px left" | Adjust `label-pos` or node coordinates by ~0.5em |
| "Text clipped at right edge" | Increase `inset` or reduce `scale()` percentage |
| "Elements overlap vertically" | Increase `spacing` parameter in fletcher-diagram |
| "Font too small to read" | Increase `#set text(Npt)` value |

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

### Python-Native Path

Gemini returns actual Python code changes. Feed them directly to the Task agent:

```
## Previous Visual Feedback -- iteration 2
Gemini tested these fixes in its sandbox:
1. Y-axis: change `ax.set_ylabel("Revenue")` to `ax.set_ylabel("Revenue ($M)")`
2. Legend: change `ax.legend()` to `ax.legend(loc="upper left", bbox_to_anchor=(1, 1))`
These fixes were verified to work in Gemini's sandbox.
```

### Non-Python Path

Gemini returns structured pixel measurements. Claude translates:

```
## Previous Visual Feedback -- iteration 2 (Claude-translated from pixel feedback)
1. Label "Pro rata share" overlaps arrow (center-left, ~40% from top, BLOCKING)
   → Increase fletcher-diagram spacing from (2em, 2em) to (3em, 3em)
   → Or add label-sep: 0.3em to the edge declaration
2. Title clipped at right edge (top-right corner, COSMETIC)
   → Reduce scale from 80% to 75%, or increase page margins
```

## Complex Diagram Strategy (Non-Python)

For complex diagrams (flowcharts, entity diagrams, state machines) that consistently fail visual-verify after 3+ iterations:

### Reference Sketch Approach

When the same issue persists across iterations, have Gemini draw a **reference layout** in matplotlib:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "This diagram has persistent layout issues. Draw a REFERENCE VERSION using matplotlib/networkx showing the IDEAL positions for all nodes and labels. Output the x,y coordinates of each element." \
    --agentic
```

Then translate Gemini's reference coordinates into the target language (Typst fletcher, R ggplot, etc.). This gives Claude concrete positions to aim for instead of incremental guess-and-check.

**Use this only after 3+ failed iterations on the same spatial issue.** Most diagrams resolve within 2 iterations with structured pixel feedback.

## Integration

### Dev Workflow

When a task in PLAN.md involves visual output, use visual-verify instead of plain ralph-loop:

```
For task N (visual):
    1. Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")
    2. Detect domain (Python-native or non-Python?)
    3. Start visual-verify loop with appropriate path
    4. Promise when PASS -> move to task N+1
```

**Detection:** If PLAN.md task mentions "render", "slide", "chart", "figure", "layout", "UI", or "visual" -> use visual-verify.

### DS Workflow

When generating charts or visualizations in a data science pipeline:

```
For visualization task:
    1. Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")
    2. This is almost always Python-native → use --agentic
    3. Gemini can reproduce the chart, experiment with fixes
    4. Fix or confirm
```

### Writing Workflow

When working with Typst documents:

```
After drafting a section with Typst rendering:
    1. Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")
    2. This is non-Python → use vision-only with structured pixel feedback
    3. Claude translates pixel feedback into Typst code changes
    4. Fix layout/formatting issues
```

### Standalone

For any ad-hoc visual task outside a workflow:

```
1. Read("${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/SKILL.md")
2. Detect domain
3. Implement the visual artifact
4. Run the visual-verify loop with the correct path
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
| "I should use --agentic for this Typst diagram" | Gemini can't run Typst. --agentic just adds PIL overhead. | Use vision-only with structured pixel feedback |
| "I don't need --agentic for this matplotlib chart" | Gemini CAN reproduce and fix Python charts in its sandbox. | Use --agentic for Python. Always. |
| "Gemini's pixel measurements won't translate" | Structured measurements translate better than vague descriptions | Request the structured format |

### Red Flags -- STOP Immediately

| Thought | Do Instead |
|---------|-----------|
| "I'll skip the render, the code is obviously correct" | STOP. Render it. "Obviously correct" code produces "obviously wrong" output. |
| "Gemini won't understand this domain" | STOP. That's why you provide context. Context-enriched goals tell Gemini exactly what to check. |
| "One more code change, then I'll render" | STOP. Render NOW. Each unverified change compounds risk. |
| "The goal template is too verbose" | STOP. Verbose context = precise feedback. Terse context = useless description. |
| "I'll use Read to look at the image myself" | STOP. Use look-at. Reading images wastes context tokens. |
| "I'll use --agentic for everything to be safe" | STOP. --agentic on non-Python adds latency without value. Route correctly. |
| "This fletcher diagram needs 1 more iteration" (iteration 4+) | STOP. Use the reference sketch approach. Incremental fixes aren't converging. |

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

### Drive-Aligned Consequences

| Drive | Why You Skip | What Actually Happens | Drive You Failed |
|-------|-------------|----------------------|-----------------|
| **Helpfulness** | "Skip render to deliver faster" | User gets broken visual output. They see the bugs you didn't check for. | **Anti-helpful** |
| **Efficiency** | "Use --agentic everywhere, one size fits all" | Typst tasks waste 5-10 seconds per call on useless PIL code. Python tasks miss the sandbox advantage. | **Anti-efficient** |
| **Competence** | "I can infer layout from source code" | Source code is not pixels. Your inference was wrong 15 iterations ago. | **Incompetent** |
| **Thoroughness** | "3 iterations is enough, ship it" | The label still overlaps. The user sees it on the first glance. | **Sloppy** |

**The protocol is not overhead you pay. It is the service you provide.**

## Examples

### Example 1: Typst Slide (Non-Python Path)

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task 1: Title Slide --max-iterations 5 --completion-promise VTASK1_DONE")

[Spawn Task agent -> creates title slide in Typst]

# Render
tinymist compile presentation.typ /tmp/visual-verify.png --pages 1 --ppi 144

# Vision check — NON-PYTHON PATH (no --agentic)
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "You are reviewing a Typst presentation slide. You CANNOT run Typst.

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

## Your Review — STRUCTURED FORMAT REQUIRED
For EACH issue: Element, Problem, Location, Severity, Direction.
Rate PASS or FAIL."

# Gemini responds: PASS
<promise>VTASK1_DONE</promise>
```

### Example 2: Matplotlib Chart (Python-Native Path)

```
Skill(skill="ralph-loop:ralph-loop", args="Visual Task 2: Revenue Chart --max-iterations 5 --completion-promise VTASK2_DONE")

# Iteration 1
[Spawn Task agent -> creates matplotlib chart]
[Render: python3 charts/revenue.py]

# Vision check — PYTHON-NATIVE PATH (--agentic)
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "You are reviewing a Python-generated chart.
You have matplotlib, seaborn, numpy, pandas in your sandbox.

## What This Should Be
Bar chart showing quarterly revenue 2020-2024 by product line.

## The Python Code
[paste relevant plotting code]

## Your Review
1. Reproduce key elements in your sandbox to verify
2. For each issue, experiment with a fix and provide EXACT code change
Rate: PASS or FAIL with verified code fixes." \
    --agentic

# Gemini responds: FAIL
# - Y-axis label missing units → verified fix: ax.set_ylabel("Revenue ($M)")
# - Legend overlaps data → verified fix: ax.legend(loc="upper left", bbox_to_anchor=(1, 1))

# Iteration 2
[Spawn Task agent with Gemini's VERIFIED code fixes]
[Re-render]
[Vision check with updated feedback]

# Gemini responds: PASS
<promise>VTASK2_DONE</promise>
```

### Example 3: Complex Typst Diagram (Reference Sketch Escalation)

```
# After 3 failed iterations on fletcher diagram label overlap...

# Escalate to reference sketch approach
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/tmp/visual-verify.png" \
    --goal "This diagram has persistent label overlap issues after 3 iterations.
Draw a REFERENCE VERSION using matplotlib/networkx showing ideal positions:
- Borrower node at top
- Arranging Bank in middle
- Banks A, B, C at bottom
- Labels 'Syndicate $$' and 'Pro rata share' positioned CLEAR of all arrows
Output the x,y coordinates of each element and label." \
    --agentic

# Gemini outputs reference coordinates
# Claude translates to fletcher-diagram spacing and label-pos values
# One more iteration with precise coordinates → PASS
```

## When NOT to Use Visual-Verify

- **One-off visual checks**: If you just need to look at an image once without iterating, use `look-at` directly. Visual-verify exists for the loop, not the look.
- **Text-only verification**: If the output is purely textual (test output, CLI output), use standard dev-verify.
- **Compilation checks**: If you only need "does it compile?", just run the compile command.
- **Exact pixel matching**: This is not a pixel-diff tool. It checks semantic visual correctness.
