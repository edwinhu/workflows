---
name: atomic-constraints
description: Constraints must be atomic — one rule per .md file in references/constraints/, never monolithic multi-section files
applies-to: [skill-creator, workflow-creator, plugin-creator]
---

## Rule

**ONE RULE PER CONSTRAINT FILE. This is not negotiable.**

Constraints are unit tests for agent behavior. A unit test that asserts 10 things is not a unit test — it's an integration test wearing a disguise. Same for constraints: a `.md` file with 10 sections is a monolith, not a constraint.

### What Atomic Means

| Atomic | Monolithic |
|--------|-----------|
| `typst-bullet-spacing.md` — one rule about bullet spacing | `typst-constraints.md` — 10 rules in one file |
| `ds-determinism.md` — one rule about deterministic output | `ds-common-constraints.md` — 8 rules bundled together |
| Each file independently improvable, testable, composable | Change one rule, re-read 9 others you didn't touch |

### Where Constraints Live

All constraints live in `references/constraints/`. No exceptions.

- **Constraint** = `.md` + co-located `.py` check script (same name). Mechanically testable, pass/fail.
- **Convention** = `.md` only, no `.py`. Judgment-based, loaded into LLM context.

The filesystem is the index. `ls constraints/*.md` = all rules. No TOC files. No index files.

### Loading

Skills load constraints via the auto-discovery loader:

```
!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py skill-name`
```

Each `.md` has `applies-to` frontmatter. The loader filters by skill name. Skills get only the constraints they need — not everything.

### The Monolith Test

**If a file has 3 or more `###` headings that each describe a different rule, it's a monolith.** Split it.

Signs of a monolith:
- File name ends in `-constraints.md` or `-conventions.md` (plural = bundled)
- Multiple `---` horizontal rules separating unrelated sections
- More than ~40 lines of rule content (not counting examples)
- Multiple rationalization table entries covering different rules

### Red Flags — STOP If You Catch Yourself:

- **Creating `references/foo-constraints.md` (plural)** — STOP. Create individual files in `references/constraints/`.
- **Adding a new section to an existing constraint file** — STOP. Create a new file.
- **Writing a constraint file with 3+ `###` headings** — STOP. Split into separate files.
- **Putting constraints anywhere except `references/constraints/`** — STOP. That's the one directory.
- **Creating a TOC or index file listing constraints** — STOP. The filesystem is the index.

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "One big file is simpler" | Simpler to create, harder to maintain. At 10+ sections, every skill loads rules it doesn't need. | Atomic files: one `.md` per rule |
| "They're all related (same domain)" | Related ≠ identical. Bullet spacing and widow detection are both Typst rules, but they test different things. | Co-locate in same directory, separate files. `applies-to` handles grouping. |
| "I'll split it later" | Later never comes. The monolith accumulates more sections until someone has to do the painful split. | Split now. Creating 10 small files takes the same time as one big one. |
| "The loader handles filtering" | The loader filters by *skill*, not by *rule*. A monolith forces every matching skill to load all sections. | Atomic files let the loader include only relevant rules. |
| "I need a shared rationalization table" | Each rule has its own rationalization. Bundling them trains Claude to rationalize across unrelated rules. | Keep rationalization inline with each constraint. |
