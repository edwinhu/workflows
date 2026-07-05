---
name: workshop
description: "This skill should be used when the user asks to 'create a workshop presentation', 'prepare a workshop talk', 'make slides for a workshop', 'presentation for faculty workshop', 'workshop slides from paper', or needs to create academic workshop presentation slides and speaker notes from a research paper."
hooks:
  PreToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/image-read-guard.py"
    - matcher: "Edit|Write|Workflow"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/SOURCES_VERIFIED.md
            GATE_STATUS=VERIFIED
            GATE_DESCRIPTION="Phase 1 sources gate"
            GATE_REMEDY="Return to Phase 1 and complete source gathering before writing any files"
            GATE_BLOCKED_TOOLS=Write,Edit
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
        - type: command
          # workshop-phase-gate-guard.py is bespoke (not built on the GATE_BLOCKED_TOOLS env-var
          # pattern) — it hardcodes its own tool-name check to Write|Edit|Workflow so it can gate BOTH
          # direct writes to slides.typ/notes.typ AND the Workflow(name="workshop-generate", ...)
          # dispatch that actually produces them (a Workflow call carries no file_path, so the
          # Edit|Write-only check alone never saw it — the OUTLINE_APPROVED gate could be bypassed by
          # generation starting via Workflow before any Edit/Write landed).
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-phase-gate-guard.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-outline-executable-guard.py"
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

**This diagram IS the authoritative spec for phase order and gating. If any prose below conflicts with it, the diagram wins.** Every gate is mandatory. Skipping a gate means the next phase operates on bad inputs.

### Iteration topology (per phase)

| Phase | Topology | Exit condition |
|-------|----------|----------------|
| Phase 1 (gather) | `one-shot` (sequential extraction + 1 read-only review subagent) | SOURCES.md reviewer returns APPROVED → SOURCES_VERIFIED.md written |
| Phase 2 (structure) | `one-shot` + decision gate (1 review subagent, then user approval) | OUTLINE reviewer APPROVED **and** user approves → OUTLINE_APPROVED.md written |
| Phase 3 (generate) | `serial` drafting → `parallel` review (workshop-verify fan-out under `/goal`, **max 3 turns**) | `overallPass=true` → SLIDES_REVIEWED.md written; else escalate after 3 turns |
| Phase 4 (verify) | `parallel` review (full workshop-verify under `/goal`, **max 3 turns**) | `overallPass=true` → VALIDATION.md written; else escalate after 3 turns |

`team` topology is not used — no phase needs concurrent role-specialized agents sharing state.

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

## Rejected Approaches
[Approaches tried and discarded, with reasons — so the resume does not relitigate dead ends]

## Blockers
[Any unresolved blocker the next session must address before proceeding, or "none"]

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

**`.planning/ACTIVE_WORKFLOW.md` is the live state file** — update its `phase`/`phase_name` at every gate transition (Phase 1→2→3→4), not just at startup. A stale `phase: 1` after Phase 3 means a resuming session restarts from the wrong place. The per-phase gate artifacts (SOURCES_VERIFIED / OUTLINE_APPROVED / SLIDES_REVIEWED / VALIDATION) are the immutable completion records; ACTIVE_WORKFLOW.md is the moving cursor.

---

## Phase 1: Gather Sources

**Responsibility:** Collect ALL source materials and extract paper metadata.

<EXTREMELY-IMPORTANT>
## The Iron Law of Title Extraction

**NEVER hallucinate, infer, or guess the paper title, subtitle, authors, or affiliations. ALWAYS extract from the source document using look-at or Read.** This is not negotiable.

Inferring metadata from filenames is fabrication. The user got burned by hallucinated titles. Every title, every author name, every affiliation MUST come from reading the actual paper.

**Skipping extraction to "help faster" is anti-helpful — it ships wrong metadata that the user has to debug and fix. That's rework you created, not time you saved.**
</EXTREMELY-IMPORTANT>

