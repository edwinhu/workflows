---
name: writing-legal
description: Use when user asks for “law review article”, “legal scholarship”, “seminar paper”, “academic legal writing”, “Bluebook citations”, “legal memo”, “law journal”, “student note”, “legal brief draft”, or mentions Volokh, legal writing style, or law review formatting.
version: 1.0.0
---

# Academic Legal Writing

**Load the full skill:**

```
Read(“${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/SKILL.md”)
```

## Quick Reference

This skill provides:
- Law review article structure (intro, background, proof, conclusion)
- Template enforcement for `.docx` generation
- Volokh-based academic legal writing rules
- Bluebook citation integration
- Counterargument confrontation requirements

## Template Location

**CRITICAL:** When creating Word documents, use the template at:
```
${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/templates/law_review_template.docx
```

## Iron Laws (Summary)

1. **NO DOCX WITHOUT TEMPLATE** - Copy template first, then add content
2. **NO CLAIM WITHOUT COUNTERARGUMENTS** - Confront objections
3. **NO SECONDARY CITATIONS FOR PRIMARY SOURCES** - Read originals

Load the full skill above for complete enforcement rules and rationalization tables.
