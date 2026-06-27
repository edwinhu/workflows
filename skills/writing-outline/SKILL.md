---
name: writing-outline
description: Internal skill for creating detailed section outlines. Called by /writing workflow after PRECIS and master OUTLINE are complete.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/PRECIS_REVIEWED.md
            GATE_STATUS=APPROVED
            GATE_BLOCKED_TOOLS=Write,Edit,Agent
            GATE_DESCRIPTION="Precis review"
            GATE_REMEDY="Return to writing-setup and run the precis reviewer before outlining"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-outline-executable-guard.py"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.py"
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.py"
---

# Writing Outline

Create a detailed outline for a specific section/part before drafting prose. This is Level 3 of the progressive expansion workflow.

## Progressive Expansion Context

```
.planning/PRECIS.md          # Level 1: Thesis, claims, audience
       ↓
.planning/OUTLINE.md         # Level 2: Master structure (sections, goals)
       ↓
outlines/Part I.md         # Level 3: THIS STEP - Detailed section outline
       ↓
drafts/Part I.md           # Level 4: Prose expansion
```

**Never skip to prose drafting without a detailed outline first.**

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-outline`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-outline`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

## Outline Flowchart (This IS the Spec)

```
START (PRECIS + master OUTLINE exist)
  │
  ├─ Step 1: Load context (PRECIS, OUTLINE, ACTIVE_WORKFLOW) + the DOMAIN structure template
  │           (writing-{domain} → section-role structure, before outlining a section)
  │
  ├─ Step 2: Select section (user choice or next unoutlined)
  │
  ├─ Step 3: Gather structure/depth preferences
  │
  ├─ Step 4: Create detailed outline
  │  └─ One topic-sentence BULLET per paragraph; sub-bullets = its evidence/ideas
  │     Opening → Body (subsections with transitions) → Closing
  │
  ├─ Step 5: Cross-reference with PRECIS claims
  │  └─ Verify: advances claim, within scope, thesis thread
  │
  ├─ Step 6: Update ACTIVE_WORKFLOW.md
  │
  └─ More sections remaining?
     ├─ YES → Loop to Step 2 (NO pause, NO "should I continue?")
     └─ NO → GATE: Every OUTLINE section has outlines/ file?
            ├─ NO → Report missing, loop back
            └─ YES → Outline Review Gate
                     └─ Dispatch writing-outline-reviewer subagent
                        ├─ APPROVED → IMMEDIATELY load writing-draft (no pause)
                        └─ ISSUES_FOUND → fix outlines → re-dispatch (max 5)
```

If text and flowchart disagree, the flowchart wins.

<EXTREMELY-IMPORTANT>
## The Iron Law of Outline Before Prose

**NO PROSE WITHOUT OUTLINE. Never skip to prose drafting without a detailed outline in `outlines/` first. This is not negotiable.**

If you find yourself writing prose without a matching outline file:
1. STOP immediately
2. DELETE the prose
3. Create the outline first
4. THEN draft

Thin outlines produce thin drafts. Each outline must be a list of paragraph TOPIC-SENTENCE bullets (each a full claim), with supporting evidence/ideas as sub-bullets.
</EXTREMELY-IMPORTANT>

## Session Resume Detection

Before starting, check for an existing handoff:

1. Check if `.planning/HANDOFF.md` exists
2. **If found:** Read it and present to user:
   - Show the phase, section in progress, and Next Action
   - Ask: "Resume from handoff, or start fresh?"
   - If resume: skip to the recorded section
   - If fresh: proceed normally
3. **If not found:** Proceed normally

## Process

### Step 1: Load Context

```
Read(".planning/ACTIVE_WORKFLOW.md")
Read(".planning/PRECIS.md")
Read(".planning/OUTLINE.md")
```

If master OUTLINE.md is missing, run writing-brainstorm first.

**Also load the domain's structure template (same phase-ordering rule as writing-setup Step 3a).**
The master OUTLINE pins each section's PLACE in the document, but a section's *internal* outline
depends on its ROLE — a "Proof of the Claim" Part is structured differently from a "Background"
Part. That role-structure lives in the domain skill, so read its document-structure section
BEFORE outlining a section (keyed on `style` in ACTIVE_WORKFLOW.md / `## Domain` in PRECIS):

