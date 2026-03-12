# Artifact Generation Templates

## Memory Entry (Feedback Type)

```markdown
---
name: feedback_<descriptive-slug>
description: <one-line — specific enough to match in future searches>
type: feedback
---

<The rule, stated as a clear imperative>

**Context:** <What goes wrong when violated — concrete harm, not abstract>
**Source:** Corrected <N> times across sessions. First observed: <date or "unknown">.
```

## Memory Entry (Project Type)

```markdown
---
name: project_<descriptive-slug>
description: <one-line — include project name or technology>
type: project
---

<The convention or constraint>

**Applies to:** <Scope — specific project, specific technology version, etc.>
**Context:** <Why this exists — what broke or what's different about this project>
**Source:** Corrected <N> times. First observed: <date or "unknown">.
```

## Iron Law Addition

Add to an existing skill's enforcement section:

```markdown
<EXTREMELY-IMPORTANT>
**<RULE IN IMPERATIVE ALL CAPS>. This is not negotiable.**

<One sentence: concrete user harm if violated. Use helpfulness-first framing:
"Skipping this is NOT HELPFUL because [specific bad outcome].">
</EXTREMELY-IMPORTANT>
```

**Placement:** After the skill's existing Iron Laws, before Red Flags section.

## Rationalization Table Entry

Add row to an existing skill's Rationalization Table:

```markdown
| "<exact excuse the agent generates — quote from transcript if possible>" | "<why this reasoning is wrong — be specific>" | "<the correct action to take instead>" |
```

**Source requirement:** The excuse in column 1 MUST come from an observed agent response, not a hypothetical. If you haven't seen the agent make this excuse, don't add it.

## Red Flag Entry

Add row to an existing skill's Red Flags table:

```markdown
| "<observable action or thought pattern>" | "<why it's wrong — concrete harm>" | "<correct alternative>" |
```

**Format:** Column 1 must be an *action* ("About to X", "Running Y"), not an *intention* ("Thinking about X").

## Validation Hook (PreToolUse)

```typescript
// hooks/<descriptive-name>.ts
// Captures: <pattern description>
// Evidence: <N instances across M sessions>
// Classification: Programmatically detectable anti-pattern

import type { PreToolUseHook } from "@anthropic-ai/claude-code";

const hook: PreToolUseHook = {
  event: "PreToolUse",
  name: "<tool-name>",  // "Bash", "Write", "Edit", etc.

  async handler({ tool, input }) {
    // Detection: check input for the anti-pattern
    const content = typeof input === "string" ? input : JSON.stringify(input);
    const hasViolation = /<detection regex or string check>/i.test(content);

    if (hasViolation) {
      return {
        decision: "ask",  // "block" for hard enforcement, "ask" for soft
        reason: `<user-facing explanation>. Pattern captured from repeated feedback.`,
      };
    }

    return { decision: "approve" };
  },
};

export default hook;
```

## Learned Skill

Delegate to skill-creator — provide this brief:

```
Create a learned skill with these parameters:

**Name:** <slug>
**Trigger:** <when this skill should activate>
**Pattern:** <the multi-step procedure to encode>
**Evidence:** <where this was observed>
**Enforcement level:** <low/medium/high based on classification>

Steps:
1. <step>
2. <step>
...
```

The skill-creator handles SKILL.md format, frontmatter, and enforcement audit.

## Pattern Capture Report

Output after generating any artifact:

```markdown
## Pattern Captured

**Pattern:** <one-line description>
**Evidence:** <N instances across M sessions / user-reported>
**Classification:** <artifact type from decision tree>
**Artifact:** <file path created or modified>
**Prevention:** <how this stops the repetition — be specific>
**Escalation path:** <what happens if this level fails — e.g., "escalate from memory to Red Flag">
```
