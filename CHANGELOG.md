# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [4.44.0] - 2026-03-18

### Added
- Writing workflow: full GSD adoption — deviation rules (R1 factual, R2 evidence, R3 structural, R4 argument restructuring STOP), `.planning/` state folder, `writing-validate` phase (claim coverage), `writing-handoff` skill
- `writing-validate` skill: maps PRECIS claims to draft sections, 4-level validation (exists, substantive, supported, addresses claim), produces VALIDATION.md
- `writing-handoff` skill: structured session handoff with writing-specific frontmatter (section_in_progress, total_sections)
- Deviation rules constraint in `writing-common-constraints.md`
- Handoff detection in `/writing`, `/writing-review`, and `/writing-revise` entry points

### Changed
- All writing state files migrated from `.claude/` to `.planning/` (PRECIS.md, OUTLINE.md, REVIEW.md, REVIEW_STATE.md, ACTIVE_WORKFLOW.md, completed-workflows/)
- `writing-draft` now chains to `writing-validate` (not `/writing-review` directly)

## [4.43.0] - 2026-03-18

### Added
- DS workflow: full GSD adoption — deviation rules (R1-R3 auto, R4a data assumptions, R4b methodology STOP), `.planning/` state folder, `ds-validate` phase (DQ checks as test suite), `ds-handoff` skill for session pause/resume
- `ds-validate` skill: maps SPEC.md requirements to output artifacts, runs DQ1-DQ5 + M1 checks, produces VALIDATION.md
- `ds-handoff` skill: structured session handoff with YAML frontmatter and mandatory sections
- C8 (Deviation Rules) constraint in `ds-common-constraints.md`
- Handoff detection in both `/ds` and `/ds-fix` entry points

### Changed
- All DS state files migrated from `.claude/` to `.planning/` (SPEC.md, PLAN.md, LEARNINGS.md, REVIEW_STATE.md)
- `ds-implement` now chains to `ds-validate` (not `ds-review` directly)
- `ds-checks.md` check matrix updated with `ds-validate` column

## [4.42.0] - 2026-03-18

