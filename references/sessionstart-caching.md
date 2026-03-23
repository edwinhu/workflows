# SessionStart Hook Caching Pattern

## First: Do You Actually Need This?

Most "path resolution" in skills is handled for free by `${CLAUDE_SKILL_DIR}` — substituted at skill load time to the full absolute path. If your skill just needs to call a script, use the path variable directly:

```bash
# ✅ Just use the variable — it's already resolved
python3 "${CLAUDE_SKILL_DIR}/scripts/my_script.py" --arg value
```

**Do NOT use the `$()` subshell indirection pattern:**

```bash
# ❌ BROKEN: Executes the script with no args, captures error output
SCRIPT=$(${CLAUDE_SKILL_DIR}/scripts/my_script.py) && python3 "$SCRIPT" --arg value
```

This tries to run the Python script as a command and capture its stdout. Since the script requires `--file` and `--goal` (or similar), it fails with a usage error, leaving the variable empty or garbage.

## When SessionStart Caching IS Needed

SessionStart hooks solve a different problem: **genuinely expensive operations** whose results are stable for the session but can't be expressed as simple path variables.

| Situation | Use SessionStart Cache? |
|-----------|------------------------|
| Script path reference | **No** — use `${CLAUDE_SKILL_DIR}` directly |
| Environment detection (container vs host, OS) | **Yes** — doesn't change mid-session |
| API endpoint discovery (service mesh, dynamic ports) | **Yes** — stable for session duration |
| Expensive computation (dependency graph, index build) | **Yes** — resolve once, use many |
| Dynamic state that changes between calls | **No** — must re-check each time |
| Values available via `${CLAUDE_SKILL_DIR}` | **No** — variable substitution is free |

## Pattern

```yaml
---
name: my-skill
hooks:
  SessionStart:
    - hooks:
        - type: command
          command: "expensive-operation --query something > .planning/MY_CACHED_VALUE"
          once: true
---
```

Then in skill instructions:

```
Read the cached value from `.planning/MY_CACHED_VALUE` and use it for all subsequent commands.
```

## Key Rules

1. **`once: true` is required** — without it, the hook fires on every session event
2. **Write to `.planning/`** — gitignored, ephemeral, won't pollute the project
3. **Use descriptive filenames** — `.planning/SCRIPTS_DIR` not `.planning/cache`
4. **Skill instructions must reference the cached file** — the hook writes it, the skill reads it

## Real Example

The `using-skills` meta-skill demonstrates the pattern at plugin level: `session-start.py` loads and injects its content once at session start, avoiding repeated file reads throughout the session.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|-------------|--------------|
| `SCRIPT=$(path/to/script.py)` subshell indirection | Executes script with no args; captures error output, not a path |
| Caching values `${CLAUDE_SKILL_DIR}` already provides | Unnecessary complexity — variable substitution is free |
| Caching to a non-gitignored location | Pollutes the project with ephemeral state |
| Caching values that change mid-session | Stale reads cause subtle bugs |
| Using `once: false` (default) for stable values | Unnecessary repeated work |
