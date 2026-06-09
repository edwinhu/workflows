# Creator Anti-Patterns

Real lessons from production. Read before writing your first draft.

## Anti-Pattern 1: Using `${CLAUDE_PLUGIN_ROOT}` in Skill Content

`${CLAUDE_PLUGIN_ROOT}` is **NOT a valid string substitution** in skill content. It works in **hook commands only** (Claude Code substitutes it there). In skill content, only these substitutions are available:

| Variable | Works In | Description |
|----------|----------|-------------|
| `${CLAUDE_SKILL_DIR}` | Skill content | Directory containing the skill's SKILL.md |
| `${CLAUDE_SESSION_ID}` | Skill content | Current session ID |
| `$ARGUMENTS` / `$N` | Skill content | Arguments passed to skill |
| `${CLAUDE_PLUGIN_ROOT}` | **Hook commands only** | Plugin installation directory |

**For referencing files outside the skill directory:**

```markdown
# In skill content (SKILL.md) — use ${CLAUDE_SKILL_DIR} with relative navigation:
# Bang-backtick injection (inlines file at load time):
#   BANG + `cat ${CLAUDE_SKILL_DIR}/../../references/constraints.md`
Read `${CLAUDE_SKILL_DIR}/../../skills/other-skill/SKILL.md` and follow its instructions.

# In hook commands — ${CLAUDE_PLUGIN_ROOT} works:
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.py"
```

**For internal skills loaded via Read() (not Skill system):** No substitution occurs — neither `${CLAUDE_PLUGIN_ROOT}` nor `${CLAUDE_SKILL_DIR}` is substituted. Use `${CLAUDE_SKILL_DIR}/../../` as a consistent convention for paths — Claude infers the actual path from context, and consistency with top-level skills makes the codebase easier to maintain.

## Anti-Pattern 2: Including Implementation Code Directly in SKILL.md

When a skill body contains step-by-step implementation code (create this file, run this command, parse the output with this script), agents memorize the recipe on first read and then **reimplement it inline** in subsequent invocations — bypassing all the skill's enforcement patterns (red flags, rationalization tables, Iron Laws).

No amount of "don't reimplement me" enforcement text can overcome this. The skill is literally a cookbook that says "don't cook this yourself" while printing the full recipe. The agent will always cook.

**The fix:** Extract deterministic multi-step implementations into `scripts/` and have the skill invoke the script. This flips the path of least resistance — running the script becomes easier than hand-rolling the implementation.

**Real example:** The `find-slide-page` skill had Steps 1-3 showing how to create a `query-headings.typ` wrapper file, run `typst query`, and parse JSON output with an inline Python script. Despite having 10 red flag entries and 8 rationalization table entries, agents in every session reimplemented the recipe inline instead of invoking the skill. After extracting to `scripts/find-slide-page.sh`, the skill became a one-liner invocation and the bypass pattern stopped completely.

| Extract to `scripts/` when | Keep inline when |
|---|---|
| Implementation is >10 lines of deterministic code | Implementation requires judgment calls that change per invocation |
| Same sequence of commands repeats every invocation | Code is truly trivial (1-2 lines) |
| Enforcement patterns agents keep bypassing | Skill is a knowledge reference, not a tool wrapper |
| Multiple steps could be a single script call | |

## Enforcement Iteration Signals

During eval loops, watch for these signals in test run transcripts:

- **Agent skipped a step** → needs an Iron Law or Gate Function
- **Agent rationalized a shortcut** → capture the underlying non-derivable fact (what the agent didn't know or overrode) as a Fact Row with its drive-consequence
- **Agent went down a wrong path** → add a Red Flag + STOP (action-targeted: "About to X")
- **Agent claimed completion without evidence** → state the fact in the Iron Law: an unverified claim presented as done is a form of dishonesty
- **Agent stopped between tasks** → add No Pause Between Tasks
- **Agent bypassed a mechanical constraint** → extract to a scoped hook (PreToolUse/PostToolUse)
- **Skill loads stale context** → use bang-backtick to inject live state at load time
