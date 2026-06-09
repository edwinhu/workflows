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

## Fact Row Entry (supersedes Rationalization Table entries — v5.36.0)

Add a bullet to an existing skill's `### <Topic> Facts` section (create the section if the skill has none; never add new excuse/reality Rationalization Table rows):

```markdown
- <Non-derivable fact learned from the observed failure — number / threshold / named incident / tool quirk>.
  <Consequence of ignoring it, stated as a property of the action: "...is an unverified claim presented as fact — a form of dishonesty" / "...is counterproductive on its own terms" / "...is the exact incompetence this step exists to prevent".>
```

**Source requirement:** The fact MUST come from an observed failure, not a hypothetical (no speculative enforcement). It must also pass the litmus: *could a strong model with no project history derive this from the rule itself?* If yes, don't add it — the rule statement carries it.

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