### Title Extraction Facts

- Co-author lists change between drafts of the same paper — author names inferred from context or memory may match an older draft, so they must come from the title page of the PDF actually on disk.
- A title supplied by the user is often a paraphrase or shorthand — extract from the paper and confirm even when the user has stated the title. Putting an unverified title on the deck asserts a check that was never performed.
- A wrong title or author propagates into both slides.typ and notes.typ; deferring the fix doubles it.

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

9. **Independent SOURCES.md review (read-only subagent).** SOURCES.md is the authoritative evidence artifact for the whole presentation — do not self-certify it. Dispatch ONE fresh read-only subagent (Read/Grep/look-at only) to check it against the paper:
   ```
   Task(subagent_type="Explore", prompt="READ-ONLY review. Do NOT edit any file.
     Compare .planning/SOURCES.md against the source paper at [paper path].
     Verify: (1) title/subtitle/authors/affiliations match the paper's title page
     exactly (flag any that look inferred from the filename); (2) every figure,
     table, and key numeric result in the paper is enumerated with an F/T/R/A ID;
     (3) no inventory item cites a figure/table/number absent from the paper.
     Return: VERDICT (APPROVED | ISSUES), then a bullet list of any mismatches or
     missing inventory items with paper page refs.")
   ```
   If the reviewer returns ISSUES → fix SOURCES.md → re-dispatch. Only write the gate artifact once it returns APPROVED. **Bound the loop:** stop after 3 fix-and-re-dispatch turns; if it still returns ISSUES, escalate to the user with the outstanding gaps rather than looping indefinitely. **Main chat owns fixing; the subagent only reviews** (verification ≠ investigation — do not re-extract the whole paper yourself, fix the specific gaps the reviewer names). The `Explore` subagent type is **structurally read-only** (its tool set excludes Edit/Write/NotebookEdit), so read-only here is enforced by construction, not just by the prompt.

### Gate: Sources Gathered

- [ ] Paper metadata extracted via look-at (NOT inferred)
- [ ] Paper inventory completed (figures, tables, key results, arguments)
- [ ] SOURCES.md written with title, authors, affiliations, AND full inventory
- [ ] Independent read-only subagent reviewed SOURCES.md → APPROVED
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
key_files:
  created: [.planning/SOURCES.md, .planning/SOURCES_VERIFIED.md]
  modified: [presentation/templates/]
deviations: {r1: 0, r2: 0, r3: 0}
one_liner: "Sources gathered, inventory built, independently reviewed → APPROVED."
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

