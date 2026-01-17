# Tool Restrictions Helper

Helper for restricting tools when spawning Task agents.

Based on oh-my-opencode's permission system for subagents.

## Pattern

When spawning Task agents, restrict tools to enforce focus:

```python
# Read-only agent (exploration, review)
tools_denied = ["Write", "Edit", "Bash", "NotebookEdit"]

# Analysis-only agent (no file modifications)
tools_denied = ["Write", "Edit", "NotebookEdit"]

# Implementation agent (full access)
tools_denied = []  # No restrictions
```

## Usage in Skills

### Exploration Agents (Read-only)

```bash
# Deny all modification tools
Task(
    subagent_type="Explore",
    prompt="Find authentication patterns in the codebase",
    description="Search for auth patterns",
)
# Note: Explore agents have built-in restrictions
```

### Review Agents (Analysis-only)

When spawning a custom Task agent for review:

```
Task(
    subagent_type="general-purpose",
    prompt="Review this implementation for:
    - Code quality
    - Security issues
    - Performance concerns

    IMPORTANT: You are in READ-ONLY mode.
    Tools denied: Write, Edit, Bash, NotebookEdit

    Do NOT suggest fixes, ONLY identify issues.",
    description="Code review agent",
)
```

### Implementation Agents (Full access)

```
Task(
    subagent_type="general-purpose",
    prompt="Implement the feature following TDD:
    1. Write test first
    2. Implement code to pass test
    3. Refactor if needed

    You have FULL tool access.",
    description="TDD implementation",
)
```

## Tool Categories

| Category | Tools | Use For |
|----------|-------|---------|
| **Read-only** | Read, Grep, Glob, Bash (read commands only) | Exploration, search |
| **Analysis** | Read, Grep, Glob | Review, research |
| **Implementation** | Read, Write, Edit, Bash | Coding, testing |
| **Full access** | All tools | Complex tasks needing flexibility |

## Default Restrictions by Agent Type

| Agent Type | Denied Tools | Purpose |
|------------|--------------|---------|
| Explore | Write, Edit, NotebookEdit, Bash | Codebase exploration |
| Plan | Write, Edit | Planning without execution |
| Review | Write, Edit, NotebookEdit | Analysis without changes |
| Implement | None | Full development capability |

## Enforcement Pattern

### In Skill Prompts

When delegating to Task agents, explicitly state restrictions:

```markdown
## Delegation Rules

When spawning Task agents:

1. **Exploration tasks** → Explore agent (built-in restrictions)
2. **Review tasks** → General agent with: "Tools denied: Write, Edit, Bash"
3. **Implementation tasks** → General agent with full access

**CRITICAL**: Always specify tool restrictions in the agent prompt.
```

### In Agent Prompts

```
You are a READ-ONLY review agent.

**Tools you CANNOT use:**
- Write (creating files)
- Edit (modifying files)
- NotebookEdit (modifying notebooks)
- Bash (executing commands)

**Tools you CAN use:**
- Read (reading files)
- Grep (searching code)
- Glob (finding files)

Your job is to ANALYZE, not to MODIFY.
```

## Cost Optimization

More restrictions = faster agents = lower cost:

| Restrictions | Speed | Cost | Use For |
|--------------|-------|------|---------|
| Heavy (Read only) | Fastest | Lowest | Quick searches |
| Medium (No Write/Edit) | Fast | Low | Reviews, analysis |
| Light (No restrictions) | Slower | Higher | Implementation |

## Example: Multi-Agent Parallel Search

```bash
# Launch 3 parallel read-only agents
Task(
    subagent_type="Explore",
    prompt="Find all authentication implementations",
    description="Search auth patterns",
    run_in_background=true
)

Task(
    subagent_type="Explore",
    prompt="Find all error handling patterns",
    description="Search error handling",
    run_in_background=true
)

Task(
    subagent_type="Explore",
    prompt="Find all API endpoint definitions",
    description="Search API endpoints",
    run_in_background=true
)

# Collect results with TaskOutput
```

All agents run in parallel with built-in restrictions (no file modifications).

## Anti-Patterns

**DON'T:**
- Give Write access to review agents
- Give Bash access to analysis agents
- Skip tool restrictions "just in case"
- Use general-purpose agents for simple searches (use Explore)

**DO:**
- Default to most restrictive set
- Grant permissions only when needed
- Use built-in agent types (Explore) when possible
- Explicitly document restrictions in prompts

## Related

- oh-my-opencode: `src/shared/permission-compat.ts`
- oh-my-opencode: `createAgentToolRestrictions(denyTools)`
