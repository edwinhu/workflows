---
name: workshop
description: "This skill should be used when the user asks to 'create a workshop presentation', 'prepare a workshop talk', 'make slides for a workshop', 'presentation for faculty workshop', 'workshop slides from paper', or needs to create academic workshop presentation slides and speaker notes from a research paper."
hooks:
  PreToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/image-read-guard.py"
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/SOURCES_VERIFIED.md
            GATE_STATUS=VERIFIED
            GATE_DESCRIPTION="Phase 1 sources gate"
            GATE_REMEDY="Return to Phase 1 and complete source gathering before writing any files"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-phase-gate-guard.py"
  PostToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/typst-convention-guard.py"
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/typst-convention-guard.py"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/overflow-check.py"
    - matcher: "*"
      hooks:
        - type: command
          command: >-
            COMPACT_THRESHOLD=40
            COMPACT_INTERVAL=20
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/suggest-compact.py
---

**Announce:** "I'm using workshop to create academic presentation slides and speaker notes."

## Shared Typst Constraints

Load ALL Typst conventions before any slide or notes work:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workshop`

**You MUST have these constraints loaded before proceeding to Phase 3. No claiming you "remember" them.**

## Session Resume Detection

Check if `.planning/HANDOFF.md` exists:
1. **If found:** Read it, show status, ask: "Resume from handoff, or start fresh?"
2. **If not found:** Proceed normally

## Workflow Overview

```
Phase 1         Phase 2         Phase 3         Phase 4
gather       → structure     → generate      → verify
(sources)      (outline)       (slides+notes)   (compile+check)
    │              │               │               │
    ▼              ▼               ▼               ▼
  GATE:          GATE:           GATE:           GATE:
  Metadata       User            Both .typ       Both compile,
  extracted,     approves        files           metadata matches
  symlinks       outline         written         source paper
  created
