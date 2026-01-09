# Advanced Agent Harnessing Patterns

**Based on oh-my-opencode production patterns for specialized agent control.**

## Background + Parallel Execution (Default)

When spawning multiple Task agents for exploration or profiling:

**ALWAYS use background + parallel:**
```
# CORRECT: All agents in ONE message, all with run_in_background=true
Task(subagent_type="Explore", description="Find auth", run_in_background=true, prompt="...")
Task(subagent_type="Explore", description="Find errors", run_in_background=true, prompt="...")
Task(subagent_type="Explore", description="Find API", run_in_background=true, prompt="...")

# Collect results later with TaskOutput
```

**NEVER wait synchronously:**
```
# WRONG: Sequential execution
task1 = Task(...) # Blocks
task2 = Task(...) # Blocks
```

**Benefits:**
- 3x faster for 3 agents
- Main conversation continues immediately
- Results collected asynchronously

## Tool Restrictions (Enforce Focus)

Every delegated Task agent should have explicit tool restrictions:

| Agent Purpose | Denied Tools | Reason |
|---------------|--------------|--------|
| Exploration | Write, Edit, NotebookEdit, Bash | Read-only search |
| Review | Write, Edit, NotebookEdit | Analysis without changes |
| Profiling | Write, Edit, NotebookEdit | Data inspection only |
| Implementation | None | Full development access |

**Pattern:** Default to most restrictive, grant only when needed.

See: `common/helpers/tool-restrictions.md`

## Structured Delegation Template

Every Task agent delegation MUST include:
1. TASK - What to do
2. EXPECTED OUTCOME - Success criteria
3. REQUIRED SKILLS - Why this agent
4. REQUIRED TOOLS - What they'll need
5. MUST DO - Non-negotiable constraints
6. MUST NOT DO - Hard blocks
7. CONTEXT - Parent session state
8. VERIFICATION - How to confirm

See: `common/templates/delegation-template.md`

Used by: `/dev-delegate`, `/ds-delegate`

## Failure Recovery Protocol

**After 3 consecutive failures, STOP and escalate:**

1. STOP all further attempts
2. REVERT to last known working state
3. DOCUMENT what was attempted and why it failed
4. CONSULT with user before continuing
5. ASK USER for direction

**NO EVIDENCE = NOT COMPLETE**

Implemented in: `/dev-debug`, `/dev-implement`

## Environment Context Injection

Research-heavy skills use current date/time context for:
- Date range validation
- Fiscal year calculations
- API version checking
- Documentation freshness

See: `common/metadata/skill-metadata.py` - `get_env_context()`

Applied to: `/wrds`, `/lseg-data`, `/gemini-batch`

## Cost Classification System

Skills are classified by cost:
- **FREE**: Simple operations, no model calls (explore, grep)
- **CHEAP**: Fast models, simple tasks (profiling, review)
- **EXPENSIVE**: Complex reasoning, architecture decisions (design, debug after 3 failures)

See: `common/metadata/skill-metadata.py` - `CostLevel`

## Metadata-Driven Prompts

Skills declare metadata in YAML frontmatter:
```yaml
---
name: skill-name
description: "..."
category: workflow | domain | phase | utility
cost: FREE | CHEAP | EXPENSIVE
triggers:
  - domain: "Feature implementation"
    trigger: "add, implement, create, build"
use_when:
  - "Complex multi-file changes"
avoid_when:
  - "Simple single-line fixes"
---
```

Parent skills consume metadata to build decision tables dynamically.

See: `common/metadata/skill-metadata.py`

## Pattern References

All patterns documented in:
- `common/metadata/` - Metadata infrastructure and cost classification
- `common/templates/` - Delegation and agent templates
- `common/helpers/` - Tool restrictions and utilities
- `common/OH-MY-OPENCODE-PATTERNS.md` - Complete oh-my-opencode implementation guide

## Additional Resources

For implementation details of all 10 oh-my-opencode patterns, see:
- `common/OH-MY-OPENCODE-PATTERNS.md` - Comprehensive guide
- Plugin-dev skills (hook-development, agent-development, skill-development) - Best practices
