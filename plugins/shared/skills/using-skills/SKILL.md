# Using Skills

You have access to specialized skills that extend your capabilities. This document explains how to use them.

## The Rule

**IF A SKILL APPLIES TO YOUR TASK, YOU MUST USE IT.**

Even if you think you know the answer, invoke the skill first. Skills contain current, tested knowledge that may differ from your training data.

## How to Invoke

Use the Skill tool:
```
Skill(skill="skill-name")
```

The skill content will be loaded and guide your response.

## When to Invoke

Invoke a skill **before responding** when the user's request involves:

| Domain | Skill |
|--------|-------|
| Feature implementation | `dev` or `dev:start` |
| Bug fixing/debugging | `dev:dev-debug` |
| Data analysis | `ds` or `ds:start` |
| Marimo notebooks | `marimo` |
| Jupyter/jupytext | `jupytext` |
| WRDS data access | `wrds` |
| LSEG/Refinitiv data | `lseg-data` |
| Gemini batch processing | `gemini-batch` |

## Red Flags

If you catch yourself thinking:
- "This is just a simple question" - invoke the skill anyway
- "I already know how to do this" - skills may have updated patterns
- "Let me explore first" - invoke the skill, it will guide exploration
- "The user didn't ask for the skill" - skills are for YOU, not the user

## Workflow

```
User request
    ↓
Does a skill apply? → YES → Skill(skill="...") → Follow skill guidance
    ↓ NO
Respond normally
```

## Skill Types

- **Workflow skills** (dev, ds): Multi-phase structured workflows
- **Domain skills** (marimo, wrds): Specialized knowledge for specific tools
- **Sub-skills** (dev-debug, ds-brainstorm): Focused phases of larger workflows

When multiple skills apply, invoke the most specific one first.
