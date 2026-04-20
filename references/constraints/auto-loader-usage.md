---
name: auto-loader-usage
description: Phase skills must bang-invoke load-constraints.py instead of listing Read() calls for each .md constraint file
applies-to: [workflow-creator]
---

## Rule

**PHASE SKILLS LOAD CONSTRAINTS VIA THE AUTO-LOADER. Manual `Read()` lists for constraint files are a legacy fallback, not the preferred pattern.**

Each phase skill that loads constraint prose MUST use:

```
!`python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py <skill-name>`
```

This is the same architecture as `check-all.py` for constraint `.py` files — auto-discovery from the filesystem, filtered by `applies-to` frontmatter. No skill edits needed when a constraint is added or removed.

## Why

| Pattern | Problem |
|---------|---------|
| **Manual `Read()` list** | Adding a new constraint requires editing every skill that should load it. Drift is invisible: a skill can fall out of sync with its declared `applies-to` set and nothing will catch it. |
| **Auto-loader bang** | Add constraint file with `applies-to` frontmatter → it automatically loads in every matching skill. The `.md` file is the single source of truth. |

The `atomic-constraints` rule says: one `.md` per rule, `applies-to` controls scope, filesystem is the index. The auto-loader is how that architecture reaches the skill at load time. Without it, constraints are atomic in the filesystem but wired manually in each skill — defeating the purpose.

## How to Apply

A skill that currently has:

```markdown
Read `${CLAUDE_SKILL_DIR}/../../references/constraints/foo-common.md`
Read `${CLAUDE_SKILL_DIR}/../../references/constraints/foo-rule-a.md`
Read `${CLAUDE_SKILL_DIR}/../../references/constraints/foo-rule-b.md`
Read `${CLAUDE_SKILL_DIR}/../../references/constraints/foo-rule-c.md`
```

becomes:

```markdown
## Shared Enforcement

Auto-load all constraints matching `applies-to: <skill-name>`:

!`python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py <skill-name>`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**
```

Verify the `applies-to` frontmatter on each constraint `.md` actually covers this skill. Run the loader manually to confirm the expected constraints appear in the output.

## Exceptions

- **Single-file ad-hoc reference.** A skill that reads ONE specific `.md` as documentation (e.g., referencing a checklist while executing a different phase) is not loading a phase constraint set. Not a violation.
- **Router skills.** Entry points that immediately delegate to another skill without evaluating work don't need to load constraints themselves — the delegated-to skill loads them.
- **Plugins without the loader script.** If `scripts/load-constraints.py` is absent in the plugin, manual `Read()` is the only option.

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Adding a new constraint and editing every skill that should load it | You're doing work the loader is supposed to do. The `applies-to` frontmatter is the wiring. | Add `applies-to` to the constraint file. The loader picks it up. |
| Leaving a long `Read()` list because "it still works" | It works until a new constraint is added and some skills get it and some don't. Silent drift. | Replace the list with one loader bang line. |
| "This skill only has 2 Read calls, loader is overkill" | Two today, five tomorrow. The loader scales; the list doesn't. | Use the loader uniformly. One pattern, everywhere. |
