# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [5.76.0] - 2026-07-22

### Changed
- **Skill asset indexes completed.** Twelve files under `skills/*/{references,examples,scripts}` existed but were named nowhere — reachable only by listing the directory, which nothing instructs an agent to do. Progressive disclosure fails silently here: the SKILL.md index *is* the discovery mechanism.
  - **`wrds`** was the worst case: 7 references (`linkage`, `blockholders`, `execucomp`, `iss-directors`, `iss-voting`, `tfn-ownership`, `lpc-dealscan`, plus `muni-bonds` and `wrds-forms-tables`), **3 entire pipeline directories** (`blockholders_pipeline`, `form4_pipeline`, `proxy_advisors_pipeline`), 4 example notebooks/scripts, and the `scan_covers` / `parse_13f` / `scan_headers` / `sec_index_rga` tooling were all missing from the index — including `blockholders_pipeline/redo_bridge.py`, which another skill cites as its reference implementation. `voting_ownership_eda.py` is listed with an honest note that `voting_ownership_pipeline/` supersedes it for production work.
  - **`hpc`** gained an Additional Resources section: `sge-to-slurm.md` (the skill advertises "convert SGE to Slurm" in its own description) and both `array_job_*.sh` templates, framed as copy-these-first since they already use `--partition=standard`.
  - **`readwise`**: `reader-api.md`, plus `readwise_prune.py` marked as the direct-API implementation behind the sanctioned `readwise-custom prune` CLI.
  - **`law-review-docx`**: a Typographic Widows section documenting `check_widows.py` / `fix_widows.py`. `build_docx.py`'s `widowControl` only prevents page-level widows; a last line holding two stray words needs these. Notes that `fix_widows.py` edits source markdown, so `--dry-run` first.
  - **`docx-render`**: the one-time macOS `setup_garamond_render_override.py` step, without which x2t crams every upright Garamond run (the italic face poisons the metrics). Points at the investigation that measured it.

### Removed
- `skills/writing-legal/templates/law_review_template.docx.bak` — an 80KB snapshot of the template taken before an edit in 29e8d78. Git already holds every prior version of `law_review_template.docx`; recover with `git show 29e8d78:skills/writing-legal/templates/law_review_template.docx.bak` if ever needed.

## [5.72.1] - 2026-07-21

### Changed
- **`paperpile`**: corrected the wedged-tab explanation in `scripts/refresh-auth-from-dia.sh`. The prior comment blamed the CDP hang on "a playing YouTube tab", which was an over-specific inference from one observation. Re-probing three hours later, the YouTube tab answered in milliseconds and an unrelated tab hung instead — it tracks renderer busyness, not the site. No code change; the browser-target fix was already right, and this makes it more clearly right (if the culprit were a known site you could special-case it; since any tab can wedge and the identity drifts, avoiding page targets entirely is the only sound answer).

## [5.72.0] - 2026-07-21

### Added
- **`law-econ-docx` skill**: builds a submission-ready Word manuscript for the Chicago-style law-and-economics journals (JLE, JLS, JLEO, ALER) and econ-flavored job market papers. These journals publish **no** official Word template; every one circulating online is third-party and inconsistent.
  - `skills/writing-legal/templates/law_econ_template.docx` — Latin Modern typography, double spaced throughout, JLE subhead ladder (`1.` bold / `1.1.` italic / `1.1.1.` roman) via Word list numbering, hanging-indent reference list, `Latin Modern Math` for OMML.
  - `scripts/make_le_template.py` — the template is **generated, not hand-edited**: starts from `pandoc --print-default-data-file reference.docx`, transplants the WordTeX typography, applies the JLE overrides, self-verifies. Every choice is auditable in one file.
  - `scripts/build_le_docx.py` — sibling of `law-review-docx`'s `build_docx.py` that **imports** its machinery (includes, widow control, booktabs tables, PDF render, acknowledgment injector) rather than duplicating it. Wires `--citeproc` + a vendored CMOS 18e author-date CSL, guarantees the reference list, retags back-matter headings so they escape section numbering, warns on citation-only footnotes and 150+-word abstracts.
  - `references/jle-house-style.md` — the editorial spec, compiled from the JLE author instructions and the Chicago EMS guide (both 403 automated fetches; read via web.archive.org).
  - `examples/sample/` — round-trip sample exercising headings, a table with a note, a figure, math, footnotes, and author-date cites.
  - `tests/test_law_econ_docx.py` — 27 tests incl. a regeneration check that fails if the committed .docx diverges from its generator.

### Changed
- `build_docx.style_tables()` takes an additive `width_factor` (default `1.0`, law-review behavior unchanged). Latin Modern Roman sets ~15% wider than the Times metrics the width model assumes; without the correction Word broke table header words mid-token.

## [4.81.0] - 2026-04-10

### Added
- **WRDS ISS Voting reference** (`skills/wrds/references/iss-voting.md`): vavoteresults and voteanalysis_npx tables, base-conditional turnout/forpct logic, CRSP CUSIP+ticker linking, director election agenda codes
- **WRDS TFN Ownership reference** (`skills/wrds/references/tfn-ownership.md`): 13-F S34 institutional ownership pipeline, S12 mutual fund holdings via MFLINKS, passive/index classification, as-of merge pattern
- **Voting + Ownership EDA notebook** (`skills/wrds/examples/voting_ownership_eda.py`): full Python/PostgreSQL translation of the SAS `1-make.sas` pipeline — ISS votes, CRSP linking, 13-F IO, S12 MF holdings, merge_asof, summary stats and plots

