---
name: writing-ai-smell-puffery
description: AI-writing-smell check for puffery and empty intensifiers in prose
applies-to: [writing-draft, writing-review, writing-revise, workshop, workshop-revise]
---

# Constraint: writing-ai-smell-puffery

**Severity:** soft  
**Applies to:** writing-draft, writing-review, writing-revise

## What it checks

Flags statistically overrepresented phrases associated with AI-generated prose — puffery, superficial analysis markers, and promotional language. These patterns appear far more frequently in LLM output than in comparable human legal scholarship.

Scans `drafts/*.md`. Skips YAML frontmatter, fenced code blocks, blockquotes (quoted source material), footnote definitions, and HTML comments (editorial notes).

## Patterns flagged

All patterns are soft signals — advisory, not blocking.

| Pattern | Label | Confidence | False-positive risk in legal writing |
|---------|-------|------------|--------------------------------------|
| `delves into` | `puffery:delves-into` | high | Very low — rarely used in scholarship |
| `rich tapestry` | `puffery:rich-tapestry` | high | Very low — essentially never legitimate |
| `nestled` | `puffery:nestled` | high | Very low — travel-writing register |
| `stands as a/an/the` | `puffery:stands-as` | high | Low — "stands as precedent" possible |
| `plays a vital/crucial/pivotal/key/central role` | `puffery:plays-X-role` | medium | Moderate — "the SEC plays a central role" |
| `it is important to note` | `puffery:important-to-note` | medium | Low — preachy in formal writing |
| `it is worth noting` | `puffery:worth-noting` | medium | Low — same pattern |
| `it should be noted that` | `puffery:should-be-noted` | medium | Low — same puffery family |
| `cutting-edge` | `promo:cutting-edge` | medium | Moderate — tech-law discussions |
| `unparalleled` | `promo:unparalleled` | medium | Low — superlative rarely evidenced |

## Superlative self-attribution heuristic (v2)

The words `unprecedented`, `transformative`, `revolutionary`, and `groundbreaking` are excluded from the general pattern list because they appear legitimately in legal writing (`unprecedented federal intervention`, `transformative use doctrine`, `revolutionary war`).

Instead, these fire only when a superlative word appears within 60 characters of a **self-contribution noun** on the same line — signaling that the author is describing their own work rather than an external event or doctrine.

**Self-contribution nouns:** `article`, `analysis`, `framework`, `finding`, `approach`, `paper`, `argument`, `thesis`, `contribution`, `study`, `research`, `theory`, `claim`

| Example | Fires? |
|---------|--------|
| "This Article presents an unprecedented **analysis**..." | ✓ fires (`promo:superlative:unprecedented`) |
| "our groundbreaking **framework** for proxy voting..." | ✓ fires (`promo:superlative:groundbreaking`) |
| "unprecedented federal intervention" | ✗ no self-contribution noun nearby |
| "transformative use doctrine" | ✗ no self-contribution noun nearby |
| "the most revolutionary **theory** in corporate law" | ✓ fires (`promo:superlative:revolutionary`) |

**Known FP:** `transformative X analysis` where `X` is an external subject (e.g., "the transformative effect of indexing on this analysis") — the superlative and the self-contribution noun are near each other even though the superlative modifies an external event. Since this is soft, accept the violation.

## Intentionally excluded

- **`unprecedented`** / **`transformative`** / **`revolutionary`** / **`groundbreaking`** — general occurrences excluded; covered only by self-attribution heuristic above
- **`state-of-the-art`** — IP/patent term
- **`the landscape of`** — "regulatory landscape" is legitimate
- **Filler transitions** (`Furthermore,` `Moreover,` at paragraph start) — handled by `writing-ai-smell-structure`

## Fix guidance

- `delves into`, `rich tapestry`, `nestled`: delete and rephrase concretely
- `plays a X role`: name the specific function instead of the role
- `it is important/worth noting` / `it should be noted`: delete — lead directly with the point
- Superlative self-attribution: substitute specific characterization or evidence
