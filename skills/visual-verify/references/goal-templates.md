# Goal Templates for Visual Verification (v2.0)

Copy-paste templates for context-enriched look-at goals. Replace bracketed placeholders with actual values.

**Domain routing determines which template family to use:**
- **Python-native** (matplotlib, seaborn, plotly): Gemini can execute code, suggest exact Python fixes
- **Non-Python** (Typst, R, JS, HTML, LaTeX): Gemini provides structured pixel feedback, Claude translates

---

## Python-Native Templates (use with `--agentic`)

### Matplotlib / Seaborn Charts

```
You are reviewing a Python-generated data visualization.
You have access to matplotlib, seaborn, numpy, pandas, and PIL.

## What This Should Be
[description -- e.g., "Bar chart showing quarterly revenue 2020-2024 by product line"]

## The Python Code That Generated This
[paste the relevant plotting code]

## Check These Specifically
- Axis labels present, readable, and correctly named
- Legend present and matches data series
- Title present and descriptive
- Data points/bars/lines clearly distinguishable
- No overlapping text or labels
- Color palette accessible (not red-green only)
- Scale appropriate (no misleading axes, proper units)
- Grid lines appropriate for the chart type
- Figure size reasonable (not squished or stretched)

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review
1. Reproduce the key elements in your sandbox to verify measurements
2. For each issue found, experiment with a fix in your sandbox
3. Provide the EXACT Python code change (not "try adjusting X")
Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each with severity and specific code fix.
```

### Plotly Interactive Charts

```
You are reviewing a Python-generated interactive visualization.
You have access to matplotlib, numpy, pandas, and PIL (but not plotly itself).

## What This Should Be
[description -- e.g., "Scatter plot with hover labels showing company names and revenue"]

## The Python Code That Generated This
[paste the relevant plotly code]

## Check These Specifically
- All traces visible and distinguishable
- Axis titles and tick labels readable
- Legend entries match data series
- Color scale appropriate for data type
- Layout dimensions and margins correct
- Annotations positioned correctly

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review
1. Examine the rendered static image for visual issues
2. Use your sandbox to verify measurements if needed (matplotlib equivalent)
3. Provide EXACT plotly code changes for each issue
Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each with severity and specific code fix.
```

---

## Non-Python Templates (vision-only, NO `--agentic`)

### Typst Slides

```
You are reviewing a rendered image. You CANNOT run Typst code.
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
[description from spec/plan -- e.g., "Title slide with university theme, 16:9 aspect ratio"]

## Check These Specifically
- Title and subtitle visible and not clipped
- Font sizes appropriate (headers larger than body)
- Content centered and balanced within the slide
- No text overlapping or running off edges
- No content clipped by slide boundaries (diagrams, labels, nodes cut off at edges)
- Theme elements (header bar, footer, logo) properly rendered
- Bullet points or numbered lists properly aligned
- Images/figures not overlapping text
- Aspect ratio correct (no stretching)

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue (e.g., "slide title text")
2. **Problem**: What's wrong (e.g., "clipped at right edge, last 2 words missing")
3. **Location**: Approximate position (e.g., "top-center of slide, ~15% from top")
4. **Severity**: BLOCKING (prevents reading) or COSMETIC (readable but ugly)
5. **Direction**: Which direction to move/resize (e.g., "reduce font size by ~20% or add line break")

Do NOT suggest Typst code changes — you don't know the language.
Do NOT run Python code to analyze the image — just look at it and report.

Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each in structured format above.
```

### Typst Documents

```
You are reviewing a rendered image. You CANNOT run Typst code.
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
[description -- e.g., "Academic paper with two-column layout, Chicago citation style"]

## Check These Specifically
- Margins consistent on all sides
- Headers and footers present and correctly formatted
- Page numbers visible and correctly positioned
- Tables have proper borders, alignment, and readable text
- Figures have captions and are properly sized
- Footnotes properly numbered and positioned
- Paragraph spacing and line height appropriate
- Citations formatted correctly

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue
2. **Problem**: What's wrong
3. **Location**: Approximate position in the page
4. **Severity**: BLOCKING or COSMETIC
5. **Direction**: Which direction to move/resize

Do NOT suggest Typst code changes — you don't know the language.
Do NOT run Python code to analyze the image — just look at it and report.

Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each in structured format above.
```

