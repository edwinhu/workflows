---
name: plugin-creator
description: "This skill should be used when the user asks to 'create a plugin', 'scaffold a plugin', 'set up plugin structure', 'new plugin', 'add plugin components', or needs to substantially edit an existing plugin. Use this INSTEAD of plugin-dev:create-plugin or plugin-dev:plugin-structure directly. Wraps the built-in plugin-dev creator with behavioral enforcement and structural validation hooks."
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/plugin-validate.py"
        - type: command
          command: "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/validate-skill-paths.py"
---

# Plugin Creator (with Superpowers Enforcement)

This skill wraps the built-in `plugin-dev:create-plugin` with enforcement pattern awareness from the superpowers framework. It adds an enforcement audit layer and PostToolUse validation hooks that the built-in version lacks.

## When This Skill Applies

All plugin creation and substantial plugin editing work, in any project. This skill loads **instead of** the built-in `plugin-dev:create-plugin` or `plugin-dev:plugin-structure` because it adds enforcement awareness and mechanical validation hooks.

## Process

### Step 1: Classify the Plugin

Before drafting, classify what's being created or edited:

| Type | Description | Enforcement Needs |
|------|-------------|-------------------|
| **Full plugin** | New plugin with skills, hooks, commands, agents | High — needs enforcement across all components |
| **Skill addition** | Adding a skill to an existing plugin | Medium — needs skill-level enforcement audit |
| **Hook addition** | Adding hooks to an existing plugin | Medium — needs path validation, matcher coverage |
| **Component edit** | Substantial edit to existing plugin component | Medium — needs re-audit of affected enforcement |

### Anti-Patterns: Read Before Drafting

These are real lessons from production. Read them before writing your first draft.

#### Anti-Pattern 1: Using `${CLAUDE_PLUGIN_ROOT}` in Skill Content

`${CLAUDE_PLUGIN_ROOT}` is **NOT a valid string substitution** in skill content. It works in **hook commands only** (Claude Code substitutes it there). In skill content, only these substitutions are available:

| Variable | Works In | Description |
|----------|----------|-------------|
| `${CLAUDE_SKILL_DIR}` | Skill content | Directory containing the skill's SKILL.md |
| `${CLAUDE_SESSION_ID}` | Skill content | Current session ID |
| `$ARGUMENTS` / `$N` | Skill content | Arguments passed to skill |
| `${CLAUDE_PLUGIN_ROOT}` | **Hook commands only** | Plugin installation directory |

#### Anti-Pattern 2: Including Implementation Code Directly in SKILL.md

When a skill body contains step-by-step implementation code, agents memorize the recipe on first read and then **reimplement it inline** — bypassing all enforcement patterns.

**The fix:** Extract deterministic multi-step implementations into `scripts/` and have the skill invoke the script.

### Step 1b: Check for Bang and Hook Opportunities

Before drafting, identify constraints that should be **mechanically enforced** rather than prompt-enforced:

- **Bang-backtick injection** (`!`command``) — inject dynamic context at skill load time
- **Scoped hooks** (PreToolUse/PostToolUse) — fire only while the skill is active, auto-cleaned up

**The principle:** if a constraint is mechanically checkable, enforce it with a hook. If it requires judgment, keep it as prompt text.

### Step 2: Invoke the Built-in Plugin Creator

Use the Skill tool to invoke the built-in plugin creator:

```
Skill(skill="plugin-dev:create-plugin")
```

Follow its full 8-phase process: discovery, component planning, detailed design, structure creation, component implementation, validation, testing, documentation. The built-in creator handles the workflow — do not reimplement it.

### Step 3: Enforcement Audit (After Each Draft)

After writing or revising plugin components (and before final validation), audit against the superpowers enforcement patterns. Read the enforcement checklist:

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md`

Then score the draft using the appropriate template:

#### For Plugin Skills

Score against all 12 patterns from the checklist. Focus especially on:

1. **Iron Laws** — Does each skill have absolute constraints for high-drift actions?
2. **Rationalization Tables** — Does each skill preempt the agent's excuses?
3. **Red Flags + STOP** — Are there pattern interrupts for observable wrong actions?
4. **Trigger-Only Descriptions** — Does each skill description contain ONLY trigger phrases, no process summary?
5. **Gate Functions** — Does every phase transition have a verifiable exit condition?

#### For Plugin Hooks

Verify:

1. **Matcher coverage** — Do hooks fire on the right tool events?
2. **Path validity** — Do hook commands use `${CLAUDE_PLUGIN_ROOT}` (not `${CLAUDE_SKILL_DIR}`)?
3. **Error handling** — Do hooks fail gracefully (non-zero exit blocks the action)?
4. **Scope** — Are hooks scoped to skills (frontmatter) or global (plugin.json)?

#### For Plugin Structure

Verify:

1. **plugin.json** — Valid manifest with correct version, name, description
2. **marketplace.json** — Version matches plugin.json in all locations
3. **Directory layout** — skills/, hooks/, commands/, agents/ as needed
4. **Path portability** — No hardcoded absolute paths in any component

### Step 4: Reconcile Tensions

The built-in plugin creator's structural advice and superpowers enforcement patterns have a genuine tension:

| plugin-dev says | superpowers says | Resolution |
|---|---|---|
| "Keep skills focused and lean" | "Add Rationalization Tables, Red Flags" | **Enforcement patterns go in the skill body, not the description.** Use progressive disclosure — move detailed tables to `references/` if SKILL.md exceeds 500 lines. |
| "Follow standard plugin structure" | "Extract implementation to scripts/" | **Both.** Standard structure for directories; extract deterministic code to scripts/ within that structure. |
| "Use clear, descriptive names" | "Trigger-only descriptions" | **Names are descriptive; descriptions are trigger-only.** The name explains what it does; the description contains only the phrases that should invoke it. |

### Step 5: Continue Iteration

Return to the built-in plugin creator's process for validation and testing. After each iteration's revision, re-run the enforcement audit (Step 3) on the updated components.

During iteration, also look for enforcement-specific signals:

- **Agent skipped a step** → needs an Iron Law or Gate Function
- **Agent rationalized a shortcut** → capture the exact excuse in a Rationalization Table
- **Agent went down a wrong path** → add a Red Flag + STOP
- **Agent bypassed a mechanical constraint** → extract to a scoped hook
- **Skill loads stale context** → use bang-backtick to inject live state at load time

## References

- **Enforcement checklist**: `references/enforcement-checklist.md` (in plugin root) — Full 12-pattern reference with templates. Discover via: `${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md`
- **Philosophy**: `PHILOSOPHY.md` (in plugin root) — Three pillars (phased decomposition, deterministic gates, adversarial review). Discover via: `${CLAUDE_SKILL_DIR}/../../PHILOSOPHY.md`
- **Built-in plugin creator**: `plugin-dev:create-plugin` — Handles the 8-phase workflow (discovery → documentation)