### Fixed
- `dev-common-constraints.md`: replaced relative `Read("real-test-enforcement.md")` with cache discovery pattern for path portability
- `dev-clarify`, `dev-design`, `dev-review`: removed process hints from skill descriptions (trigger-only per enforcement pattern #10)

## [4.41.0] - 2026-03-18

### Added
- `workflow-creator`: GSD deviation rules, state folder convention, and session handoff patterns

## [4.40.0] - 2026-03-18

### Added
- Dev workflow: GSD patterns — deviation rules (4-rule system), `.planning/` state folder, test gap validation phase, session handoff (`dev-handoff` skill), goal-backward verification (`dev-verifier` agent)
- `dev-test-gaps` skill and `test-gap-auditor` agent for requirement-to-test coverage mapping
- `dev-handoff` skill for structured session pause/resume

## [4.39.0] - 2026-03-17

### Added
- `companion` skill: launch and correctly frame companion (host Claude Code) sessions — pre-flight checklist, path mapping, prompt templates, rationalization prevention

## [4.3.0] - 2026-03-05

### Added
- `assistant` agent for personal productivity (email, calendar, tasks, notes, Google Workspace)
  - Wraps superhuman, morgen, obsidian CLI, and gws
  - Delegates to `nlm` skill for deep research via Skill tool

### Changed
- `librarian` agent: replaced inline NLM command table with `Skill(skill="workflows:nlm")` invocation
- `nlm` skill: extracted workflow recipes to `references/workflows.md`, added Readwise→NLM import docs

## [4.2.2] - 2026-02-15

### Added
- Generic ETL strategy assessment in ds-plan phase
- SAS ETL performance enforcement in WRDS skill and ds workflow

## [4.2.1] - 2026-02-13

### Added
- Google Scholar: BibTeX export, cite command, download command
- Anti-hallucination enforcement for Google Scholar results

## [4.2.0] - 2026-02-13

### Added
- Bluebook-audit workflow skill for law review footnote auditing (7 phases)
- PATH-based CLI names with dependency checks

## [4.1.0] - 2026-02-13

### Added
- Google Scholar skill integrated with librarian agent
- README documentation overhaul

## [4.0.0] - 2026-02-11

### Changed (BREAKING)
- Moved all entry skills from `lib/skills/` to discoverable `skills/` root
- Renamed midpoint skills for consistency (e.g., `dev-edit` -> `dev-debug`)

## [3.0.1] - 2026-02-11

### Removed
- Redundant `/checkpoint` and `/verify` skills

## [3.0.0] - 2026-02-11

### Changed (BREAKING)
- Replaced slash commands with discoverable skills
- Removed `commands/` directory entirely
- Skills are now auto-discovered from `skills/` directory

## [2.46.1] - 2026-02-11

### Fixed
- session-start: substitute CLAUDE_PLUGIN_ROOT in using-skills content

## [2.46.0] - 2026-02-11

### Added
- Promoted visual-verify from internal to discoverable skill

## [2.45.1] - 2026-02-11

### Added
- `/visual-verify` command for standalone render-vision-fix loops

## [2.45.0] - 2026-02-10

### Changed
- Extracted tinymist plugin to standalone repo

## [2.44.1] - 2026-02-10

### Fixed
- session-start: load using-skills from correct lib/skills path

## [2.44.0] - 2026-02-10

### Changed
- Readwise: replaced opencode delegation with readwise-cli

## [2.43.0] - 2026-02-09

### Added
- Agent team parallelization across all workflows (dev, ds, writing)

## [2.42.1] - 2026-02-08

### Fixed
- continuous-learning: save skills as `name/SKILL.md` directories

## [2.42.0] - 2026-02-07

### Changed
- Writing-legal: overhauled law review template formatting
- Extracted formatting reference for legal writing

## [2.41.0] - 2026-02-06

### Added
- Writing-review: paragraph-level gates, quote verification, section mapping

## [2.40.0] - 2026-02-06

### Changed
- Updated plugin description

## [2.39.0] - 2026-02-06

### Added
- Writing-review skill for hierarchical document diagnosis
- Agent team parallel implementation in dev workflow

## [2.38.0] - 2026-02-06

### Changed
- All writing source searches routed through librarian agent
- DS workflow: audit and harden, add linted subagents (ds-analyst)

## [2.37.0] - 2026-02-06

### Added
- visual-verify skill for render-vision-fix loops (agentic mode)

## [2.36.1] - 2026-02-06

### Added
- PHILOSOPHY.md: midpoint constraint loading pattern
- Writing-edit: load full domain skill before edit checks

## [2.36.0] - 2026-02-06

### Added
- Two-entry-point architecture for all workflows (start fresh + midpoint re-entry)

## [2.35.x] - 2026-02-01 to 2026-02-06

### Added
- Readwise skill with server-side tag filtering
- Readwise CLI integration (replacing opencode delegation)
- look-at: agentic vision mode with code execution
- data-context skill for dataset knowledge extraction
- workflow-creator skill for designing LLM workflows
- nlm: research command, generation and content transformation commands
- Librarian: skill-based orchestrator with NLM-first hierarchy
- Writing-legal: user-facing skill with Volokh enforcement
- PreToolUse hook to block direct Readwise MCP calls in main chat

### Removed
- gog skill (superseded by superhuman-cli)

### Changed
- Writing workflow decomposed with writing-setup, writing-outline, writing-draft phases
- Librarian simplified to skill-based orchestrator

## Pre-2.35

Highlights from earlier development:
- **v2.34**: Streamlined writing workflow with `/writing` entry point
- **v2.33--2.30**: LSEG Data Library references, WRDS documentation
- **v1.x--v2.29**: Consolidated to single workflows plugin, delegation patterns, DS workflow hardening
- **v0.5.0**: Major skill audit with TOCs and progressive disclosure
- **v0.3.0**: Initial commit with dev and ds plugins
