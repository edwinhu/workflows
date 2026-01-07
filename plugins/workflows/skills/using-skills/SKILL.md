---
name: using-skills
description: Meta-skill teaching how to use skills. Loaded at session start.
---

# Using Skills

**Invoke relevant skills BEFORE any response or action.**

This is non-negotiable. Even a 1% chance a skill applies requires checking.

## The Rule

```
User message arrives
    ↓
Check: Does this match any skill trigger?
    ↓
YES → Invoke skill FIRST, then follow its protocol
NO  → Proceed normally
```

## Skill Triggers

| User Intent | Skill | Trigger Words |
|-------------|-------|---------------|
| Bug/fix | `/dev-debug` | bug, broken, fix, doesn't work, crash, error, fails |
| Feature/implement | `/dev` | add, implement, create, build, feature |
| Data analysis | `/ds` | analyze, data, model, dataset, statistics |
| Writing | `/writing` | write, draft, document, essay, paper |

## Red Flags - You're Skipping the Skill Check

If you think any of these, STOP:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Simple questions don't involve reading code |
| "I'll gather information first" | That IS investigation - use the skill |
| "I know exactly what to do" | The skill provides structure you'll miss |
| "It's just one file" | Scope doesn't exempt you from process |
| "Let me quickly check..." | "Quickly" means skipping the workflow |

## Bug Reports - Mandatory Response

When user mentions a bug:

```
1. DO NOT read code files
2. DO NOT investigate
3. DO NOT "take a look"

INSTEAD:
1. Start ralph loop:
   /ralph-wiggum:ralph-loop "Debug: [symptom]" --max-iterations 15 --completion-promise "FIXED"
2. Inside loop, follow /dev-debug protocol
```

**Any code reading before starting the workflow is a violation.**

## Skill Priority

When multiple skills could apply:

1. **Process skills first** - debugging, brainstorming determine approach
2. **Then implementation** - dev, ds, writing execute the approach

## How to Invoke

Use the Skill tool:
```
Skill(skill="dev-debug")
Skill(skill="dev")
Skill(skill="ds")
```

Or start ralph loop first for implementation/debug phases.
