---
name: headline-card
user-invocable: false
description: "Use this skill when the user asks to add news headline cards, 'Last Week Tonight'-style cards, headline slides, news quote slides, or media quote cards to a Typst presentation. Also use when the user wants to modify existing headline cards (add/remove cards, change quotes, swap logos, fix layout issues). Trigger on: 'add a headline', 'news card', 'LWT card', 'headline slide', 'quote card', 'media quote', 'add a quote from [publication]'."
---

# Headline Cards for Typst Presentations

An editorial recreation of a newspaper clipping: **light** paper stock, the real
masthead logo, a top rule carrying a category kicker and dateline, a serif
headline with a Last-Week-Tonight yellow highlighter swipe over one phrase, and a
short standfirst.

**Read `templates/theme.typ` before writing a card.** The implementation is the
authority; if it disagrees with this file, believe it and fix this file.

## Architecture

```
presentation/
├── templates/theme.typ        ← headline-card() lives here; read it first
├── data/headlines-NN.json     ← card data, NN = the lecture number
├── assets/logos/*.svg         ← DARK / full-colour logos (see below)
└── slides/XX-topic/NN.typ     ← loops over the JSON, one slide per card
```

## Step 1: the JSON entry

```json
{
  "venue": "WSJ",
  "date": "June 24, 2026",
  "kicker": "Tech",
  "headline": "The headline exactly as published",
  "highlight": "phrase to swipe in yellow",
  "quote": "The article's own standfirst/dek.",
  "logo": "../assets/logos/wsj.svg"
}
```

`highlight` must be a **substring of `headline`, matching character for
character** — the function splits on it, so a straight quote where the headline
has a curly one silently produces no swipe. `kicker` and `quote` are optional.

**Quote the article, do not summarise it.** The standfirst should be the
publication's own dek or a vivid line from the piece. "Discusses the impact of
proxy advisors" is not a card; "Anyone who gives them money — shame on you" is.

**Nothing on the card may be composed.** Headline, dek, outlet and date are the
article's own or they do not go on the slide — a card asserts that a publication
printed this. Pull them from the record, and if a field cannot be sourced, omit
it rather than inventing it. Note that Reader's
`reader-get-document-details` returns null for `published_date`/`source_url`
while `reader-list-documents --id <id>` returns them populated — check both
before concluding a date is unavailable.

## Step 2: paper stock is per publication

`headline-card` picks the stock from `venue`. FT is famously salmon and the
broadsheets are white; one generic cream for everything reads as wrong to anyone
who knows the paper.

| venue | stock |
|---|---|
| Financial Times, FT | `#FFF1E5` salmon |
| WSJ, NY Times, Bloomberg, ABC News | `#FFFFFF` |
| X, Twitter | `#FFFFFF` — light-mode surface; the mark is black |
| anything else | `#F7F4EC` cream fallback |

`X`/`Twitter` is a venue, not a second function. The card suppresses the
newspaper-only chrome for it — top rule, kicker, serif headline face, highlighter
swipe — and takes `handle:` (`"@elonmusk"`) beside the mark. Everything else, the
stock table included, is shared.

Add a venue to the `stocks` dictionary in `theme.typ` rather than passing a
one-off, so the next card for that outlet inherits it. `stock: rgb("…")`
overrides per card when one genuinely differs.

Legibility does not constrain this choice — ink, dek and dateline land within
~1:1 of each other across every stock — so it is purely identity.

## Step 3: the logo

**Dark or full-colour, on a light card.** Not the `-white.svg` variant; those are
for dark backgrounds and are invisible here. Use `wsj.svg`, `nyt-dark.svg`,
`ft-dark.svg`, `abc-news-dark.svg`.

### IRON LAW: real vector logos only

If you catch yourself writing an SVG with `<text>` elements spelling out the
publication name — stop. That is a placeholder, not a logo, and it ships with the
wrong font, weight and spacing.

```bash
grep '<text' assets/logos/publication.svg && echo "FAKE — download a real logo"
```

Download from Wikimedia Commons, the brand's press page, or a logo repo.
Wikimedia has SVGs for essentially every major publication; "I can't find one"
means search harder.

Sizing needs no per-logo tuning: the function normalises by aspect ratio, so a
narrow mark and a wide wordmark carry similar visual weight.

## Step 4: render

```typst
#{
  let cards = json("../../data/headlines-NN.json")
  for card in cards {
    slide[
      #headline-card(
        venue: card.venue,
        date: card.date,
        headline: card.headline,
        quote: card.at("quote", default: none),
        logo: card.at("logo", default: none),
        phrase: card.at("highlight", default: none),
        kicker: card.at("kicker", default: none),
        stock: card.at("stock", default: auto),
      )
    ]
  }
}
```

**One card per slide, and no `===` heading on it.** Grid layouts truncate quotes
and shrink logos below recognition; a heading eats the vertical space the card
fills. Put any section header on the preceding slide.

## Step 5: look at it

Compile, get the page from `find-slide-page`, render it, and read it. What
matters: the logo renders and is dark enough; the swipe covers the intended
phrase; nothing is clipped; no single orphaned word ends the headline or
standfirst.

Fix widows in the **JSON text**, never in Typst — tighten the wording, or join
the last two words with ` `. Never pad with filler to fix a widow.

## Red flags — STOP

| Symptom | Cause | Fix |
|---|---|---|
| Logo invisible | a `-white.svg` on the light card | use the dark/full-colour variant |
| Logo missing entirely | JSON path taken as relative to `slides/` | paths resolve from **theme.typ**: `../assets/logos/…` |
| No yellow swipe | `highlight` is not an exact substring of `headline` | match curly vs straight quotes character for character |
| Card doesn't read as an object on white stock | border derived from the stock is near-white | the border is a fixed grey; do not re-derive it from `newsprint` |
| An FT card looks like every other card | venue missing from the `stocks` dictionary | add it |
| An X post wears a serif headline, a top rule or a yellow swipe | venue not spelled `X`/`Twitter`, so it took the newspaper branch | fix the venue string — never add a second card function |
| Dek is generic | summarised instead of quoted | use the publication's own standfirst |
| A date is invented | it wasn't in the source | omit the field; never fabricate one |
| `<text>` in the logo SVG | placeholder, not a logo | download the real one |

## Facts

- **The dateline is the smallest text on the card**, so it carries its own darker
  grey rather than the dek's `mute`, which lands ~5.3:1 on newsprint and washes
  out under projector gamma.
- **Black on the yellow swipe measures ~13.7:1** — the highlight helps
  readability rather than hurting it, so spend it on the phrase that carries the
  point, never decoratively.