| Domain | Read |
|---|---|
| legal | `${CLAUDE_SKILL_DIR}/../../skills/writing-legal/SKILL.md` → **"Law Review Article Structure"** (what a Background vs Proof vs Conclusion section does) |
| econ | `${CLAUDE_SKILL_DIR}/../../skills/writing-econ/SKILL.md` → its document-structure section |
| general | `${CLAUDE_SKILL_DIR}/../../skills/writing-general/SKILL.md` → its structure guidance |

Outline each section to fit its role in that template (e.g. legal: keep Background from
exceeding the Proof; make a Proof section argument-and-evidence, not just exposition).

### Step 2: Select Section

If not specified by user, present available sections:

```
AskUserQuestion(questions=[
  {
    "question": "Which section should I outline in detail?",
    "header": "Section",
    "options": [
      {"label": "Part I / Introduction", "description": "Hook, thesis, roadmap"},
      {"label": "Part II / Background", "description": "Context and precedents"},
      {"label": "Part III / Argument", "description": "Main claims and evidence"},
      {"label": "Part IV / Counterarguments", "description": "Objections and responses"}
    ],
    "multiSelect": false
  }
])
```

### Step 3: Gather Section Details

For the selected section, ask clarifying questions:

```
AskUserQuestion(questions=[
  {
    "question": "How should this section be structured?",
    "header": "Structure",
    "options": [
      {"label": "Chronological", "description": "Events/developments in time order"},
      {"label": "Thematic", "description": "Grouped by topic or concept"},
      {"label": "Problem-Solution", "description": "Issue then resolution"},
      {"label": "Comparative", "description": "Side-by-side analysis"}
    ],
    "multiSelect": false
  },
  {
    "question": "What level of detail do you want?",
    "header": "Depth",
    "options": [
      {"label": "Paragraph-level", "description": "One bullet per paragraph"},
      {"label": "Sentence-level", "description": "Key sentences mapped out"},
      {"label": "Full skeleton", "description": "Nearly complete argument structure"}
    ],
    "multiSelect": false
  }
])
```

### Step 4: Create Detailed Outline

Create directory if needed and write the detailed outline:

```bash
mkdir -p outlines
```

Write to `outlines/[Section Name].md` (the **filename stem MUST equal** the `### [Section Name]` heading in `.planning/OUTLINE.md ## Structure` — the section index pairs them; a `(Outline)` suffix is tolerated but match the OUTLINE.md heading exactly):

