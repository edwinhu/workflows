# Constraint: writing-ai-smell-artifacts

**Severity:** hard  
**Applies to:** writing-draft, writing-review, writing-revise

## What it checks

Flags three categories of unambiguous AI residue that must never appear in a manuscript:

1. **ChatGPT citation artifacts** — copy-paste residue from the ChatGPT web UI that was not cleaned up before being inserted into the draft.
2. **Prompt refusals** — AI self-identification phrases or chatbot sign-offs that ended up in the document body.
3. **Unfilled template placeholders** — bracket-wrapped stubs the author or AI left as fill-in-the-blank prompts.

Scans `drafts/*.md`. Skips YAML frontmatter, fenced code blocks, blockquotes, footnote definitions, and HTML comments.

## Patterns flagged

| Pattern | Label | Category |
|---------|-------|----------|
| `turn0search0`, `citeturn1search2`, `iturn0image0`, `citeturn0news3`, … | `chatgpt:turn-artifact` | ChatGPT artifact |
| `contentReference[oaicite:0]{index=0}` | `chatgpt:contentReference` | ChatGPT artifact |
| `oaicite:0` (standalone) | `chatgpt:oaicite` | ChatGPT artifact |
| `[oai_citation:0‡source.com]` | `chatgpt:oai-citation` | ChatGPT artifact |
| `({"attribution":{"attributableIndex":"1-0"}})` | `chatgpt:attribution-json` | ChatGPT artifact |
| `access-date=2025-xx-xx` | `chatgpt:date-placeholder` | ChatGPT artifact |
| `As an AI language model` | `refusal:ai-language-model` | Prompt refusal |
| `As a large language model` | `refusal:large-language-model` | Prompt refusal |
| `I cannot provide/assist/help/generate/write` | `refusal:cannot-provide` | Prompt refusal |
| `I hope this helps` / `I hope this email finds` | `refusal:i-hope-this-helps` | Prompt refusal |
| `[YOUR NAME]` / `[YOUR_NAME]` | `template:your-name` | Placeholder |
| `[INSERT ... HERE]` (general) | `template:insert-placeholder` | Placeholder |
| `[PLACEHOLDER]` | `template:placeholder` | Placeholder |
| `[TODO]` / `[TODO: text]` | `template:todo` | Placeholder |

## False positive notes

These patterns are chosen for near-zero false positive rate in legal scholarship:

- ChatGPT artifacts cannot appear in legitimate human writing.
- `As an AI language model` / `As a large language model` could appear in a quoted passage about AI policy — but the linter already skips blockquotes, so this only fires on unquoted prose.
- `I cannot provide` could theoretically appear in legal text ("the record cannot provide...") but the full phrase requires first-person `I`, which legal writing avoids.
- `[TODO]` in a prose draft paragraph is genuinely an unfilled stub; editorial TODOs belong in HTML comments (`<!-- TODO: ... -->`), which are already skipped.

If a violation is a deliberate in-text example or quotation not marked as a blockquote, use an HTML comment to document the exception or reformat as a blockquote.
