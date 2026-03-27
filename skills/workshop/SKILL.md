---
name: workshop
description: "This skill should be used when the user asks to 'create a workshop presentation', 'prepare a workshop talk', 'make slides for a workshop', 'presentation for faculty workshop', 'workshop slides from paper', or needs to create academic workshop presentation slides and speaker notes from a research paper."
---

**Announce:** "I'm using workshop to create academic presentation slides and speaker notes."

## Shared Typst Constraints

Load ALL Typst conventions before any slide or notes work:

Read `${CLAUDE_SKILL_DIR}/../../references/typst-workshop-constraints.md` — these are the conventions from course-materials that apply to workshop presentations. **You MUST read this file before proceeding to Phase 3. No claiming you "remember" it.**

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

## Workflow Initialization

Create `.planning/ACTIVE_WORKFLOW.md`:
```yaml
---
workflow: workshop
phase: 1
phase_name: gather
started: [current timestamp]
project_root: [current directory]
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
   python3 "${CLAUDE_SKILL_DIR}/../look-at/scripts/look_at.py" \
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
   mkdir -p presentation
   cd presentation

   # Create symlinks to secreg theme
   ln -sf ~/areas/secreg/templates templates
   ln -sf ~/areas/secreg/assets assets
   ```

7. **Write SOURCES.md** in `.planning/`:
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

   ## Related Teaching Materials
   - [list of found materials with paths]

   ## Predecessor Slides
   - [list or "none found"]

   ## Obsidian Notes
   - [list or "none found"]
   ```

### Gate: Sources Gathered

- [ ] Paper metadata extracted via look-at (NOT inferred)
- [ ] SOURCES.md written with title, authors, affiliations
- [ ] Theme symlinks created (templates/, assets/)
- [ ] Related materials searched (~/areas/, notes, gdrive)

**IMMEDIATELY proceed to Phase 2.**

---

## Phase 2: Structure Outline

**Responsibility:** Create section-level outline with content allocation based on user's desired structure.

### Steps

1. **Ask the user for desired structure** (if not already specified):
   - Example: "1/3 motivation, 1/3 framework, 1/3 policy"
   - Example: "Half background, half contribution"
   - Ask about total presentation time (default: 45 minutes)

2. **Read the paper's structure** — use look-at to get the table of contents / section headings:
   ```bash
   python3 "${CLAUDE_SKILL_DIR}/../look-at/scripts/look_at.py" \
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
   - Slide: [slide title] — [content source: paper §X / teaching material / predecessor]
   - Slide: [slide title] — [content source]

   ### Part 2: [Section Name] (~[Y] minutes, [N] slides)
   ...
   ```

5. **Present outline to user for approval.**

### Gate: Outline Approved (decision checkpoint)

- [ ] OUTLINE.md written with section proportions and timing
- [ ] User has approved the outline
- [ ] Content sources identified for each slide

**IMMEDIATELY proceed to Phase 3 after user approval.**

---

## Phase 3: Generate Slides & Notes

**Responsibility:** Write slides.typ and notes.typ following ALL Typst conventions.

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
    logo: image("assets/LawP_horizontal_short_4c_RGB.png"),
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
- `===` — Slide title (inside `#slide[]`, e.g., `=== Proxy advisors emerged to fill this gap.`)

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
- [ ] No subtitle-body echo (=== title not repeated as first body line)
- [ ] Tables have `inset: 10pt` minimum
- [ ] Images wrapped in `#align(center)`
- [ ] No hardcoded calculations (use `calc` module)
- [ ] No `#callout[]` + 3+ `#pause` on same slide

If convention violations persist after 3 fix-and-recheck cycles, escalate to user.

### Artifact Review Gate: Slides & Notes

**Before proceeding to Phase 4, dispatch an independent reviewer subagent:**

```
Agent(prompt="""
You are an independent reviewer. Check these files against the Typst workshop constraints.

Read the constraints:
${CLAUDE_SKILL_DIR}/../../references/typst-workshop-constraints.md

Then review:
1. [presentation dir]/slides.typ
2. [presentation dir]/notes.typ

Check ALL 10 constraint categories. Report violations:
| # | Severity | Constraint | Location | Issue |

Also check:
- Every slide in slides.typ has corresponding coverage in notes.typ
- Slide titles are complete sentences
- Notes are flowing prose, not bullet recaps

Be thorough. Do NOT soften findings.
""", subagent_type="general-purpose")
```

