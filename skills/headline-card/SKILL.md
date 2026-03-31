---
name: headline-card
description: "Use this skill when the user asks to add news headline cards, 'Last Week Tonight'-style cards, headline slides, news quote slides, or media quote cards to a Typst presentation. Also use when the user wants to modify existing headline cards (add/remove cards, change quotes, swap logos, fix layout issues). Trigger on: 'add a headline', 'news card', 'LWT card', 'headline slide', 'quote card', 'media quote', 'add a quote from [publication]'."
---

# LWT-Style Headline Cards for Typst Presentations

Creates "Last Week Tonight"-style headline cards: dark cards with a red date badge, publication logo (SVG), bold headline, and an italic pull quote. Data-driven from JSON so cards stay decoupled from slide markup.

## Architecture

```
presentation/
├── templates/theme.typ        ← headline-card() function lives here
├── data/headlines.json        ← card data (venue, date, headline, quote, logo)
├── assets/logos/*-white.svg   ← white-on-transparent SVG logos
└── slides.typ                 ← loops over JSON to emit one slide per card
```

The Typst function (`headline-card`) already exists in theme.typ. This skill is about **adding new cards correctly** — getting the JSON right, preparing logos, and avoiding the path/sizing pitfalls that cost hours of iteration.

## Step 1: Prepare the JSON Entry

Add an object to `data/headlines.json`:

```json
{
  "venue": "Publication Name",
  "date": "Month Day, Year",
  "headline": "The headline text exactly as published",
  "quote": "A vivid, punchy pull quote — not a summary",
  "logo": "../assets/logos/publication-white.svg"
}
```

### What makes a good quote

The quote should be **vivid and specific** — something that makes the audience react. Source quotes from the actual article, executive statements, or analyst commentary. Avoid generic descriptions like "discusses the impact of proxy advisors." Use Readwise, Consensus, or WebSearch to find the exact language.

**Good**: "Anyone who gives them money — shame on you. They should be gone and dead and done with."
**Bad**: "JPMorgan CEO criticizes proxy advisory industry practices."

### Path resolution rule

Logo paths in JSON are resolved **relative to `templates/theme.typ`**, not relative to `slides.typ` or the project root. Since theme.typ lives in `templates/`, use `../assets/logos/` to reach the assets directory.

| theme.typ location | Logo location | Correct JSON path |
|---|---|---|
| `templates/theme.typ` | `assets/logos/foo.svg` | `../assets/logos/foo.svg` |

This is because Typst's `image()` function resolves relative to the file containing the function definition, not the file that calls it.

## Step 2: Prepare the SVG Logo

Headline cards have a dark background (`#12121e`). Logos need to be **white on transparent** to be visible.

### Creating a white variant

1. Download the publication's SVG logo (Wikimedia Commons is a good source)
2. Identify dark fill colors in the SVG (`#000000`, `#1F1D1A`, `#222222`, `#292526`, etc.)
3. Replace them with white:

```bash
# Replace all dark fills with white
sed -i '' 's/fill="#000000"/fill="#ffffff"/g; s/fill="#1F1D1A"/fill="#ffffff"/g' assets/logos/publication-white.svg
```

4. Verify the result by compiling the presentation — some SVGs have multiple fill values or use `style` attributes instead of `fill`.

**Common gotcha**: Some SVGs use CSS `style="fill:#000"` instead of `fill="#000"`. Check both:
```bash
grep -i 'fill' assets/logos/publication-white.svg
```

### Logo sizing

The `headline-card` function constrains logos with `box(width: 60%, height: 4.5em, image(fit: "contain"))`. This handles both wide wordmarks (like Semafor) and square icons (like a seal) without overflow. You should not need to adjust sizing per-logo — the `contain` fit mode preserves aspect ratio within the bounding box.

If a logo appears too small despite the 60% width, it's likely that the SVG has excessive whitespace/padding in its viewBox. Crop the viewBox or edit the SVG to remove padding.

## Step 3: Render in slides.typ

Cards are rendered by looping over the JSON. This pattern should already exist in slides.typ:

```typst
#{
  let cards = json("data/headlines.json")
  for card in cards {
    slide[
      #headline-card(
        venue: card.venue,
        date: card.date,
        headline: card.headline,
        quote: card.at("quote", default: none),
        logo: card.at("logo", default: none),
      )
    ]
  }
}
```

**One card per slide.** Grid layouts (2x2, etc.) were tried and don't work — quotes and headlines get truncated, logos shrink too small to be recognizable, and the visual impact is lost. The LWT style depends on each card filling the screen.

**No `===` heading on headline slides.** The slide heading bar eats vertical space. Headline cards use `block(height: 1fr)` to fill the available space, but an `===` heading reduces that space significantly. If you need a section header, put it on the slide before the card loop.

## Red Flags — STOP If You See These

| Symptom | Cause | Fix |
|---|---|---|
| Logo doesn't appear (blank space) | Path in JSON is relative to slides.typ, not theme.typ | Change to `../assets/logos/...` |
| Logo is invisible (dark on dark) | SVG has dark fills on dark card background | Create a `-white.svg` variant |
| Logo clips over the date badge | SVG is very wide and `box` width is too large | The 60%/4.5em constraint should prevent this; check SVG viewBox for excessive width |
| Card doesn't fill vertical space | Using `height: 100%` instead of `1fr`, or `===` heading is present | Use `block(height: 1fr)` and remove `===` from the slide |
| Quote is generic/boring | Summarized instead of quoted | Find the actual vivid quote from the source |
| Typst error: "file not found" | Logo SVG doesn't exist at the resolved path | Check that the file exists at `templates/../assets/logos/...` |

## Modifying the headline-card Function

The function lives in `presentation/templates/theme.typ` (search for `#let headline-card`). Key design decisions baked in:

- **`place(top + left)`** for the date badge — floats it over the card without affecting content flow
- **`align(center + horizon)`** — vertically and horizontally centers the logo/headline/quote stack
- **`block(height: 1fr)`** — stretches to fill available slide space
- **Curly quotes** via `\u{201c}` and `\u{201d}` — typographically correct
- **Divider lines** at 50% width between logo, headline, and quote sections

If you need to adjust text sizes, the current values are: headline 22pt bold, quote 18pt italic, date badge 14pt bold, fallback venue name 24pt bold.