4. **Write OUTLINE.md** in `.planning/`. The per-slide **executable content table** is the spec `workshop-generate` consumes — one row per slide, every column filled. Generation fans out one fragment-agent per row; an under-specified row forces the agent to invent content/visuals (the failure mode the spec exists to prevent).
   ```markdown
   ## Presentation Outline

   Total time: [X] minutes

   ## Slide Spec (MANDATORY EXECUTABLE TABLE)

   | Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
   |-------|---------|----------|---------|-----------|--------|-------|
   | 1. Title | Part 1: Motivation `==` The Rise of Proxy Advisors | Proxy advisors emerged to fill a monitoring gap. | ERISA made voting a fiduciary duty; institutions lacked capacity; ISS/Glass Lewis arose | A1, R1 | none | Open with the puzzle: why does a $X industry exist? ~2 min |
   | 2. Mechanism | Part 1: Motivation `==` The Rise of Proxy Advisors | One recommendation moves many votes. | Robo-voting share; concentration | F1, R2 | F1 (influence chart) | Walk the figure left-to-right; the takeaway is the slope ~3 min |

   ### Column rules (every column REQUIRED per row)
   - **Slide** — `N. <short label>`, N a unique integer (assembly order within its Section).
   - **Section** — the Touying `=` Part + `==` subsection this slide sits under (drives assembly grouping). Slides sharing a Section are emitted together in order.
   - **Takeaway** — the `===` takeaway-sentence title (a full sentence, not a topic label).
   - **Bullets** — the body content as `;`-separated points (the agent expands each to a bullet; NOT prose).
   - **Inventory** — ≥1 F/T/R/A ID from SOURCES.md (the coverage invariant; the fragment-agent may cite ONLY these).
   - **Visual** — the figure/diagram to render (`F1`, `a fletcher pipeline of X→Y→Z`, or `none`). The agent builds no visual not named here.
   - **Notes** — the speaker-notes talking points + a `~N min` timing target.
   ```

   **This table IS the canonical, born-canonical form** (doctrine #6). The ONE shared parser
   `scripts/workshop/workshop_slide_table.py` reads it directly (the guard, `workshop-generate`, and
   `workshop-verify`'s side-table all consume *the same* parse — "parses ⇔ passes the guard"). Emit the
   table, not prose: the table pins **Visual + Notes per slide** (7 fields), so generation renders them
   rather than *inventing* them. The parser also tolerates a legacy 4-field prose form
   (`- Slide: "Takeaway." — bullets → [IDs]`) **only** as a back-compat shim for decks built before this
   spec — new decks MUST emit the table so nothing is inferred. (After writing OUTLINE.md, the index is
   compiled by Phase 3 step 0; a row missing a takeaway or an F/T/R/A id is a `violations` STOP.)

5. **Independent OUTLINE.md review (read-only subagent) — before showing the user.** Don't make the user catch structural gaps. Dispatch ONE fresh read-only subagent (Read/Grep only) to check OUTLINE.md against its spec:
   ```
   Task(subagent_type="Explore", prompt="READ-ONLY review. Do NOT edit any file.
     Check .planning/OUTLINE.md for: (1) every slide line cites at least one F/T/R/A
     inventory ID; (2) per-part minute allocations sum to the stated total time;
     (3) every slide names a content source; (4) the part structure reflects the
     user's requested proportions (stated in OUTLINE.md). Cross-check inventory IDs
     exist in .planning/SOURCES.md. Return: VERDICT (APPROVED | ISSUES) then a bullet
     list of any slide missing an ID, any timing mismatch, or any unknown ID.")
   ```
   If ISSUES → fix OUTLINE.md → re-dispatch. **Bound the loop:** stop after 3 fix-and-re-dispatch turns; if still ISSUES, present the outstanding gaps to the user alongside the outline rather than looping indefinitely. Then proceed to user approval. This is a completeness check, not a content judgment — the user still owns the creative call on structure. The `Explore` subagent type is **structurally read-only** (no Edit/Write/NotebookEdit in its tool set) — read-only by construction, not just by prompt.

6. **Present outline to user for approval.**

**Producing an outline from memory instead of the paper's structure means the presentation won't match the paper. The user discovers misaligned sections during Phase 3, requiring rework of both the outline AND the slides. Getting the structure right here saves hours downstream.**

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
key_files:
  created: [.planning/OUTLINE.md, .planning/OUTLINE_APPROVED.md]
  modified: []
deviations: {r1: 0, r2: 0, r3: 0, r4: 0}
one_liner: "Outline reviewed (subagent APPROVED) and user-approved → ready for generation."
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

### Generation Facts

- The secreg/university theme requires `qr: none` in `config-info` — omit it and the deck does not compile. A deck that won't render is not a faster deck; the missing field surfaces as a compile failure the presenter debugs at their desk.
- `cetz-plot` is NOT the theme's bundled `cetz` — importing `cetz-plot` breaks the compile. Build diagrams from the theme's `cetz.canvas`; reaching for the familiar package name ships a deck that won't build.
- A fragment-agent that cites an inventory id absent from `SOURCES.md` fabricates evidence: the verify gate's source-fidelity reviewer flags it AND the JS inventory whitelist silently drops it, so the slide ships PARTIAL with an ungrounded claim. Cite ONLY the row's allowed ids — `citedInventory` is grep-grounded from the written fragment, so a memory-reported list that disagrees with the file is caught.
- `notes.typ` is compile-gated, not slides-only — an invented note macro (`#slide-notes`, `#speaker-note`) that compiles this run only by an assembly-agent alias ships malformed notes on a less-defensive run. Notes are plain `=`/`==` headings + prose; inventing a macro to force a compile is rework, not speed.

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

**Blocker escalation:** if an R3 blocker (font/package conflict, version incompatibility) cannot be resolved in **one** auto-fix attempt, STOP and present the user three options: **(1) retry** with a different approach, **(2) skip** the blocked element and note it in the gate artifact, or **(3) stop** and await user action. Do not silently loop on an unresolvable blocker.

After completing Phase 3, report: **Total deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **Impact:** [assessment].

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

Generation is the **`workshop-generate` ultracode workflow** — do NOT hand-write slides.typ in this session. It reads the approved Slide Spec table, groups slides by **Section**, and fans out one agent per section (each writes that subsection's whole run of `#slide[]` blocks + notes to a section fragment file, from the pinned rows, citing only the allowed inventory ids — section is the coherent unit, keeping intra-section flow), then an assembly agent concatenates the section files under their headers into slides.typ + notes.typ and compiles the deck.

```
0. COMPILE THE SLIDE INDEX (the deterministic Discover — replaces the engine's LLM Discover, DESIGN §3):
   uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/workshop/workshop_slide_table.py "<project root>" --json > .planning/slide-index.json
   Read it. If `ok` is true → pass the parsed object as `slideIndex` (below). If it carries `violations`
   (a slide missing inventory, a dangling F/T/R/A id, a malformed row) or `staleApproval` (OUTLINE_APPROVED.md's
   slide/section count disagrees with the live OUTLINE.md — a stale approval after a structure change),
   **STOP and surface them** — these are spec-integrity failures fixed in Phase 2 (re-edit OUTLINE + re-approve),
   NOT papered over. If the script errors entirely, omit `slideIndex` and the workflow falls back to its LLM Discover.
1. Workflow(name="workshop-generate", args={
     "projectDir": "<absolute presentation project root (cwd)>",
     "pluginRoot": "<resolve ${CLAUDE_SKILL_DIR}/../../workflows>",
     "slideIndex": <the parsed .planning/slide-index.json object, or omit to use the LLM Discover>
   })
   → returns { overallPass, sections, compiled, findings, sectionsThatFailed, assembledPaths }.
2. Read the gate:
   - overallPass=true (every section fragment produced + deck compiles) → proceed to the review fan-out below.
   - overallPass=false → fix the cause (a missing fragment / a compile error / an out-of-inventory citation),
     re-invoke with onlyChecks=result.sectionsThatFailed. If a Slide Spec row is itself under-specified,
     that's an R4 — return to Phase 2, fix the row, re-approve (the outline guard re-checks).
3. The Typst conventions above are what the fragment-agents follow; the assembly agent owns the file header
   (theme import + config-info incl qr:none) and the section headings. The deck COMPILING is the workflow's
   mechanical gate — do not hand-edit slides.typ to force a pass; fix the spec/fragment and re-invoke.
```

Then run the per-slide REVIEW fan-out (`workshop-verify` — already the Phase-3 review gate below) under `/goal`, which checks convention/notes-coverage/source-fidelity/visual and writes `SLIDES_REVIEWED.md` on `overallPass`.

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

### Artifact Review Gate: Slides & Notes (ultracode workflow)

**Before proceeding to Phase 4, the slides and notes are reviewed by the `workshop-verify` ultracode workflow — a per-slide fan-out (one read-only reviewer per slide × {convention, notes-coverage, source-fidelity}) plus a global mechanical leg (compile + `check-all.py` + widow + overflow) and per-diagram visual-verify, with the CLEAN/ISSUES gate computed in pure JS from raw counts.** This replaces the former single monolithic reviewer: per-slide isolation keeps each slide's paper-reading in its own subagent transcript (the deck-review would otherwise blow the main conversation's context on a long deck), and the JS gate removes honor-system score inflation. It satisfies the Iron Law of Flat Dispatch — reviewer results land in script variables, never a middle dispatcher agent.

1. **Compile first** so `slides.pdf` exists (the workflow's widow/visual legs need it):
   ```bash
   cd [presentation directory] && typst compile slides.typ && typst compile notes.typ
   ```

2. **Invoke the workflow** (read-only; never drafts, never fixes). Pass `slideIndex` = the parsed
   `.planning/slide-index.json` (reuse Phase 3 step 0's, or recompile with `workshop_slide_table.py`).
   In VERIFY this is the OUTLINE **side-table** only — the workflow still enumerates the built `slides.typ`
   and joins inventory to slides SEMANTICALLY (DESIGN §3a-join); omit it to fall back to the LLM Discover.
   ```
   Workflow(name="workshop-verify", args={
     "projectDir": "[absolute project root]",
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "slideIndex": <parsed .planning/slide-index.json, or omit for the LLM Discover fallback>
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
     "slideIndex": <parsed .planning/slide-index.json, or omit>,
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

#### Topic-Change Protocol (mid-`/goal` loop)

If the user interjects with an off-topic request while the `/goal workshop-verify` loop is active (Phase 3 review gate or Phase 4 final gate):

1. **Announce the pause:** "Pausing the workshop-verify loop (turn N) to handle your request."
2. **Handle** the request.
3. **Announce the resume:** "Resuming the workshop-verify loop from turn N" and re-fire the `/goal`.

Never silently abandon the loop. An off-topic message is not permission to stop verifying — the gate still has to reach `overallPass=true`.

**Structural gate artifact:** After the workflow returns `overallPass=true`, write `.planning/SLIDES_REVIEWED.md`:
```yaml
---
status: APPROVED
phase: generate
reviewed_at: [timestamp]
reviewer: workshop-verify ultracode workflow (per-slide fan-out + JS gate)
implements: "Phase 3 — slide and notes generation with per-slide ultracode-workflow review"
requires: "OUTLINE_APPROVED.md, SOURCES_VERIFIED.md"
provides: "slides.typ, notes.typ (reviewed, overallPass=true)"
affects: "presentation/slides.typ, presentation/notes.typ"
workflow_turns: [N]
slides_count: [N]
notes_sections: [N]
gate: {overallPass: true, substratePass: true, critical: 0, major: 0, minor: [N advisory]}
inventory_coverage: {claimsChecked: [N], claimsGrounded: [N]}
deviations: {r1: [X], r2: [Y], r3: [Z], r4: [W]}
---
Slides and notes reviewed by the workshop-verify ultracode workflow — overallPass=true (substrate clean: 0 critical, 0 major; any remaining minors are advisory convention/style notes, non-blocking). [Score-table summary].
```

**Gate semantics (substrate split):** `overallPass` is `substratePass` — true when **0 critical AND 0 major** (compile, constraints, widows, overflow, source-fidelity, notes-coverage, visual defects are all deterministic or categorical gates). Per-slide **minor** convention/style findings are **advisory** — they do NOT block the gate. Record them in the artifact and surface them to the user as optional polish, but do NOT spin the `/goal` loop trying to drive minors to zero (that is the over-enforcement treadmill). The loop CONTINUES only while a critical or major remains.

**Phase 4 will refuse to start without this file.**

**IMMEDIATELY proceed to Phase 4 after review gate passes.**

---

## Phase 4: Verify & Finalize

**Responsibility:** Run the final end-to-end `workshop-verify` gate, map inventory coverage, cross-check metadata, and present.

The heavy verification — compile, `check-all.py`, widow, overflow, per-slide convention/notes/fidelity, per-diagram visual-verify — is executed by the **`workshop-verify` ultracode workflow** (introduced in Phase 3's review gate). Phase 4 runs it ONE final time as a full, non-selective end-to-end gate, then records coverage and presents. This is not redundant: Phase 3's last run may have been selective (`onlyChecks`); the final full run confirms the whole deck is clean together.

### Prerequisites
- [ ] `.planning/SLIDES_REVIEWED.md` exists with `status: APPROVED`
- [ ] `slides.typ` exists in presentation directory
- [ ] `notes.typ` exists in presentation directory

**If `.planning/SLIDES_REVIEWED.md` is missing, STOP. Return to Phase 3 and complete the artifact review gate.** This gate is hook-enforced: `workshop-phase-gate-guard.py` denies writing `.planning/VALIDATION.md` (the Phase 4 deliverable) until `SLIDES_REVIEWED.md` has `status: APPROVED`. Instructional text alone is not the enforcement — the hook is.

<EXTREMELY-IMPORTANT>
## The Iron Law of Final Verification

**`overallPass=false` MEANS THE DECK IS NOT VERIFIED. THE JS GATE IS NOT NEGOTIABLE.**

Do not declare the presentation ready, do not present to the user, do not skip the loop, and do not "interpret" a near-pass as a pass. The `workshop-verify` workflow's gate is authoritative — not your read of the `scoreTable`, not the compiler's exit code, not the presenter's time pressure. Rubber-stamping a failing gate is the canonical verification failure: it ships widows, overflow, and ungrounded numbers to the podium, where the cost of the bug is highest. Verification you hand-wave is anti-helpful — it manufactures the exact rework you were supposed to prevent.
</EXTREMELY-IMPORTANT>

### Steps

1. **Final full verification gate** — re-invoke the workflow over the whole deck (no `onlyChecks`). Pass
   `slideIndex` = the parsed `.planning/slide-index.json` (recompile with `workshop_slide_table.py` if the
   OUTLINE changed); omit to fall back to the LLM Discover:
   ```
   Workflow(name="workshop-verify", args={
     "projectDir": "[absolute project root]",
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "slideIndex": <parsed .planning/slide-index.json, or omit>
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
   implements: "Phase 4 — final verification, inventory coverage, metadata cross-check"
   requires: "SLIDES_REVIEWED.md, slides.typ, notes.typ"
   provides: "VALIDATION.md with inventory coverage map (slide → F/T/R/A)"
   affects: "presentation/slides.pdf, presentation/notes.pdf"
   claims_checked: [from inventoryCoverage.claimsChecked]
   claims_grounded: [from inventoryCoverage.claimsGrounded]
   key_files:
     created: [.planning/VALIDATION.md]
     modified: []
   deviations: {r1: 0, r2: 0, r3: 0, r4: 0}
   one_liner: "Deck verified end-to-end (workshop-verify overallPass), inventory coverage mapped, metadata cross-checked."
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

### Deviation Rules (Phase 4)

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Compilation error surfaces in the final full run | Fix → recompile → re-invoke gate | Auto |
| **R2: Missing Critical** | Widow/overflow found by the final gate that Phase 3's selective run missed | Fix → recompile → re-invoke gate → track `[R2]` | Auto |
| **R3: Blocking** | A `workshop-verify` finding cannot be auto-resolved after the 3-turn `/goal` budget | STOP → present the user retry/skip/stop options → track `[R3]` | Ask user |
| **R4: Structural** | User requests a section reorder or proportion change during verify | STOP → re-enter Phase 3 (re-runs the review gate) → track `[R4]` | Ask user |

**Priority:** R4 (STOP) > R1-R2 (auto) > R3 (escalate after budget). After Phase 4, report deviations alongside the gate result.

### Final Verification Facts

- Existing diagrams shift when surrounding slides change — a run with "no new diagrams" still needs visual-verify on ALL diagrams, which the full non-selective gate runs automatically. Skipping it on that excuse ships a clipped label the presenter discovers at the podium.

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