- If reviewer finds CRITICAL/HIGH issues → fix → re-dispatch reviewer (max 3 iterations)
- If reviewer approves or only LOW issues remain → proceed to Phase 4

**IMMEDIATELY proceed to Phase 4 after review gate passes.**

---

## Phase 4: Verify & Compile

**Responsibility:** Compile both files, run widow detection, and verify correctness.

### Steps

1. **Compile slides:**
   ```bash
   cd [presentation directory] && typst compile slides.typ
   ```

2. **Compile notes:**
   ```bash
   cd [presentation directory] && typst compile notes.typ
   ```

3. **If compilation fails:** Read the error, fix the issue, recompile (max 3 attempts per file).

4. **Run PDF widow detection** (mandatory after every successful compile):
   ```bash
   DETECT_WIDOWS=$(command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1) && python3 "$DETECT_WIDOWS" slides.pdf
   ```
   - Exit code 1 = widows found → fix using strategies from typst-workshop-constraints.md → recompile → re-run detector
   - Exit code 0 = clean → proceed
   - **This is a binary gate: 0 widows or phase incomplete.**

5. **Verify metadata:**
   - Title in slides.typ matches SOURCES.md
   - Authors in slides.typ match SOURCES.md
   - Affiliations match

6. **Verify conventions:**
   ```bash
   # Check for missing blank lines between bullets (top-level and sub-bullets)
   rg -n '^\s*-.*\n\s*-' slides.typ notes.typ
   # Check for fake sub-bullets (-- used as marker)
   rg -n '^\s+--\s' slides.typ notes.typ
   # Check for cetz-plot imports
   rg 'cetz-plot' slides.typ
   # Verify qr: none present
   rg 'qr: none' slides.typ
   # Check for uncentered images
   rg -n '#image\(' slides.typ | rg -v 'align\(center\)'
   # Check table inset
   rg -n 'inset:' slides.typ
   # Check for smart apostrophe issues
   rg -n "[)\]]'s" slides.typ notes.typ
   # Check for cetz.canvas without Storytelling comment (manual review)
   rg -B3 'cetz.canvas' slides.typ | rg -v 'Storytelling'
   # Check for small cetz canvas length
   rg -n 'length:' slides.typ | rg -v '2em\|2.5em\|3em'
   # Check for unescaped dollar signs (rough heuristic)
   rg -n '[^\\]\$[0-9]' slides.typ notes.typ
   ```

### Gate: Verified (final)

- [ ] slides.typ compiles without errors
- [ ] notes.typ compiles without errors
- [ ] PDF widow detection passes (0 widows)
- [ ] Title/authors match source paper
- [ ] `qr: none` present in config-info
- [ ] No cetz-plot imports
- [ ] No bullet spacing violations (top-level or sub-bullet)
- [ ] No fake sub-bullets (`--` as marker)
- [ ] No subtitle-body echoes
- [ ] No uncentered images
- [ ] Table insets >= 10pt
- [ ] No smart apostrophe issues (`)'s` / `]'s`)
- [ ] No hardcoded calculations (use `calc` module)
- [ ] CeTZ canvas has `length: 2em` minimum + `// Storytelling:` comment (if used)
- [ ] Dollar signs escaped (`\$`)

**Present results to user:**
```
Workshop presentation complete:
- slides.typ: [N] slides across [M] sections
- notes.typ: speaker notes with timing targets
- Both files compile cleanly
- PDF widow detection: 0 widows

Files: [presentation directory]/slides.typ, notes.typ
PDFs: [presentation directory]/slides.pdf, notes.pdf
```

---

## Next Phase / Revisions

After the user reviews, they can use `/workshop-revise` to make targeted changes to the slides or notes.

Discover and read the workshop-revise skill:
Read `${CLAUDE_SKILL_DIR}/../workshop-revise/SKILL.md` for midpoint re-entry.
