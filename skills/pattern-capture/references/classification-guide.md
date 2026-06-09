# Pattern Classification Quick Reference

## Decision Matrix (Fast Path)

Use this when you already know what the pattern looks like:

| Signal | Artifact | Example |
|--------|----------|---------|
| "Don't do X" (1 sentence) | **Memory (feedback)** | "Don't add emojis" |
| "In this project, always Y" | **Memory (project)** | "jq 1.6 needs explicit syntax" |
| "You keep skipping step Z" | **Enforcement pattern** | Add Iron Law or Red Flag to relevant skill |
| "Never use X in Y files" (detectable by grep) | **Validation hook** | `jest.mock` in integration tests |
| "When X happens, do these 5 steps" | **Learned skill** | Pixi environment debugging |
| "You learned fact F the hard way (number/quirk/incident)" | **Fact Row entry** | "HTTP 200 ≠ output correct" with consequence |

## Decision Tree (Thorough Path)

```
WHEN to do something?
├─ Tool/command selection → MEMORY (feedback)
├─ Workflow sequencing → ENFORCEMENT PATTERN
└─ Other timing → MEMORY (feedback)

HOW to do something?
├─ Single rule (< 3 sentences)
│  ├─ Project-specific → MEMORY (project)
│  └─ General → MEMORY (feedback)
└─ Multi-step
   ├─ Requires verification → VALIDATION HOOK
   └─ Reusable procedure
      ├─ Cross-project → LEARNED SKILL
      └─ Project-only → MEMORY (project)

WHAT NOT TO DO?
├─ Programmatically detectable → VALIDATION HOOK
└─ Requires judgment → RED FLAG entry
```

## Enforcement Strength Ladder

From weakest to strongest:

1. **Memory entry** — loaded at session start, relies on agent reading it
2. **Red Flag table entry** — loaded when skill activates, targets observable actions
3. **Fact Row entry** — states the incident-learned, non-derivable fact with its drive consequence, loaded with skill (supersedes Rationalization Table entries)
4. **Iron Law** — `<EXTREMELY-IMPORTANT>` wrapped, strongest prompt-level enforcement
5. **Validation hook** — programmatic, runs automatically, can block actions

**Rule of thumb:** Start at the lowest sufficient level. Escalate only if the lower level fails to prevent the pattern.

## Where Each Artifact Lives

| Artifact | Path Pattern |
|----------|-------------|
| Memory (feedback) | `<memory_dir>/feedback_<slug>.md` |
| Memory (project) | `<memory_dir>/project_<slug>.md` |
| Enforcement pattern | Added to existing `skills/<name>/SKILL.md` |
| Validation hook | `hooks/<hook-name>.ts` in relevant plugin |
| Red Flag entry | Added to existing skill's Red Flags table |
| Learned skill | `~/.claude/skills/learned/<name>/SKILL.md` |

## Evidence Requirements

| Strength | What Counts |
|----------|-------------|
| **Strong** | 3+ instances in session transcripts with timestamps |
| **Sufficient** | 2 independent instances OR user explicitly says "I keep telling you" |
| **Insufficient** | Single instance without user escalation language |
| **Invalid** | Speculative — "this might happen" without observed occurrence |

Never generate artifacts from insufficient or invalid evidence.