<EXTREMELY-IMPORTANT>
**BORN-CANONICAL + SOURCE-PINNED.** Two things make this outline machine-executable (so the
draft engine consumes it deterministically and the outline-executable guard passes):
1. **`implements: [CLAIM-XX]` frontmatter** carrying the claims the OUTLINE.md `## Claim →
   Section Map` primary-homes to this section (the draft's `implements:` must ⊇ these).
2. **A real source pinned to every substantive claim** — a `[@bibkey]` resolvable in
   `references/sources.bib`, or a specific named authority (case/statute). The assessment's
   writing follow-up is "pin a source per claim"; do it HERE, not at draft time. An unsourced
   point is `[CITE-NEEDED: <what>]`, never an invented cite.
</EXTREMELY-IMPORTANT>

```markdown
---
implements: [CLAIM-XX, CLAIM-YY]   # the claims primary-homed to this section in OUTLINE.md
---
# [Section Name] - Detailed Outline

## Section Goal
[From master OUTLINE.md - what this section accomplishes]

## Claim Supported
[Which claim(s) from PRECIS.md this section advances — same CLAIM-XX as the frontmatter]

## Structure: [Chronological/Thematic/Problem-Solution/Comparative]

---

> **FORMAT — this is the contract with the draft phase, follow it exactly.** Each top-level bullet
> `-` is ONE PARAGRAPH, and the bullet text IS that paragraph's TOPIC SENTENCE: a full claim that
> carries the argument (NOT a label, NOT a topic — "The minimum offer period is the only guaranteed
> window in which an outsider can build a blocking position," not "the accumulation window").
> Sub-bullets are that paragraph's supporting evidence/ideas, each with its `[@bibkey]`/authority
> pinned. **Read the top-level bullets top to bottom — they ARE the argument** (that is the Step-5
> check). The draft expands each top-level bullet into a paragraph led by that sentence, developed
> IN PROPORTION to its weight (a minor bullet may merge into a neighbor; a pivotal one may run
> several paragraphs). One identical paragraph per bullet is the flat-prose failure mode — proportional
> is the goal. Optional `### A. Name` group headers may bracket runs of bullets, but the BULLET is
> the paragraph, never the header.
> **`## Opening` / `## Body` / `## Closing` below are SCAFFOLDING labels — they organize this outline,
> they are NOT document headings. The draft renders Opening as the unheaded lead paragraph(s), Body as
> the lettered `## A./B./C.` subsections, and Closing as a trailing UNHEADED bridge — never a "Closing"
> or "Conclusion" heading. Only the section title and the lettered subsections become real headings.
> EXCEPTION by section ROLE: only PARTS (Part I/II/III) get lettered `## A./B./C.` subsection headings.
> An INTRODUCTION or CONCLUSION renders as CONTINUOUS UNHEADED prose even if its Body is grouped A/B/C
> — there the groupings guide paragraph ORDER only, and the section's sole heading is its title.**

## Opening
- [Topic sentence of the opening paragraph — a full claim that frames the section and picks up the prior section]
  - context the reader needs
  - transition from the previous section (what it established)

## Body
- [Topic sentence — paragraph 1's claim, a full sentence]
  - supporting evidence / idea — [@bibkey or named authority]
  - supporting evidence / idea
- [Topic sentence — paragraph 2's claim]
  - support — [@bibkey]
  - anticipated objection + response (if this paragraph carries one)
- [Topic sentence — paragraph 3's claim]
  - support
- […one top-level bullet PER PARAGRAPH the section needs — the bullets in order are the section's spine]

## Closing
- [Topic sentence of the closing paragraph — the section's payoff]
  - bridge to the next section / thesis thread

---

## Sources Used in This Section
- [@bibkey] — used for [what]

## Open Questions
- [Anything unresolved before drafting]

## Estimated Length
[Paragraph count = number of top-level bullets]
```

### Step 5: Cross-Reference with PRECIS

Verify the detailed outline against PRECIS.md:

- [ ] Advances at least one claim from PRECIS
- [ ] Addresses relevant counterarguments (if applicable)
- [ ] Stays within IN scope
- [ ] Avoids OUT scope items
- [ ] Maintains thesis thread

**Topic-sentence argument check (do this every time):** read the TOP-LEVEL BULLETS in document order,
ignoring all the sub-bullets underneath. Do they form a coherent argument on their own — each a claim
that follows from the last and advances the thesis? If the top-level spine doesn't carry the argument,
the outline is a topic list, not an argument; sharpen the bullets (or reorder them) before drafting.
This is the single best predictor of whether the draft will read like reasoning or like filler.

Report any misalignments.

### Step 6: Update Workflow State

Update `.planning/ACTIVE_WORKFLOW.md`:

```yaml
phase: outline
current_section: [section name]
outlines_complete:
  - [list of completed outlines]
```

### Step 7: Continue or Proceed

After completing a section outline, IMMEDIATELY start the next section. Do NOT:
- Ask "should I continue?"
- Summarize what you just outlined
- Wait for confirmation

**Pausing between section outlines is procrastination disguised as courtesy.**

When ALL sections from OUTLINE.md have detailed outlines in `outlines/`, proceed to the draft phase.

---

## Deviation Rules (Outline Phase)

When outlining reveals unplanned issues, follow the deviation rules from `constraints/deviation-rules.md`:

- **R1 (Factual):** Source contradicts a PRECIS claim → auto-fix: note the contradiction, adjust the outline point
- **R2 (Evidence):** No source found for an outline point → auto-fix: flag as evidence gap, search for sources
- **R3 (Structural):** Section doesn't fit the argument flow → auto-fix: reorder subsections
- **R4 (Restructuring):** Entire PRECIS claim needs revision based on outlining → **STOP**, present to user, may require returning to writing-setup

Track deviations per section outline. Each section summary should include: **Deviations:** N auto-fixed (R1: X, R2: Y, R3: Z). **R4 escalations:** [list or "none"].

## Gate: Exit Outline Phase

Before proceeding to draft phase (see `constraints/gate-function-standard.md` for the full 6-step gate including SUMMARY):

1. **IDENTIFY**: What proves outlining is complete?
   - Every section in OUTLINE.md has a corresponding file in `outlines/`
   - Each outline cross-references PRECIS.md claims
2. **RUN**: List files in `outlines/`, compare against sections in OUTLINE.md
3. **READ**: Check each outline is one topic-sentence bullet per paragraph (full claims), with evidence/idea sub-bullets
4. **VERIFY**: All sections have outlines, all outlines reference PRECIS claims
5. **REVIEW**: Dispatch outline reviewer subagent:
   Discover path: `${CLAUDE_SKILL_DIR}/../../skills/writing-outline-reviewer/SKILL.md`, then `Read()` the output.
   Follow the reviewer skill instructions: dispatch the subagent, handle APPROVED/ISSUES_FOUND, fix and re-review up to 5 times. Only proceed when APPROVED.
6. **CLAIM**: Only if steps 1-5 pass (including reviewer APPROVED), proceed to draft phase. **Gate type: `human-verify` — auto-advance to writing-draft.**
7. **SUMMARY**: Append phase summary to `.planning/PHASE_SUMMARY.md` (see `constraints/phase-summary-frontmatter.md`):
   - phase: outline
   - artifacts_produced: [list all outlines/*.md files created]
   - implements: [CLAIM-XX ids these outlines advance — the requirement→phase trace]
   - provides: [outlines/*.md, .planning/OUTLINE_REVIEWED.md]
   - deviations: {r1: X, r2: Y, r3: Z, r4: W}
   - Include substantive one-liner (NOT "Outlining complete")

**Skipping the outline verification is NOT HELPFUL — the user drafts from a thin outline and rewrites every section.** You must verify every outline exists and has real structure.

**Proceeding to draft with a thin outline is NOT HELPFUL — every section will wander and require complete redrafting.** The reviewer must confirm depth before drafting begins.

---

## Outline Quality Checklist

Before finalizing each outline, verify:

- [ ] Every top-level bullet is one paragraph's topic sentence (a full claim, not a label/topic), with evidence/ideas as sub-bullets; the top-level bullets read in document order form the argument on their own
- [ ] Evidence is specific (quotes, data), not vague ("sources say")
- [ ] Logic connecting evidence to point is explicit
- [ ] Transitions between subsections are planned
- [ ] Section contributes to thesis (not tangential)
- [ ] Anticipated objections are noted where relevant
- [ ] Length estimate is realistic

## Red Flags

- About to create an outline without reading PRECIS.md first → STOP. The outline won't align with the thesis; read PRECIS before every outline.
- About to write a topic list instead of a structured outline → STOP. Topics are not arguments; make each top-level bullet a full topic-sentence CLAIM (one per paragraph) with evidence/idea sub-bullets.
- About to skip the cross-reference with PRECIS → STOP. The section may advance no claim; check which claim it serves.
- About to pause after one outline to ask permission → STOP. That breaks momentum; continue to the next section immediately.
- About to outline without sources → STOP. Evidence-free outlines produce evidence-free prose; go back to brainstorm for sources.

## Progress Gating

**If 5+ iterations on the same section without meaningful progress, STOP and escalate to the user for scope adjustment.**

Signs you are stuck:
- Rewriting the same subsection structure repeatedly
- Cycling between two structural approaches
- Unable to find evidence for a claimed point after multiple searches
- PRECIS claim doesn't decompose cleanly into this section

When escalating, present:
- What you've tried (briefly)
- Where the section is stuck
- Options: narrow scope, merge with adjacent section, drop the claim, or reframe the argument

**Spinning without progress is anti-helpful.** Recognizing when to ask for guidance is competence, not weakness.

## Common Problems

| Problem | Fix |
|---------|-----|
| Outline is just topic list | Rewrite each item as a full topic-sentence claim (one per paragraph); put evidence/ideas in sub-bullets |
| No sources mapped | Go back to research or brainstorm |
| Section doesn't advance a claim | Rethink why it exists |
| Too long for one section | Split into multiple sections |
| Transitions missing | Add explicit bridges |

## Next Phase

After all section outlines are complete:

### Outline Review Gate (MANDATORY)

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-outline-reviewer/SKILL.md` and follow its instructions.

Follow the outline reviewer's instructions:
- If 10+ sections → review in groups of 3-4
- Dispatch reviewer subagent
- If ISSUES_FOUND → fix outlines → re-dispatch (max 5 iterations)
- If APPROVED → proceed to draft phase

**After outline review APPROVED:**

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-draft/SKILL.md` and follow its instructions.

Then follow its instructions immediately to expand outlines into prose.
