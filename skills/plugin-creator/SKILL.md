---
name: plugin-creator
description: "This skill should be used when the user asks to 'create a plugin', 'scaffold a plugin', 'set up plugin structure', 'new plugin', 'edit the plugin manifest', 'wire plugin hooks', 'validate plugin structure', or needs plugin-level work spanning multiple components. For creating or editing a single skill (even inside a plugin), use skill-creator instead."
---

# Plugin Creator (with Superpowers Enforcement)

This skill wraps the built-in `plugin-dev:create-plugin` with enforcement pattern awareness from the superpowers framework. It adds an enforcement audit layer that the built-in version lacks.

**`hooks/validate-skill-paths.ts` is registered** on `PostToolUse Edit|Write` and reports any `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` reference that resolves to a missing file. `hooks/plugin-validate.ts` is **not registered** — its only finding on this repo is a constant symlink warning identical for 91 of 92 firing files. Run manifest validation by hand: `claude plugin validate <plugin-dir>`.

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

!`cat ${CLAUDE_SKILL_DIR}/../../references/creator-anti-patterns.md`

### Step 1b: Check for Mechanical Enforcement Opportunities

Before drafting, identify constraints that should be **mechanically enforced** rather than prompt-enforced. Four mechanisms are available:

| Mechanism | Resolves at | Use for |
|-----------|------------|---------|
| `${CLAUDE_SKILL_DIR}` | Skill load | Script paths in Bash templates (use directly, never wrap in `$()`) |
| `!`command`` (bang) | Skill load | Injecting reference file content, environment state |
| Scoped hooks (Pre/PostToolUse) | Each tool call | Mechanically checkable constraints (lint, path guards) |
| SessionStart hook (`once: true`) | Session start | Expensive computations (API calls, index builds) — not paths or content |

**The principle:** if a constraint is mechanically checkable, enforce it with a hook. If it requires judgment, keep it as prompt text.

### Step 2: Invoke the Built-in Plugin Creator

Use the Skill tool to invoke the built-in plugin creator:

```
Skill(skill="plugin-dev:create-plugin")
```

Follow its full process. The built-in creator handles the workflow — do not reimplement it.

### Step 3: Enforcement Audit (After Each Draft)

After writing or revising plugin components (and before final validation), audit against the superpowers enforcement patterns. Read the enforcement checklist:

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md`

Then score the draft using the appropriate template:

#### For Plugin Skills

Score against all 12 patterns from the checklist. Focus especially on:

1. **Iron Laws** — Does each skill have absolute constraints for high-drift actions?
2. **Fact Rows** (supersedes Rationalization Tables, v5.36.0) — Does each skill state its incident-learned, non-derivable knowledge (numbers, thresholds, named incidents, tool quirks) as declarative bullets with drive-framed consequences? Legacy excuse/reality tables count as present but convert on next touch; never author new ones.
3. **Red Flags + STOP** — Are there pattern interrupts for observable wrong actions?
4. **Trigger-Only Descriptions** — Does each skill description contain ONLY trigger phrases, no process summary?
5. **Gate Functions** — Does every phase transition have a verifiable exit condition?

#### For Plugin Hooks

Verify:

1. **Matcher coverage** — Do hooks fire on the right tool events?
2. **Path validity** — Do hook commands use `${CLAUDE_SKILL_DIR}/../..` (not `${CLAUDE_SKILL_DIR}`)?
3. **Error handling** — Do hooks fail gracefully (non-zero exit blocks the action)?
4. **Scope** — Are hooks scoped to skills (frontmatter) or global (plugin.json)?

#### For Plugin Structure

Verify:

1. **plugin.json** — Valid manifest with correct version, name, description
2. **marketplace.json** — Version matches plugin.json in all locations
3. **Directory layout** — skills/, hooks/, commands/, agents/ as needed
4. **Path portability** — No hardcoded absolute paths in any component

### Step 4: Reconcile Tensions

**Tension resolution:** Enforcement patterns go in skill body (not description), implementation code goes in scripts/, names are descriptive but descriptions are trigger-only.

### Step 5: Continue Iteration

Return to the built-in plugin creator's process for validation and testing. After each iteration's revision, re-run the enforcement audit (Step 3).

During iteration, watch for enforcement iteration signals (see "Enforcement Iteration Signals" in the anti-patterns reference loaded above).

## References

- **Enforcement checklist**: `references/enforcement-checklist.md` (loaded above via bang injection)
- **Anti-patterns**: `references/creator-anti-patterns.md` (loaded above via bang injection)
- **Philosophy**: `references/PHILOSOPHY.md`
- **Built-in plugin creator**: `plugin-dev:create-plugin`