### Typst Diagrams (fletcher, CeTZ)

```
You are reviewing a rendered diagram image. You CANNOT run Typst/fletcher code.
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
[description -- e.g., "Flow diagram showing securitization process with 5 entities"]

## Check These Specifically
- All nodes fully visible — no clipping at slide edges (top, bottom, left, right)
- All node text readable (no clipped or truncated labels)
- Arrows connect correct nodes with correct direction
- Labels on arrows readable and not overlapping arrows or nodes
- Node sizes sufficient for their text content
- Spacing between nodes even and balanced
- No overlapping elements (nodes, arrows, labels)
- Overall layout balanced (not squished to one side)
- Entire diagram fits within the slide with margin — nothing touching or cut off at edges

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue (e.g., "label 'Pro rata share' on arrow from Bank A to SPV")
2. **Problem**: What's wrong (e.g., "overlaps with the arrow line, making both unreadable")
3. **Location**: Approximate position (e.g., "center-left, ~40% from top")
4. **Severity**: BLOCKING or COSMETIC
5. **Direction**: Specific fix direction (e.g., "move label 15-20px above the arrow, or offset to the left")

Do NOT suggest fletcher/CeTZ code changes — you don't know the language.
Do NOT run Python code to analyze the image — just look at it and report.

Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each in structured format above.
```

### R / ggplot2 Charts

```
You are reviewing a rendered image. You CANNOT run R code.
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
[description -- e.g., "Scatter plot with regression line and confidence interval"]

## Check These Specifically
- Axis labels present, readable, and correctly named
- Legend present and matches data series
- Title present and descriptive
- Data points clearly distinguishable
- No overlapping text or labels
- Color palette appropriate
- Scale and units correct

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue
2. **Problem**: What's wrong
3. **Location**: Approximate position
4. **Severity**: BLOCKING or COSMETIC
5. **Direction**: Specific fix direction

Do NOT suggest R code changes — you don't know the rendering context.
Do NOT run Python code to analyze the image — just look at it and report.

Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each in structured format above.
```

### Web UI (HTML/CSS/JS)

```
You are reviewing a rendered image. You CANNOT run the web application.
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
[description -- e.g., "Login page with email/password fields and a submit button"]

## Check These Specifically
- All expected elements visible on screen
- Text readable at normal viewing distance
- Buttons/interactive elements visually distinguishable
- Layout matches wireframe/mockup specifications
- No overlapping or clipped elements
- Responsive layout correct for the viewport size
- Color contrast meets accessibility guidelines

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue
2. **Problem**: What's wrong
3. **Location**: Approximate position
4. **Severity**: BLOCKING or COSMETIC
5. **Direction**: Specific fix direction (e.g., "increase padding-top by ~10px")

Do NOT suggest CSS/HTML/JS code changes — you don't know the full context.
Do NOT run Python code to analyze the image — just look at it and report.

Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each in structured format above.
```

---

## General Templates

### General Non-Python (any visual output)

Use when none of the specific non-Python templates fit:

```
You are reviewing a rendered image. You CANNOT run the source language ({language}).
Your job is to provide PRECISE VISUAL MEASUREMENTS that the implementer can translate.

## What This Should Be
[description from spec/plan]

## Check These Specifically
[list domain-specific items to verify]

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review — STRUCTURED FORMAT REQUIRED

For EACH issue found, report ALL of these:
1. **Element**: What element has the issue
2. **Problem**: What's wrong
3. **Location**: Approximate position
4. **Severity**: BLOCKING or COSMETIC
5. **Direction**: Specific fix direction

Do NOT suggest source code changes — you don't know the language.
Do NOT run Python code to analyze the image — just look at it and report.

Score: [0-10] (fraction of checklist items passing, 9.5 = 95% compliant)
Issues: list each in structured format above.
```