```

**Every gate is mandatory. Skipping a gate means the next phase operates on bad inputs.**

After completing each phase, IMMEDIATELY proceed to the next phase. Do not pause for user approval except where explicitly required (Phase 2: user approves outline).

**Smart Discuss:** If multiple questions arise in Phase 1 (e.g., paper path unclear, venue unknown, desired structure), batch them into a SINGLE user interaction. Do NOT ask one question, wait, ask another, wait. Present all ambiguities at once:
```
Before proceeding, I need to clarify:
1. Paper path: [what I found vs. what's unclear]
2. Venue/date: [known or unknown]
3. Structure preference: [default or ask]
Please answer all at once so we can proceed efficiently.
```

## Context Monitoring

Before starting each phase, check context availability:

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed normally |
| Warning | 25-35% | Complete current task, then write `.planning/HANDOFF.md` and pause |
| Critical | <=25% | Write `.planning/HANDOFF.md` immediately — no new phase |

**Phase 3 (generate) is the most context-intensive phase.** If context is at Warning level before Phase 3, write `.planning/HANDOFF.md`:
```yaml
---
workflow: workshop
phase: [current phase number]
phase_name: [current phase name]
status: context_exhaustion
last_updated: [timestamp]
---

## Current State
[What phase we're in, what's been completed in this phase]

## Completed Work
- Phase 1: [status — SOURCES.md path, inventory count]
- Phase 2: [status — OUTLINE.md path, section count]
- Phase 3: [status — slides written? notes written?]

## Remaining Work
[Specific tasks left in current phase + all subsequent phases]

## Decisions Made
[Any user decisions captured — structure proportions, venue, etc.]

## Next Action
[Specific enough to start immediately — e.g., "Write notes.typ sections 3-5 following OUTLINE.md"]
```

**Skipping handoff to "finish faster" means the last slides are garbage. The user debugs context-degraded output instead of resuming from a clean handoff. That is anti-helpful.**

## Checkpoint Types

| Phase | Gate | Type | Behavior |
|-------|------|------|----------|
| Phase 1 | Sources gathered | human-verify | Auto-advanceable |
| Phase 2 | Outline approved | decision | Pause for user input |
| Phase 3 | Slides reviewed | human-verify | Auto-advanceable (independent reviewer) |
| Phase 4 | Verified | human-verify | Auto-advanceable |

## Workflow Initialization

Create `.planning/ACTIVE_WORKFLOW.md`:
```yaml
---
workflow: workshop
phase: 1
phase_name: gather
started: [current timestamp]
project_root: [current directory]
implements: "4-phase workshop creation (gather → structure → generate → verify)"
requires: "source paper (PDF), user structure preferences"
provides: "slides.typ, notes.typ, slides.pdf, notes.pdf"
affects: "presentation/ directory"
---
```

---

## Phase 1: Gather Sources

**Responsibility:** Collect ALL source materials and extract paper metadata.

<EXTREMELY-IMPORTANT>
## The Iron Law of Title Extraction

**NEVER hallucinate, infer, or guess the paper title, subtitle, authors, or affiliations. ALWAYS extract from the source document using look-at or Read.** This is not negotiable.

Inferring metadata from filenames is fabrication. The user got burned by hallucinated titles. Every title, every author name, every affiliation MUST come from reading the actual paper.

**Skipping extraction to "help faster" is anti-helpful — it ships wrong metadata that the user has to debug and fix. That's rework you created, not time you saved.**
</EXTREMELY-IMPORTANT>

### Rationalization Table — Title Extraction

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The filename tells me the title" | Filenames are abbreviated, incomplete, or wrong | Use look-at on the actual paper |
| "I can infer the authors from context" | Context may be wrong; co-authors change between drafts | Extract from the paper's title page |
| "I'll fix the title later" | Wrong titles propagate to slides AND notes | Get it right first |
| "The user told me the title" | Verify against the paper — user may have paraphrased | Extract and confirm |

### Red Flags — STOP If You Catch Yourself:

- **Writing a title without having read the paper** → STOP. Use look-at first.
- **Typing an author name from memory** → STOP. Extract from the paper.
- **Using the directory name as the paper title** → STOP. That's fabrication.

### Steps

1. **Identify the source paper.** Ask the user if not obvious from context.

2. **Extract metadata** using look-at:
   ```bash
   uv run python3 "${CLAUDE_SKILL_DIR}/../look-at/scripts/look_at.py" \
       --file "/path/to/paper.pdf" \
       --goal "Extract: (1) full title, (2) subtitle if any, (3) all author names, (4) each author's affiliation/institution, (5) abstract summary in 2-3 sentences"
   ```

3. **Search for related teaching materials:**
   ```bash
   # Search ~/areas/ for topic keywords from the paper
   rg -l "keyword1|keyword2" ~/areas/
   ```

4. **Check for predecessor slides:**
   - Look for `gdrive` or `google-drive` symlinks in project directory
   - Check for existing `presentation/` directories

5. **Check Obsidian notes:**
   - Look for `notes` symlink in project directory
   - Search for topic-related notes

6. **Set up theme infrastructure:**
   ```bash
   # Create presentation directory if needed
   mkdir -p presentation/templates presentation/assets

   # Copy bundled workshop templates
   cp "${CLAUDE_SKILL_DIR}/templates/theme.typ" presentation/templates/
   cp "${CLAUDE_SKILL_DIR}/templates/custom-outline.typ" presentation/templates/
   ```
   The `assets/` directory starts empty — add project-specific logos and images there.

7. **Inventory the paper's figures, tables, and key results:**
   ```bash
   uv run python3 "${CLAUDE_SKILL_DIR}/../look-at/scripts/look_at.py" \
       --file "/path/to/paper.pdf" \
       --goal "List ALL: (1) figures with figure numbers and captions, (2) tables with table numbers and captions, (3) key empirical results with specific numbers (coefficients, percentages, sample sizes), (4) main theoretical propositions or hypotheses"
   ```
   This inventory is the **authoritative source** for all content in slides and notes. Every figure, table, statistic, and claim in the presentation must trace back to this inventory.

8. **Write SOURCES.md** in `.planning/`:
   ```markdown
   ---
   title: [extracted title]
   subtitle: [extracted subtitle or none]
   authors:
     - name: [author 1]
       affiliation: [affiliation 1]
       marker: "*"
     - name: [author 2]
       affiliation: [affiliation 2]
       marker: "†"
   venue: [workshop venue if known]
   date: [workshop date if known]
   ---

   ## Source Paper
   - Path: [path to paper]
   - Key sections: [list]

   ## Paper Inventory

   Every item gets a unique ID (F1, T1, R1, A1...) for traceability.
   Each slide in the presentation must reference at least one inventory ID.

   ### Figures
   - **F1:** Figure 1: [caption] (p. XX)
   - **F2:** Figure 2: [caption] (p. XX)
   ...

   ### Tables
   - **T1:** Table 1: [caption] (p. XX)
   - **T2:** Table 2: [caption] (p. XX)
   ...

   ### Key Empirical Results
   - **R1:** [Result 1 with specific numbers] (Table/Figure X, p. XX)
   - **R2:** [Result 2 with specific numbers] (Table/Figure X, p. XX)
   ...

   ### Main Arguments / Hypotheses
   - **A1:** [Argument 1] (Section X)
   - **A2:** [Argument 2] (Section X)
   ...

   ## Related Teaching Materials
   - [list of found materials with paths]

   ## Predecessor Slides
   - [list or "none found"]

   ## Obsidian Notes
   - [list or "none found"]
   ```

### Gate: Sources Gathered

- [ ] Paper metadata extracted via look-at (NOT inferred)
- [ ] Paper inventory completed (figures, tables, key results, arguments)
- [ ] SOURCES.md written with title, authors, affiliations, AND full inventory
- [ ] Theme symlinks created (templates/, assets/)
- [ ] Related materials searched (~/areas/, notes, gdrive)

**Structural gate artifact:** After verifying all checks pass, write `.planning/SOURCES_VERIFIED.md`:
```yaml
---
status: VERIFIED
phase: gather
verified_at: [timestamp]
title_source: look-at (NOT inferred)
implements: "Phase 1 — source gathering and metadata extraction"
requires: "source paper PDF"
provides: "SOURCES.md with paper inventory (F/T/R/A IDs)"
affects: "presentation/templates/, presentation/assets/"
inventory_count:
  figures: [N]
  tables: [N]
  results: [N]
  arguments: [N]
---
Sources gathered and verified. Paper metadata extracted from source document.
```

**Phase 2 will refuse to start without this file.**

**IMMEDIATELY proceed to Phase 2.**

---

## Phase 2: Structure Outline

**Responsibility:** Create section-level outline with content allocation based on user's desired structure.

### Prerequisites
- [ ] `.planning/SOURCES_VERIFIED.md` exists with `status: VERIFIED`
- [ ] `.planning/SOURCES.md` exists with paper metadata and inventory

**If `.planning/SOURCES_VERIFIED.md` is missing, STOP. Return to Phase 1 and complete the sources gate.**

### Steps

1. **Ask the user for desired structure** (if not already specified):
   - Example: "1/3 motivation, 1/3 framework, 1/3 policy"
   - Example: "Half background, half contribution"
   - Ask about total presentation time (default: 45 minutes)

2. **Read the paper's structure** — use look-at to get the table of contents / section headings:
   ```bash
   uv run python3 "${CLAUDE_SKILL_DIR}/../look-at/scripts/look_at.py" \
       --file "/path/to/paper.pdf" \
       --goal "List all section headings and subheadings in order"
   ```

3. **Map paper sections to presentation structure.** Distribute content according to user's proportions.

4. **Write OUTLINE.md** in `.planning/`:
   ```markdown
   ## Presentation Outline

   Total time: [X] minutes

   ### Part 1: [Section Name] (~[Y] minutes, [N] slides)
   = [Touying section heading]
   == [Subsection 1]
   - Slide: [slide title] — [content source: paper §X / teaching material / predecessor] → [F1, R2, A1]
   - Slide: [slide title] — [content source] → [T1, R3]

   ### Part 2: [Section Name] (~[Y] minutes, [N] slides)
   ...
   ```

5. **Present outline to user for approval.**

**Producing an outline from memory instead of the paper's structure means the presentation won't match the paper. The user discovers misaligned sections during Phase 3, requiring rework of both the outline AND the slides. Getting the structure right here saves hours downstream.**

### Red Flags — STOP If You Catch Yourself:

- **Writing an outline without having read the paper's section structure** → STOP. Use look-at first.
- **Allocating time without user's preferred proportions** → STOP. Ask the user.
- **Creating slides in OUTLINE.md without inventory IDs** → STOP. Every slide traces to F/T/R/A IDs.
- **Proceeding past Phase 2 without user approval** → STOP. This is a decision checkpoint.

### Gate: Outline Approved (decision checkpoint)

- [ ] OUTLINE.md written with section proportions and timing
- [ ] User has approved the outline
- [ ] Content sources identified for each slide with inventory IDs (F/T/R/A)

**Structural gate artifact:** After user approves, write `.planning/OUTLINE_APPROVED.md`:
```yaml
---
status: APPROVED
phase: structure
approved_at: [timestamp]
checkpoint_type: decision
implements: "Phase 2 — outline structure with content allocation"
requires: "SOURCES_VERIFIED.md, user structure preferences"
provides: "OUTLINE.md with section proportions, timing, and inventory ID mapping"
affects: ".planning/OUTLINE.md"
total_time: [N] minutes
section_count: [N]
slide_count: [N]
---
Outline approved by user. Structure: [brief summary of proportions].
```

**Phase 3 will refuse to start without this file.**

**IMMEDIATELY proceed to Phase 3 after user approval.**

---

## Phase 3: Generate Slides & Notes

**Responsibility:** Write slides.typ and notes.typ following ALL Typst conventions.

### Prerequisites
- [ ] `.planning/OUTLINE_APPROVED.md` exists with `status: APPROVED`
- [ ] `.planning/SOURCES_VERIFIED.md` exists with `status: VERIFIED`
- [ ] `.planning/SOURCES.md` exists with paper inventory
- [ ] `.planning/OUTLINE.md` exists with approved structure

**If any prerequisite is missing, STOP. Do not generate slides without approved outline and verified sources.**

<EXTREMELY-IMPORTANT>
## The Iron Law of Typst Conventions

**ALL bullet items MUST have blank lines between them. This is not negotiable.**

Wrong:
```typ
- First point
- Second point
- Third point
```

Correct:
```typ
- First point

- Second point

- Third point
```

This applies to EVERY list in EVERY slide. No exceptions.
</EXTREMELY-IMPORTANT>

### Typst Slide Conventions (from working example)

**File header (slides.typ):**
```typ
#import "templates/theme.typ": *

#show: university-theme.with(
  aspect-ratio: "16-9",
  footer-a: self => self.info.author,
  config-info(
    title: [#text(size: 0.85em)[Paper Title]],
    subtitle: [Workshop Venue],
    author: (
      [Author1#super[\*]],
      [Author2#super[†]],
    ),
    date: datetime.today(),
    institution: [#text(size: 0.8em)[#super[\*]Affiliation1  #h(1em) #super[†]Affiliation2]],
    logo: image("assets/logo.png"),  // place your institution logo in assets/
    qr: none,
  ),
)

#show link: underline
#set list(marker: ([•], [--]))
#set heading(numbering: numbly("{1}.", "{1}.{2}.", "{3}."))
#show selector(heading.where(level: 3)): set heading(numbering: none)
#show selector(heading.where(level: 4)): set heading(numbering: none)

#title-slide()
```

**CRITICAL: `qr: none` MUST be included in config-info. The secreg theme expects this field.**

**Heading hierarchy:**
- `=` — Section (Part separator, e.g., `= Motivation & Background`)
- `==` — Subsection (topic group, e.g., `== The Rise of Proxy Advisors`)
- `===` — Slide title as a **takeaway sentence** (inside `#slide[]`, e.g., `=== Proxy advisors emerged to fill this gap.`). If the subtitle states the takeaway, do NOT add a conclusion bullet restating the same point — the subtitle already carries it. Body bullets should add new information (evidence, examples, applications).

**Slide structure:**
```typ
== Subsection Title

#slide[
  === Slide title as a complete sentence ending with a period.

  - First bullet point with *bold* for emphasis

  - Second bullet point with _italic_ for key terms

  - Third bullet point

  #callout[
    Key takeaway or important quote.
  ]
]
```

**Available Typst features:**
- `#slide[]` — standard slide
- `#pause` — reveal animation
- `#callout[]` — highlighted callout box
- `#set text(20pt)` or `#set text(size: 0.85em)` — font size control within a slide
- `#table()` — for data display (use INSTEAD of cetz-plot), minimum `inset: 10pt`
- `#super[]` — superscript for author markers
- `#h(1em)` — horizontal space
- `cetz.canvas` — from theme's bundled cetz import (NOT cetz-plot). Minimum `length: 2em`. Requires `// Storytelling:` comment within 3 lines before diagram code.
- `#align(center)[#image(...)]` — center-align ALL images

**Skipping conventions to "finish faster" is anti-helpful — it ships slides with formatting errors that the presenter has to fix at their desk instead of rehearsing. Every convention violation you leave behind is rework you're creating for the user.**

### Delete & Restart Rule

If you wrote slides.typ or notes.typ WITHOUT having read the paper (Phase 1), DELETE them and start over from Phase 1. Content written without source material is hallucinated content — it cannot be patched, only rewritten.

### Deviation Rules (Phase 3)

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Typst compilation error, syntax error, broken import | Fix → recompile → verify | Auto |
| **R2: Missing Critical** | Missing template file, missing asset, broken theme reference | Add/fix → recompile → verify → track `[R2]` | Auto |
| **R3: Blocking** | Typst version incompatibility, font not found, package conflict | Fix blocker → verify proceeds → track `[R3]` | Auto |
| **R4: Structural** | Outline restructuring, section reordering, changing presentation proportions | STOP → present to user → track `[R4]` | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure = R4

After completing Phase 3, report: **Total deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **Impact:** [assessment].

### Rationalization Table — Typst Conventions

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Blank lines between bullets waste space" | This is the project's strict convention | Add blank lines. Adjust font size if needed. |
| "cetz-plot would look better for this chart" | cetz-plot conflicts with secreg's cetz 0.3.2 | Use #table() for data visualization |
| "I'll use ## for slide titles" | Typst uses = not # for headings | Use === for slide titles |
| "I don't need qr: none" | The theme expects it; compilation may fail | Always include qr: none |

### Red Flags — STOP If You Catch Yourself:

- **Writing bullets without blank lines between them** → STOP. Add blank lines.
- **Using `#import "@preview/cetz-plot"` or any cetz-plot** → STOP. Use tables instead.
- **Using `##` or `###` for headings** → STOP. Typst uses `=`, `==`, `===`.
- **Omitting `qr: none` from config-info** → STOP. Add it.
- **Writing slide titles that aren't complete sentences** → STOP. Make them sentences.
- **Writing `cetz.canvas(length: 1cm, ...)` or similar small lengths** → STOP. Use `2em` minimum.
- **Writing `cetz.canvas` without `// Storytelling:` comment** → STOP. Add it.
- **Writing `)'s` or `]'s`** → STOP. Use `\u{2019}s` for smart apostrophe.
- **Writing `$100` without escaping** → STOP. Use `\$100`.
- **Adding `#image()` without `#align(center)`** → STOP. Center it.
- **Adding `#callout[]` to a slide with 3+ `#pause`** → STOP. Split the slide.
- **Typing a calculated number** (percentage, ratio, dollar amount) → STOP. Write a `calc` expression.

### Notes File Conventions (notes.typ)

**File header:**
```typ
// Speaker Notes: [Paper Title]
// [Authors]
// Presentation at [Venue], [Date]

#set page(
  number-align: center,
  numbering: "1 of 1",
  margin: (x: 1in, y: 1in),
  header: text(size: 10pt, fill: gray)[_Paper Title --- Speaker Notes_],
)
#set text(size: 12pt)
#set heading(numbering: "I.A.1.")
#show heading.where(level: 1): set text(size: 16pt)
#show heading.where(level: 2): set text(size: 14pt)
#show heading.where(level: 3): set text(size: 12pt)
```

**Notes style:** Flowing prose with conversational tone — as if talking to the audience. NOT slide bullet recaps. Each section starts with a timing target:
```typ
= Section Title
#text(size: 10pt, fill: gray)[_Target: ~15 minutes. Brief description of section goal._]

== Subsection

- Opening remark that sets context for this subsection. Explain the key idea in plain language, as if speaking to a faculty audience.

- Transition to the next point. Connect it to what was just said. Use specific numbers and citations from the paper.
```

**Notes bullet spacing:** Same convention — blank lines between all bullet items.

### Steps

1. **Read SOURCES.md** for metadata, **OUTLINE.md** for structure
2. **Read the paper** section by section using look-at, extracting key content for each slide
3. **Write slides.typ** following all conventions above
4. **Write notes.typ** following notes conventions
5. **Cross-check:** Every slide in slides.typ should have corresponding coverage in notes.typ

### Gate: Files Generated

- [ ] slides.typ written with correct Touying syntax
- [ ] notes.typ written with flowing prose
- [ ] Blank lines between ALL bullet items (top-level AND sub-bullets) in both files
- [ ] Sub-bullets use two-space indent + `- ` (not `--`)
- [ ] `qr: none` present in config-info
- [ ] No cetz-plot imports
- [ ] Heading hierarchy: =/==/===
- [ ] No subtitle-body echo (=== subtitle not repeated as first body line OR conclusion bullet)
- [ ] Tables have `inset: 10pt` minimum
- [ ] Images wrapped in `#align(center)`
- [ ] No hardcoded calculations (use `calc` module)
- [ ] No `#callout[]` + 3+ `#pause` on same slide

If convention violations persist after 3 fix-and-recheck cycles, escalate to user.

### Artifact Review Gate: Slides & Notes (dynamic workflow)

**Before proceeding to Phase 4, the slides and notes are reviewed by the `workshop-verify` dynamic workflow — a per-slide fan-out (one read-only reviewer per slide × {convention, notes-coverage, source-fidelity}) plus a global mechanical leg (compile + `check-all.py` + widow + overflow) and per-diagram visual-verify, with the CLEAN/ISSUES gate computed in pure JS from raw counts.** This replaces the former single monolithic reviewer: per-slide isolation keeps each slide's paper-reading in its own subagent transcript (the deck-review would otherwise blow the main conversation's context on a long deck), and the JS gate removes honor-system score inflation. It satisfies the Iron Law of Flat Dispatch — reviewer results land in script variables, never a middle dispatcher agent.

1. **Compile first** so `slides.pdf` exists (the workflow's widow/visual legs need it):
   ```bash
   cd [presentation directory] && typst compile slides.typ && typst compile notes.typ
   ```

2. **Invoke the workflow** (read-only; never drafts, never fixes):
   ```
   Workflow(name="workshop-verify", args={
     "projectDir": "[absolute project root]",
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../.."
   })
   ```
   It returns `{ overallPass, verdict, scoreTable, findings, reviews, slidesThatFlagged, inventoryCoverage }`.

3. **Read the gate.** If `overallPass` is true → write the gate artifact and proceed. If false → drive convergence with the native `/goal` primitive, pinned to the workflow's gate:

   ```
   /goal workshop-verify returns overallPass=true. Stop after 3 turns.
   ```

   Each turn under the active goal: dispatch a fresh subagent to FIX the `findings` (the skill — not a reviewer — owns fixing), recompile, then re-invoke `workshop-verify` **selectively** carrying state forward:
   ```
   Workflow(name="workshop-verify", args={
     "projectDir": "[abs]", "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "onlyChecks": [<slidesThatFlagged from the prior run>],
     "priorReviews": [<reviews from the prior run>]
   })
   ```
   End the turn so the `/goal` evaluator re-checks the gate. If the 3-turn budget elapses without `overallPass`, escalate to the user with the outstanding `findings`.

**The workflow's reviewers are read-only by construction** (each prompt opens "You are a READ-ONLY reviewer; do NOT create, edit, or overwrite any files"). The skill owns fixing; the workflow owns review + the computed gate. This is the non-negotiable hybrid split.

### Post-Subagent Enforcement

After `workshop-verify` returns, main chat follows these boundaries:

| Verification (main chat CAN do) | Investigation (main chat CANNOT do) |
|----------------------------------|--------------------------------------|
| Read the workflow's `findings` / `scoreTable` | Re-read slides.typ/notes.typ to "double-check" the gate |
| Re-invoke the workflow (selectively) | Override the JS gate ("the workflow was too strict") |
| Check the gate artifact exists | Edit slides.typ/notes.typ directly |
| Dispatch a fix subagent for reported `findings` | "Quick fix" an issue the workflow did not report |

**The JS gate (`overallPass`) is authoritative.** If you disagree, fix a finding and let the next workflow run recompute — never hand-wave the gate to true.

- If `overallPass` is false → fix `findings` via subagent → re-invoke workflow (max 3 turns under `/goal`)
- If `overallPass` is true → write the gate artifact and proceed to Phase 4

**Structural gate artifact:** After the workflow returns `overallPass=true`, write `.planning/SLIDES_REVIEWED.md`:
```yaml
---
status: APPROVED
phase: generate
reviewed_at: [timestamp]
reviewer: workshop-verify dynamic workflow (per-slide fan-out + JS gate)
implements: "Phase 3 — slide and notes generation with per-slide dynamic-workflow review"
requires: "OUTLINE_APPROVED.md, SOURCES_VERIFIED.md"
provides: "slides.typ, notes.typ (reviewed, overallPass=true)"
affects: "presentation/slides.typ, presentation/notes.typ"
workflow_turns: [N]
slides_count: [N]
notes_sections: [N]
gate: {overallPass: true, critical: 0, major: 0, minor: 0}
inventory_coverage: {claimsChecked: [N], claimsGrounded: [N]}
deviations: {r1: [X], r2: [Y], r3: [Z], r4: [W]}
---
Slides and notes reviewed by the workshop-verify dynamic workflow — overallPass=true. [Score-table summary].
```

**Phase 4 will refuse to start without this file.**

**IMMEDIATELY proceed to Phase 4 after review gate passes.**

---

## Phase 4: Verify & Finalize

**Responsibility:** Run the final end-to-end `workshop-verify` gate, map inventory coverage, cross-check metadata, and present.

The heavy verification — compile, `check-all.py`, widow, overflow, per-slide convention/notes/fidelity, per-diagram visual-verify — is executed by the **`workshop-verify` dynamic workflow** (introduced in Phase 3's review gate). Phase 4 runs it ONE final time as a full, non-selective end-to-end gate, then records coverage and presents. This is not redundant: Phase 3's last run may have been selective (`onlyChecks`); the final full run confirms the whole deck is clean together.

### Prerequisites
- [ ] `.planning/SLIDES_REVIEWED.md` exists with `status: APPROVED`
- [ ] `slides.typ` exists in presentation directory
- [ ] `notes.typ` exists in presentation directory

**If `.planning/SLIDES_REVIEWED.md` is missing, STOP. Return to Phase 3 and complete the artifact review gate.**

### Steps

1. **Final full verification gate** — re-invoke the workflow over the whole deck (no `onlyChecks`):
   ```
   Workflow(name="workshop-verify", args={
     "projectDir": "[absolute project root]",
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../.."
   })
   ```
   - If `overallPass` is false → drive the `/goal workshop-verify returns overallPass=true. Stop after 3 turns.` loop (fix `findings` via subagent → recompile → re-invoke). The JS gate is authoritative.
   - If `overallPass` is true → proceed. The returned `scoreTable` is the verification record (compile / constraints / widows / overflow / fidelity / notes-coverage / visual, all with their Gate column).

2. **Verify metadata** (the one check outside the workflow):
   - Title in slides.typ matches SOURCES.md
   - Authors and affiliations in slides.typ match SOURCES.md

3. **Write the inventory-coverage map** (`.planning/VALIDATION.md`) — render it **directly from the workflow's returned `coverageMap`** (each entry is `{slide, title, inventoryRefs, ungroundedClaims, status}`, already classified COVERED/PARTIAL in JS — no hand-inference). Requirement traceability:
   ```markdown
   ---
   phase: verify
   status: validated
   claims_checked: [from inventoryCoverage.claimsChecked]
   claims_grounded: [from inventoryCoverage.claimsGrounded]
   ---
   ## Inventory Coverage (every slide → F/T/R/A IDs)

   | Slide | Title | Inventory IDs cited | Status |
   |-------|-------|---------------------|--------|
   | S1 | [title] | F1, R2 | COVERED |
   | S2 | [title] | (none) | PARTIAL — no inventory ref |
   | ... | ... | ... | ... |

   ## Inventory items NOT yet on any slide
   - [F3, T2, ...] — list inventory IDs from SOURCES.md that no slide references (MISSING), or "none — full coverage"
   ```
   Classify each slide COVERED (cites ≥1 inventory ID, all claims grounded), PARTIAL (no inventory ref OR some claims ungrounded), or — for the reverse map — MISSING (an inventory item no slide uses). This closes requirement→evidence traceability: SOURCES inventory IDs → slides → grounded claims.

**Skipping the final gate to "finish faster" is anti-helpful — the presenter discovers widows, overflow, or wrong numbers at the podium. The workflow already does the work; reading its gate is the service, not overhead.**

### Red Flags — STOP If You Catch Yourself:

- **Skipping widow detection after compile** → STOP. PDF is ground truth, not compilation.
- **Skipping overflow detection** → STOP. Overflow means content spills off-slide.
- **Declaring "verified" without running check-all.py** → STOP. Run the constraint checks.
- **Reporting "all clean" without checking source fidelity** → STOP. Every claim must trace to the paper.
- **Skipping visual-verify on diagrams** → STOP. Compilation proves syntax, not readability.

### Gate: Verified (final)

**These checks are computed by the `workshop-verify` workflow's JS gate — `overallPass=true` means every row below passed. The checklist is the gate spec; the workflow is its enforcement.**

- [ ] slides.typ compiles without errors
- [ ] notes.typ compiles without errors
- [ ] PDF widow detection passes (0 widows)
- [ ] Overflow detection passes (no slides spill to next page)
- [ ] All diagrams pass visual-verify (score >= 9.5)
- [ ] Source fidelity verified (all claims traceable to paper)
- [ ] Title/authors match source paper
- [ ] `qr: none` present in config-info
- [ ] No cetz-plot imports
- [ ] No bullet spacing violations (top-level or sub-bullet)
- [ ] No fake sub-bullets (`--` as marker)
- [ ] No subtitle-body echoes (first line or conclusion bullet)
- [ ] No uncentered images
- [ ] Table insets >= 10pt
- [ ] No smart apostrophe issues (`)'s` / `]'s`)
- [ ] No hardcoded calculations (use `calc` module)
- [ ] CeTZ canvas has `length: 2em` minimum + `// Storytelling:` comment (if used)
- [ ] Dollar signs escaped (`\$`)
- [ ] Notes are teleprompter-style prose (1-2 sentences per bullet, no fragments)
- [ ] Notes sections match slide sections
- [ ] Section transitions present (verbal bridges between topics)
- [ ] Label-bullet spacing correct (blank line after `*Label:*` before bullets)
- [ ] Verbatim quotes preserved from source (no paraphrasing)

**Present results to user:**
```
Workshop presentation complete:
- slides.typ: [N] slides across [M] sections
- notes.typ: speaker notes with timing targets
- workshop-verify gate: overallPass ✓ ([critical]/[major]/[minor])
- Inventory coverage: [claimsGrounded]/[claimsChecked] claims grounded; [N] slides COVERED

[paste the workflow's scoreTable here]

Files: [presentation directory]/slides.typ, notes.typ
PDFs: [presentation directory]/slides.pdf, notes.pdf
```

### Review-pattern logging (observe → record → offer)

This is a `decision`-class hand-off: the user reviews the rendered deck and decides what to change. **Do not pre-build visualizations.** Instead:

1. **Observe** what the user actually inspects at this checkpoint — do they open `slides.pdf` and eyeball layout? ask for a specific slide rendered? request a coverage table? compare against the paper?
2. **Record** it in `.planning/LEARNINGS.md`:
   ```markdown
   ## Review pattern — [date]
   - User reviewed by: [e.g. "opened slides.pdf, flagged slide 7 overflow by eye"]
   - Artifact they asked for: [e.g. "rendered PNG of the results slide" / "none — read summary"]
   ```
3. **Offer** to automate only after the **same** review request recurs 3+ times across sessions (e.g. "you've asked for a per-slide PNG contact sheet three times — want me to bundle a script that generates it?"). The rendered `slides.pdf` is already the natural visual artifact for "does it look right"; add tooling only when the user's behavior proves the need.

---

## Next Phase / Revisions

After the user reviews, they can use `/workshop-revise` to make targeted changes to the slides or notes.

Discover and read the workshop-revise skill:
Read `${CLAUDE_SKILL_DIR}/../workshop-revise/SKILL.md` for midpoint re-entry.
