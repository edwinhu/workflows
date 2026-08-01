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

**NEVER dispatch one-per-message:**
```
# WRONG: one dispatch per turn — each waits for the previous to finish
task1 = Task(...) # message 1
task2 = Task(...) # message 2
```

**Benefits:**
- 3x faster for 3 agents
- Main conversation continues immediately
- Results collected asynchronously

### EXCEPTION: blocking gates dispatch synchronously

**If the caller cannot proceed without the agent's result, pass `run_in_background=false`.**

A backgrounded agent returns a completion *notification*, not its result. The dispatcher then sits
idle waiting for a verdict that will never arrive on that channel — the agent finished, and nobody
got the answer. Plan review is the canonical case (`skills/*-plan-reviewer/SKILL.md`); so are the
`audit-fix-loop` fresh auditor, the `visual-verify` vision prongs, and the `writing-lit-review`
librarian fan-outs.

**This costs no parallelism.** Synchronous is not sequential: multiple `run_in_background=false`
dispatches issued in ONE message still run concurrently, and all of them return before the next
turn. Background buys you a conversation that continues *before* the results land — which is exactly
what a gate must not do.

**Result delivery.** A synchronously dispatched agent's final message IS its return value and
reaches its dispatcher directly. A backgrounded agent or a named teammate must call `SendMessage`
for anything to reach the dispatcher. An agent whose `tools:` frontmatter omits `SendMessage`
therefore has no way to report from the background — it can only be dispatched synchronously.

**A successful `SendMessage` is not proof of receipt.** From the sender's side a message that
didn't land is indistinguishable from one never sent, so a dispatcher that NEEDS a result should
dispatch synchronously rather than depend on the agent pushing it.

**Idle does not mean silent.** A completion/idle notification can reach the dispatcher BEFORE the
agent's own message does. Reading "idle" as "reported nothing" is a mistake — ask the agent, don't
conclude, and never re-dispatch work that may already be done and already reported.

## Tool Restrictions (Enforce Focus)

Every delegated Task agent should have explicit tool restrictions:

| Agent Purpose | Denied Tools | Reason |
|---------------|--------------|--------|
| Exploration | Write, Edit, NotebookEdit, Bash | Read-only search |
| Review | Write, Edit, NotebookEdit | Analysis without changes |
| Profiling | Write, Edit, NotebookEdit | Data inspection only |
| Implementation | None | Full development access |

**Pattern:** Default to most restrictive, grant only when needed.

See: `references/tool-restrictions.md`

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

See: `references/delegation-template.md`

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

See: `references/skill-metadata.py` - `get_env_context()`

Applied to: `/wrds`, `/lseg-data`, `/gemini-batch`

## Cost Classification System

Skills are classified by cost:
- **FREE**: Simple operations, no model calls (explore, grep)
- **CHEAP**: Fast models, simple tasks (profiling, review)
- **EXPENSIVE**: Complex reasoning, architecture decisions (design, debug after 3 failures)

See: `references/skill-metadata.py` - `CostLevel`

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

See: `references/skill-metadata.py`

## Pattern References

All patterns documented in:
- `references/` - Metadata infrastructure, delegation templates, tool restrictions

## Additional Resources

For implementation details of oh-my-opencode patterns, see:
- Plugin-dev skills (hook-development, agent-development, skill-development) - Best practices
- [obra/superpowers](https://github.com/obra/superpowers) - Behavioral enforcement patterns
