---
name: obsidian-organize
description: "Use when the user says 'organize my notes', 'clean up the vault', 'tidy the vault', 'where should this note go', 'file this note', 'move these notes', 'rename this note', or 'the vault root is a mess' - and ALWAYS before creating a new note anywhere in the Obsidian vault, so it lands in the right PARA folder under the right name. NOT for searching notes or appending to the daily note - use the obsidian skill."
user-invocable: false
---

# Obsidian Note Organization

Clawd's Obsidian vault follows the PARA method. Every note belongs in a specific folder — nothing lives in the vault root.

## Folder Structure

```
Vault/
├── 0. Inbox/              # Unsorted captures, quick notes
├── 1. Projects/           # Active projects with deadlines
├── 2. Areas/              # Ongoing responsibilities
├── 3. Resources/          # Reference material
│   ├── People/            # Notes about individuals
│   ├── References/        # Technical references (APIs, tools, comparisons)
│   ├── Concepts/          # Ideas, frameworks, mental models
│   └── ...                # Other resource categories as needed
├── 4. Archive/            # Completed/inactive items
└── Templates/             # Note templates
```

## Placement Rules

| Note Type | Folder | Example |
|-----------|--------|---------|
| Person (colleague, contact, public figure) | `3. Resources/People/` | `Jeffrey Peck - PSLRA Lobbyist.md` |
| API docs, tool guides, tech comparisons | `3. Resources/References/` | `Claude API - Streaming Responses.md` |
| Concepts, frameworks, mental models | `3. Resources/Concepts/` | `Efficient Market Hypothesis.md` |
| Active project with a deadline | `1. Projects/` | Current research, course prep |
| Ongoing responsibility (no end date) | `2. Areas/` | Teaching, health, finances |
| Quick capture, unsorted | `0. Inbox/` | To be filed later |
| Done, no longer active | `4. Archive/` | Past projects, old references |

## Naming Conventions

Titles should be descriptive and include context so they're findable without opening the note:

- **People**: `Full Name - Role or Context.md` (e.g., `Jeffrey Peck - PSLRA Lobbyist.md`)
- **References**: `Tool/Topic - Specific Aspect.md` (e.g., `jq - Container Compatibility Notes.md`)
- **Projects**: Use the project's natural name

Avoid generic titles like `Meeting Notes.md` or `Ideas.md` — add the date, person, or topic.

## Vault Hygiene

- The vault root directory should contain **only folders**, never loose notes
- If a note doesn't clearly fit a subcategory, place it in the parent PARA folder (e.g., `3. Resources/`) rather than the root
- When in doubt, `0. Inbox/` is the right temporary home — but follow up by filing it properly
- Periodically move completed projects from `1. Projects/` to `4. Archive/`
