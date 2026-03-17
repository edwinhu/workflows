---
name: companion
version: 1.0
description: "Use this skill when the user asks to 'launch a companion', 'start a companion session', 'run this in the background', 'delegate to companion', 'start an overnight task', 'have companion do', or wants to kick off long-running or autonomous work on the host machine. Also use when you have autonomously identified a task that warrants delegation (bug fix, pattern extraction, implementation) and are ready to launch it. This is the single entry point for all companion session launches."
---

**Announce:** "I'm using the companion skill to launch this session."

## What Companion Sessions Are

The companion (`mcp__nanoclaw__launch_companion`) is a full Claude Code instance that runs on the **host machine** asynchronously. It has all tools, access to the full filesystem, and runs in a background terminal. You get notified when it completes or fails.

Use companion sessions when:
- Work will take more than a few minutes to complete
- You want to run autonomous coding/research/investigation without blocking chat
- The task involves a specific project directory on the host
- You are delegating a pattern-extraction, implementation, or debugging task as part of your autonomous workflow

## Pre-Flight Checklist

<EXTREMELY-IMPORTANT>
**VERIFY ALL FIVE BEFORE LAUNCHING. Launch will fail or silently misbehave if any are wrong.**

1. **Host path** — `project_dir` is a HOST path like `/Users/vwh7mb/projects/nanoclaw`, never a container path like `/workspace/...`
2. **Skill syntax** — If the companion should use any workflows skill, the prompt contains the literal text `Skill(skill="workflows:<skill-name>")` — not prose like "use dev-debug" or "follow the debug workflow"
3. **Self-contained prompt** — Companion starts with ZERO conversation context. Prompt must include everything: what to do, why, relevant file paths (host paths), background context, success criteria
4. **All paths are host paths** — Every file path in the prompt is a host path. Search-replace any `/workspace/...` paths with `/Users/vwh7mb/...` equivalents before launching
5. **Descriptive title** — `task_title` is 5-10 words describing the specific task (not "fix bug" — "fix attachment parsing in superhuman reply")
</EXTREMELY-IMPORTANT>

## Path Mapping

| Container path | Host path |
|----------------|-----------|
| `/workspace/project/` | `/Users/vwh7mb/projects/nanoclaw/` |
| `/workspace/group/` | `/Users/vwh7mb/projects/nanoclaw/groups/main/` |
| `/workspace/extra/projects/<name>/` | `/Users/vwh7mb/projects/<name>/` |
| `/workspace/extra/Notes/` | `/Users/vwh7mb/notes/` (check if different) |
| `/workspace/extra/claude-config/` | `/Users/vwh7mb/.claude/` |

**When in doubt:** use `project_dir` as the parent and write relative paths in the prompt, or ask the user for the host path.

## MCP Call

```
mcp__nanoclaw__launch_companion(
  prompt="<full self-contained prompt>",
  project_dir="/Users/vwh7mb/projects/<project-name>",
  task_title="<5-10 word description>"
)
```

## Writing a Good Companion Prompt

A companion prompt is a complete briefing document. Structure it as:

```
## Task
[What to do — specific, unambiguous, actionable]

## Background
[Why this is needed. What you already know. Relevant context that won't be obvious from files alone.]

## Files to Start With
[Host paths to key files, directories to explore]

## Success Criteria
[How the companion knows it's done. What to check, what output to produce, what to report back.]

## Constraints
[What not to do. Patterns to follow. Things to avoid.]

## Required Skills
[If any workflows skills are needed, include the exact invocation syntax:]
Skill(skill="workflows:dev-debug")
```

**The "no as we discussed" rule:** Never write "as discussed", "you know what I mean", "continue what we were doing", or any reference to the current conversation. The companion cannot see any of it.

## Common Patterns

### Debug investigation
```
## Task
Debug [specific symptom] in [project].

## Background
[Error message verbatim. When it started. What was changed recently. What has already been tried.]

## Files to Start With
/Users/vwh7mb/projects/<project>/src/...

## Success Criteria
- Root cause identified and documented in HYPOTHESES.md
- Fix implemented with a regression test
- Test suite passes

## Required Skills
Skill(skill="workflows:dev-debug")
```

### Pattern extraction / learning
```
## Task
Study [specific implementation] in [project] and extract patterns into [output file].

## Background
[Why these patterns are useful. What you want to learn. What to look for.]

## Files to Start With
/Users/vwh7mb/projects/<project>/...

## Success Criteria
- Patterns documented at [output file path]
- Key insights summarized at top
- Concrete examples from source code included
```

### Feature implementation
```
## Task
Implement [feature] in [project].

## Background
[What the feature should do. Why it's needed. Design decisions already made.]

## Files to Start With
/Users/vwh7mb/projects/<project>/...

## Success Criteria
- Feature works as described
- Tests pass
- No regressions

## Required Skills
Skill(skill="workflows:dev")
```

### Research / fetch
```
## Task
Research [topic] and write a note to [output path].

## Background
[What question to answer. What we already know. What would be most useful.]

## Success Criteria
- Note written at [host path]
- Key findings summarized at top
- Sources cited
```

## Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "The prompt doesn't need that much context — it can figure it out" | It cannot. Companion starts blind. Omit context → companion guesses → bad output |
| "I'll use `/workspace/...` paths, they might work" | They won't. Companion runs on host. Container paths don't exist on the host |
| "I'll just say 'use the dev workflow' in the prompt" | Companion won't trigger the skill from prose. Must use `Skill(skill="workflows:dev")` literally |
| "The title can be generic like 'fix bug'" | A bad title makes notifications useless. Be specific |
| "I'll launch now and add context if it asks" | Companion doesn't ask. It runs to completion. Missing context → poor result |
| "This is a small task, I'll just do it in main chat" | Main chat costs your context window. Companion is free async cycles. Delegate. |

## After Launch

Once launched:
1. Tell the user what you launched and why (one sentence)
2. Continue helping with other things — you'll be notified when it completes
3. When the completion notification arrives, summarize the result for the user

Don't poll or check on it manually. The notification system handles this.