## [4.80.0] - 2026-04-10

### Added
- **WRDS ISS Directors reference** (`skills/wrds/references/iss-directors.md`): two-table schema (risk.directors + risk.rmdirectors), type harmonization, 1996 gender backfill, S&P 1500 filter
- **WRDS ExecuComp reference** (`skills/wrds/references/execucomp.md`): CEO anncomp, legacy codirfin vs current directorcomp, firm-year aggregation, combining both tables
- **WRDS Compustat additions**: business segments (compseg.seg_annfund), derived variables (tobins_q, roa, leverage, cusip6), SIC fallback, winsorization, 5 new gotchas
- **WRDS CRSP additions**: market index tables (msi/dsi), annual stock performance, 60-month rolling volatility, year-end market cap, 6 new gotchas
- **Marimo `--watch` flag**: added to all `marimo edit` commands in SKILL.md and marimo-pair finding-marimo.md

### Fixed
- New reference files consolidated in `skills/wrds/references/` instead of duplicating in top-level `references/`

## [4.48.0] - 2026-03-18

### Added
- **Two-track DS delegation**: ds-delegate routes tasks by type (`engineering` vs `analysis`)
  - `ds-engineer` agent: pipeline/ETL tasks with determinism, schema validation, join audits, idempotency enforcement
  - `ds-analyst` agent: analysis tasks with statistical validity, p-hacking prevention, robustness, SE specification
  - Keyword-based type detection heuristic when PLAN.md tasks lack explicit `type` field
- `references/ds-engineering-constraints.md` (E1-E5): determinism, schema contracts, join audits, idempotency, error handling
- `references/ds-analysis-constraints.md` (A1-A7): statistical validity, p-hacking prevention, robustness checks, sample selection, SE specification, visualization integrity, analysis-specific deviation rules
- Type-aware methodology reviewer in ds-delegate: engineering checklist (schema, determinism) vs analysis checklist (stats, specification)

## [4.47.0] - 2026-03-18

### Added
- **DS workflow audit fixes** (6.5 → 9.4 composite):
  - Requirement IDs (`CAT-NN` format) in SPEC.md template with scope classification (v1/v2/out-of-scope)
  - Checkpoint type annotations on all 11 DS phase gates (human-verify/decision)
  - `allowed-tools` restrictions on all reviewer/verifier agents (ds-spec-reviewer, ds-plan-reviewer, ds-review parallel reviewers, ds-verify, ds-delegate methodology reviewer)
  - Context monitoring in ds-implement and ds-fix (Warning ≤35%, Critical ≤25%, auto-handoff)
  - Structured task summaries with YAML frontmatter in ds-implement LEARNINGS.md
  - Smart-discuss batching in ds brainstorm (batch 3+ independent questions)
  - Requirement tracing in ds-review issue output and ds-verify success criteria
- Wired `test-gap-auditor` agent in dev-test-gaps (was using `general-purpose`)

## [4.46.0] - 2026-03-18

### Added
- **GSD patterns in workflow-creator**: checkpoint types (human-verify/decision/human-action), context monitoring (35%/25% thresholds), summary frontmatter (implements/requires/provides/affects), READ-ONLY verifier enforcement (allowed-tools), requirement traceability (CATEGORY-NN IDs), autonomous phase chaining (smart-discuss, blocker handling)
- **Dev workflow audit fixes** (8.1 → 9.5 composite):
  - Requirement IDs (`CAT-NN` format) in SPEC.md, PLAN.md `implements` column, VALIDATION.md mapping, review issue output, verification traceability
  - `allowed-tools` restrictions on all reviewer/verifier agents (dev-spec-reviewer, dev-plan-reviewer, dev-review parallel reviewers, dev-verify, dev-delegate spec/quality reviewers)
  - Checkpoint type annotations on all 8 phase gates + handoff
  - Context monitoring in dev-implement and dev-debug (Warning at ≤35%, Critical at ≤25%, auto-handoff)
  - Structured task summaries with YAML frontmatter in dev-implement LEARNINGS.md
  - Smart-discuss batching in dev-clarify (batch 3+ independent questions)
  - Test-gap auditor tool restrictions (write tests only, never implementation)
- **Fenced bang-backtick detection** in validate-skill-paths.py hook — catches `!`cat`` inside markdown fences (Claude Code parser ignores fences and executes them)
- Fixed fenced bang-backtick examples in skill-creator and workflow-creator

### Changed
- workflow-creator Mode 2 audit now scores 15 principles (was 9) — added checkpoint types, context monitoring, summary frontmatter, agent tool restrictions, requirement traceability, autonomous phase chaining
- workflow-creator Mode 3 fix patterns expanded with 7 new gap fixes
- workflow-creator Iron Laws: added NO VERIFIER WITH WRITE ACCESS, NO LONG WORKFLOW WITHOUT CONTEXT MONITORING

## [4.45.0] - 2026-03-18

### Added
- Plugin validation hook (`plugin-validate.py`): runs `claude plugin validate` after Write/Edit of plugin files (plugin.json, marketplace.json, SKILL.md, agent/command .md, hooks.json)
- Scoped PostToolUse hooks in `skill-creator` and `workflow-creator` frontmatter — validation runs automatically during plugin development skills only

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
- Moved all entry skills from `skills/` to discoverable `skills/` root
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
