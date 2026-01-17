# Skill Description Patterns

This document clarifies the different description patterns for workflow phase skills vs standalone skills.

## Two Types of Skills

### 1. Standalone Skills (User-Triggered)

**Examples:** marimo, jupytext, wrds, lseg-data, gemini-batch, look-at, writing, dev-debug

**Invocation:** Users directly ask questions or make requests that trigger these skills.

**Description Pattern:** Third-person with specific trigger phrases

**Template:**
```yaml
description: "This skill should be used when the user asks to '[trigger 1]', '[trigger 2]', '[trigger 3]', or needs [general scenario]. [Optional: Key value proposition or context]."
```

**Example (wrds):**
```yaml
description: "This skill should be used when the user asks to 'query WRDS', 'access Compustat', 'get CRSP data', 'pull Form 4 insider data', or needs WRDS PostgreSQL connection and query patterns."
```

**Why:** These skills need rich trigger phrases so Claude can discover them when users ask relevant questions. The description must match user intent patterns.

### 2. Workflow Phase Skills (Orchestrator-Triggered)

**Examples:** dev-explore, dev-clarify, dev-design, dev-implement, ds-plan, ds-implement

**Invocation:** Parent orchestrator skills (/dev or /ds) invoke these as specific workflow phases, not users directly.

**Description Pattern:** Context-focused with phase information

**Template:**
```yaml
description: "REQUIRED Phase N of /workflow-name workflow. [What it does]. [When it runs in the workflow]. [Key deliverable]."
```

**Example (dev-explore):**
```yaml
description: "REQUIRED Phase 2 of /dev workflow after dev-brainstorm. This skill should be used when you need to 'explore the codebase', 'map architecture', 'find similar features', 'discover test infrastructure', 'trace execution paths', 'identify code patterns', or understand WHERE code lives and HOW it works before implementation. Launches parallel explore agents and returns prioritized key files list."
```

**Why:** Phase skills are invoked by orchestrators based on workflow position, not user queries. The description should clarify:
- Which workflow phase it represents
- What prerequisite phases must complete first
- What the skill does in the workflow context
- What it produces for the next phase

**Important:** Even workflow phase skills can include trigger phrases for the scenarios where they're needed within the workflow context (as shown in dev-explore example above).

### 3. Internal-Only Skills (Never User-Triggered)

**Examples:** dev-delegate, ds-delegate

**Invocation:** Called ONLY by other skills (dev-ralph-loop → dev-delegate), never by users or even orchestrators directly.

**Description Pattern:** Explicit internal-only designation

**Template:**
```yaml
description: "Internal skill used by [parent-skill] during [phase/context]. NOT user-facing - should only be invoked by [specific caller]. [What it handles]."
```

**Example (dev-delegate):**
```yaml
description: "Internal skill used by dev-implement during Phase 5 of /dev workflow. NOT user-facing - should only be invoked by dev-ralph-loop inside each implementation iteration. Handles Task agent spawning with TDD enforcement and two-stage review (spec compliance + code quality)."
```

**Why:** These skills are implementation details of the workflow machinery. Making this explicit prevents:
- Users trying to invoke them directly
- Claude loading them at inappropriate times
- Confusion about the invocation model

## Design Rationale

The different patterns reflect different triggering mechanisms:

1. **Standalone skills** need to match user language patterns
2. **Workflow phase skills** need to clarify their role in orchestrated sequences
3. **Internal skills** need to document their specific calling context

## Migration Guide

When auditing or creating skills, ask:

1. **Who invokes this skill?**
   - Users directly → Standalone pattern with trigger phrases
   - Workflow orchestrator → Phase pattern with workflow context
   - Another skill exclusively → Internal-only pattern

2. **How is it discovered?**
   - By matching user questions → Rich trigger phrases required
   - By workflow phase progression → Phase number and context required
   - By hardcoded skill reference → Explicit caller documentation required

3. **What context does the invoker have?**
   - Users have intent but no workflow state → Trigger phrases from user perspective
   - Orchestrators have workflow state → Phase context and prerequisites
   - Parent skills have specific delegation need → Invocation constraints and purpose

## Version Tracking

All skills should include `version: X.Y` in frontmatter for change tracking:

```yaml
---
name: skill-name
version: 1.0
description: "..."
---
```

## Examples by Category

### Standalone Skills
- `wrds` - "This skill should be used when the user asks to 'query WRDS'..."
- `lseg-data` - "This skill should be used when the user asks to 'access LSEG data'..."
- `gemini-batch` - "This skill should be used when the user asks to 'use Gemini Batch API'..."
- `look-at` - "This skill should be used when the user asks to 'look at', 'analyze'..."

### Workflow Phase Skills
- `dev-explore` - "REQUIRED Phase 2 of /dev workflow after dev-brainstorm. This skill should be used when you need to 'explore the codebase'..."
- `ds-plan` - "REQUIRED Phase 2 of /ds workflow. Profiles data and creates analysis task breakdown."

### Internal-Only Skills
- `dev-delegate` - "Internal skill used by dev-implement during Phase 5. NOT user-facing..."
- `ds-delegate` - "Internal skill used by ds-implement. NOT user-facing..."

## Testing Description Quality

A good description should:

✅ Make invocation model clear (who calls it)
✅ Include specific trigger phrases for non-internal skills
✅ Be discoverable by intended invoker
✅ Avoid process details (save for skill body)
✅ Be concise but complete

❌ Be vague ("provides guidance")
❌ Use second person ("Use this skill when you...")
❌ Include implementation details
❌ Omit triggering context
