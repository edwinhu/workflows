# Goal Templates for Visual Verification

Copy-paste templates for context-enriched look-at goals. Replace bracketed placeholders with actual values.

## Typst Slides

```
You are reviewing a Typst presentation slide.

## What This Should Be
[description from spec/plan -- e.g., "Title slide with university theme, 16:9 aspect ratio"]

## Source Intent
[what the Typst code is trying to produce -- e.g., "A polaris theme slide with a 2x2 grid of charts"]

## Check These Specifically
- Title and subtitle visible and not clipped
- Font sizes appropriate (headers larger than body)
- Content centered and balanced within the slide
- No text overlapping or running off edges
- Theme elements (header bar, footer, logo) properly rendered
- Bullet points or numbered lists properly aligned
- Images/figures not overlapping text
- Aspect ratio correct (no stretching)

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review
1. Does the render match the spec description above? If not, what SPECIFICALLY is wrong?
2. Are there visual issues (readability, alignment, clipping, spacing)?
3. For each issue, suggest a SPECIFIC Typst code change.
Rate: PASS or FAIL with specific issues and fix suggestions.
```

## Typst Documents

```
You are reviewing a rendered Typst document page.

## What This Should Be
[description -- e.g., "Academic paper with two-column layout, Chicago citation style"]

## Source Intent
[what the code produces -- e.g., "Page 3 with a data table and footnotes"]

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

## Your Review
1. Does the render match the spec description above? If not, what SPECIFICALLY is wrong?
2. Are there formatting issues (margins, spacing, alignment)?
3. For each issue, suggest a SPECIFIC Typst code change.
Rate: PASS or FAIL with specific issues and fix suggestions.
```

## Matplotlib / Seaborn Charts

```
You are reviewing a rendered data visualization.

## What This Should Be
[description -- e.g., "Bar chart showing quarterly revenue 2020-2024 by product line"]

## Source Intent
[what the Python code produces -- e.g., "Grouped bar chart with 4 quarters x 3 product lines"]

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
1. Does the chart show the data described in the spec? If not, what's wrong?
2. Are there visual issues (readability, overlapping labels, wrong colors)?
3. For each issue, suggest a SPECIFIC matplotlib/seaborn code change.
Rate: PASS or FAIL with specific issues and fix suggestions.
```

## UI Screenshots

```
You are reviewing a UI screenshot.

## What This Should Be
[description -- e.g., "Login page with email/password fields and a submit button"]

## Source Intent
[what the code renders -- e.g., "React component with form validation and error states"]

## Check These Specifically
- All expected elements visible on screen
- Text readable at normal viewing distance
- Buttons/interactive elements visually distinguishable
- Layout matches wireframe/mockup specifications
- No overlapping or clipped elements
- Responsive layout correct for the viewport size
- Color contrast meets accessibility guidelines
- Loading states or error states rendered correctly (if applicable)

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review
1. Does the UI match the spec description above? If not, what SPECIFICALLY is wrong?
2. Are there visual issues (alignment, contrast, clipping, spacing)?
3. For each issue, suggest a SPECIFIC code change.
Rate: PASS or FAIL with specific issues and fix suggestions.
```

## General (Any Visual Output)

Use this when none of the above templates fit:

```
You are reviewing a rendered visual output.

## What This Should Be
[description from spec/plan]

## Source Intent
[what the source code is trying to produce]

## Check These Specifically
- [list domain-specific items to verify]

## Previous Issues -- iteration [N]
[feedback from prior iteration, or "First iteration - no prior issues."]

## Your Review
1. Does the render match the spec description above? If not, what SPECIFICALLY is wrong?
2. Are there visual issues?
3. For each issue, suggest a SPECIFIC code change.
Rate: PASS or FAIL with specific issues and fix suggestions.
```
