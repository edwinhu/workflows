---
name: writing-draft
description: Internal skill for expanding section outlines into prose. Called after section outlines are complete.
---

# Writing Draft

Expand detailed section outlines into prose, one section at a time, using domain-specific style rules.

**Prerequisites:** PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md, and at least one section outline in `outlines/` must exist.

<EXTREMELY-IMPORTANT>
## The Iron Law of Drafting

**NO PROSE WITHOUT OUTLINE. Every section must have a detailed outline in `outlines/` BEFORE you write prose for it. This is not negotiable.**

If you find yourself drafting without a matching outline file:
1. STOP immediately
2. DELETE what you wrote
3. Create the outline first using writing-outline
4. THEN draft the prose

Writing without an outline produces incoherent, wandering prose that requires complete rewriting.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Depth

**EACH SECTION DESERVES FULL ATTENTION. Do not rush through sections to "finish" the draft. This is not negotiable.**

The failure mode: a single agent writes cursory 2-paragraph versions of every section to reach "draft complete" as fast as possible. This is reward hacking - optimizing for the appearance of completion without the substance.

Each section must:
- Expand EVERY point from the outline (not a subset)
- Include EVERY piece of evidence mapped in the outline
- Develop transitions between subsections
- Meet the word count target from the outline

If you catch yourself writing a section significantly shorter than the outline implies, STOP. You are being cursory. Go back to the outline and expand every point.
</EXTREMELY-IMPORTANT>

## Process

### Step 1: Load Context

```
Read(".claude/ACTIVE_WORKFLOW.md")
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
```

### Step 2: Load Domain Skill

Based on `style` in ACTIVE_WORKFLOW.md, load the domain skill that governs prose style:

| Style | Action |
|---|---|
| legal | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/SKILL.md")` |
| econ | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-econ/SKILL.md")` |
| general | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-general/SKILL.md")` |

<EXTREMELY-IMPORTANT>
### Legal Domain: MUST Load Full Skill

When `style: legal` is detected:

1. **MUST Read the full skill file:**
   ```
   Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/SKILL.md")
   ```

2. **MUST use template for .docx export:**
   ```
   ${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/templates/law_review_template.docx
   ```

3. **Iron Laws from writing-legal:**
   - NO DOCX WITHOUT TEMPLATE - Copy template first, then add content
   - NO CLAIM WITHOUT COUNTERARGUMENTS - Confront objections
   - NO SECONDARY CITATIONS - Read original sources

**If you create a legal docx without reading the skill and using the template, DELETE IT and START OVER.**
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
### Econ Domain: MUST Load Full Skill

When `style: econ` is detected:

1. **MUST Read the full skill file:**
   ```
   Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-econ/SKILL.md")
   ```

2. **Iron Laws from writing-econ:**
   - NO BOILERPLATE - Delete "This paper discusses...", roadmap paragraphs
   - NO ELEGANT VARIATION - One concept = one word, always
   - HOOK WITH FINDING - Start with compelling result, not background

3. **Delete & Restart triggers:**
   - "This paper discusses..." → DELETE, start with finding
   - Table-of-contents paragraph → DELETE
   - "As we shall see..." → DELETE

**If you write boilerplate in an econ paper, DELETE THE SECTION and START OVER with a hook.**
</EXTREMELY-IMPORTANT>

### Step 3: Choose Drafting Strategy

Use `AskUserQuestion` to determine approach:

```
AskUserQuestion(questions=[
  {
    "question": "How should we draft the sections?",
    "header": "Strategy",
    "options": [
      {"label": "Sequential (Recommended)", "description": "Draft sections one at a time in order. Best for maintaining argument flow."},
      {"label": "Agent team (parallel)", "description": "Spawn teammate per section for parallel drafting. Best for long documents with independent sections. Requires reconciliation pass afterward."},
      {"label": "Key section first", "description": "Start with the core argument section, then build outward. Best when the central claim needs to be strongest."}
    ],
    "multiSelect": false
  }
])
```

#### Sequential Drafting (Default)

For each section with a completed outline, in order:

1. **Read the section outline**: `Read("outlines/[Section] (Outline).md")`
2. **Cross-reference with PRECIS**: Which claim does this section advance?
3. **Write prose**: Expand the outline into full paragraphs, following domain style rules
   - Every outline point becomes at least one paragraph
   - Every piece of evidence from the outline appears in prose
   - Transitions between subsections are explicit
4. **Save to drafts/**: `Write("drafts/[Section] (Draft).md", content)`
5. **Self-check**: Does the draft cover every point in the outline? Is it cursory or developed?

After completing each section, IMMEDIATELY start the next section. Do NOT:
- Ask "should I continue?"
- Summarize what you just wrote
- Wait for confirmation

**Pausing between sections is procrastination disguised as courtesy.**

#### Agent Team Drafting (Parallel)

For long documents (5+ sections) with independent sections, use Claude Code agent teams to draft sections in parallel.

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to Sequential Drafting.

##### 1. Prerequisites Check

Before spawning any teammates:

```
Glob("outlines/*.md")   # Verify all section outlines exist
Read(".claude/ACTIVE_WORKFLOW.md")  # Get style, section list
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
```

Confirm: every section listed in OUTLINE.md has a corresponding outline file. If any are missing:

1. **STOP** — do not spawn any teammates
2. List the missing outlines to the user
3. Suggest running `/writing-outline` to create the missing section outlines first

Spawning teammates with incomplete outlines causes them to fail or produce generic prose.

##### 2. Create Shared Task List and Enter Delegate Mode

1. Create one task per section using `TaskCreate`:
   - Subject: `Draft: [Section Name]`
   - Description: section outline path, adjacent sections for messaging
2. Press **Shift+Tab** to enter delegate mode — the lead coordinates, does NOT draft
3. Spawn one teammate per section (or group 2 tightly related sections into one teammate)

##### 3. Spawn Prompt Template

Each teammate receives this self-contained prompt. **This is critical — teammates start with a blank conversation and do NOT auto-load the writing-draft skill.** The prompt must be completely self-contained; do NOT instruct teammates to load the writing-draft skill.

**Before spawning, substitute these variables into the template below:**
- `SECTION_NAME` → actual section name (e.g., "III. Analysis")
- `SECTION_OUTLINE_PATH` → path to outline file (e.g., "outlines/III. Analysis (Outline).md")
- `PREV_SECTION` → previous section name, or "none" if first section
- `NEXT_SECTION` → next section name, or "none" if last section
- `STYLE` → style value from ACTIVE_WORKFLOW.md (legal, econ, or general)
- `PLUGIN_ROOT` → the resolved value of `${CLAUDE_PLUGIN_ROOT}`

```
You are drafting one section of a longer document as part of a writing team.

## Your Assignment
Section: {SECTION_NAME}
Previous section: {PREV_SECTION}
Next section: {NEXT_SECTION}

## Iron Laws (Non-Negotiable)

1. **NO PROSE WITHOUT OUTLINE.** You must read the section outline before
   writing a single word of prose. Writing without an outline produces
   incoherent, wandering text that requires complete rewriting.

2. **NO CURSORY DRAFTING.** Each section deserves full attention:
   - Expand EVERY point from the outline (not a subset)
   - Include EVERY piece of evidence mapped in the outline
   - Develop transitions between subsections
   - Meet the word count target from the outline
   If a section is significantly shorter than the outline implies, STOP.
   You are being cursory. Go back and expand every point.

## Step 1: Read Context (in this order)

```
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
Read("{SECTION_OUTLINE_PATH}")
```

Identify which PRECIS claim this section advances. Keep this in mind throughout.

## Step 2: Load Domain Style

```
Read("{PLUGIN_ROOT}/lib/skills/writing-{STYLE}/SKILL.md")
```

Follow every style rule from this skill. Do not write generic prose.

## Step 3: Draft

Write the full section following the outline structure:
- Every outline point → at least one developed paragraph
- Every piece of evidence from the outline → included and contextualized
- Explicit transitions between subsections

## Step 4: Save

```
Write("drafts/{SECTION_NAME} (Draft).md", content)
```

## Step 5: Message the Lead with Transition Summary

After saving, send a message to the lead with your transition boundaries:

```
Finished drafting "SECTION_NAME".

Opening (picks up from PREV_SECTION):
[Your first 2 sentences, showing what concept you assume the previous section established]

Closing (hands off to NEXT_SECTION):
[Your last 2 sentences, showing what concept the next section should pick up]
```

The lead uses these summaries during reconciliation to verify transitions between sections. Do NOT message other teammates directly — the lead coordinates all cross-section communication.

## Step 6: Self-Verification Checklist

Before marking your task complete, verify ALL of the following:

- [ ] Draft file exists at `drafts/{SECTION_NAME} (Draft).md`
- [ ] Every subsection from the outline has corresponding prose
- [ ] Every piece of evidence from the outline appears in the draft
- [ ] Domain style rules were followed (re-read the style skill to confirm)
- [ ] The section advances the PRECIS claim identified in Step 1
- [ ] Word count is in the range the outline implies (not drastically short)

Only mark your task complete after all boxes pass.

## If You Encounter Issues

- **File not found:** Verify your working directory contains `.claude/`, `outlines/`,
  and `drafts/`. If not, message the lead with your current directory.
- **Outline is unclear or incomplete:** Do NOT draft generic prose to fill gaps.
  Message the lead: "Outline for SECTION_NAME is missing [specific element]."
  Mark your task as blocked.
- **Taking too long on one subsection:** If you've spent extensive time on a single
  subsection, message the lead for guidance rather than producing cursory filler.
```

##### 4. Lead Monitoring

While teammates draft:

- Watch the shared task list for completion status
- If a teammate has been working significantly longer than others, message them for a status update
- Do NOT draft any sections yourself — your job is coordination and reconciliation

##### 5. Reconciliation Protocol (Lead's Job)

After ALL teammates mark their tasks complete, the lead performs three passes:

**Pass 1 — Transitions:**
For each section boundary (N → N+1):
1. Read the last paragraph of Section N's draft
2. Read the first paragraph of Section N+1's draft
3. Compare against each teammate's transition summary message (from Step 5) — do the intended handoff concepts actually appear?
4. If the bridge is abrupt or disconnected, rewrite the closing/opening to create a smooth handoff

**Pass 2 — Terminology:**
1. Re-read PRECIS.md and extract the 3-5 core concepts (main thesis terms, key variables, central constructs)
2. For each core concept, grep ALL draft files for variants:
   ```
   Grep(pattern="concept|variant1|synonym1", path="drafts/", output_mode="content")
   ```
3. For each concept with multiple variants found: pick ONE canonical term (prefer the PRECIS term), then edit all draft files to use it consistently
4. Domain-specific: for `econ` style, this is especially critical (one concept = one word, always)

**Pass 3 — Argument Threading:**
1. Re-read the PRECIS
2. Read each section draft in order, tracking: does each section advance its assigned claim?
3. Check cross-references: if Section III cites a result from Section II, verify the result actually appears in Section II's draft
4. Flag any section that drifts from its outline's argument or fails to connect to the overall thesis

##### 6. Update Workflow State

After reconciliation, update `.claude/ACTIVE_WORKFLOW.md`:

```yaml
phase: draft
drafting_mode: parallel
sections_drafted:
  - [all section names]
reconciliation: complete
edits_since_verify: 0
```

##### When to Use Agent Teams
- Document has 5+ substantive sections
- Sections are relatively independent (each advances a different claim)
- Time matters more than perfect flow (flow gets fixed in reconciliation)
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is enabled

##### When NOT to Use Agent Teams
- Sections build tightly on each other (argument chains where Section N requires Section N-1's exact phrasing)
- Document is short (3 or fewer sections)
- Consistent voice matters more than speed
- Experimental agent teams feature is not available

#### Key Section First

1. Identify the core argument section (usually the "Proof" or main claim section)
2. Draft it first with full attention
3. Then draft surrounding sections that support it
4. Introduction and conclusion last (they frame the core)

### Step 4: Update Workflow State

After each section, update `.claude/ACTIVE_WORKFLOW.md`:

```yaml
phase: draft
current_section: [section name]
sections_drafted:
  - [list of completed sections]
edits_since_verify: 0
```

---

## Gate: Exit Draft

Before proceeding to edit/verify:

1. **IDENTIFY**: Draft files in `drafts/` for all sections listed in OUTLINE.md
2. **RUN**: List files in `drafts/`, compare against OUTLINE.md sections
3. **READ**: Check each draft exists and has substantial content (not cursory stubs)
4. **VERIFY**: All sections have drafts, each draft covers all outline points
5. **CLAIM**: Only if steps 1-4 pass, proceed to writing-revise

**Reporting "all sections drafted" without checking each file is LYING.** You must verify every draft exists and has real content.

---

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "I'll outline in my head, no file needed" | Mental outlines produce wandering prose | Write the outline file first |
| "This section is short, outline is overkill" | Short sections still need structure | Write a brief outline, then expand |
| "I'll draft all sections at once for flow" | Monolithic drafting loses focus and depth | One section at a time, verify each |
| "The outline is close enough to prose already" | Outlines organize; prose argues | Expand with evidence and transitions |
| "I'll fix the structure in editing" | Structural problems in drafts compound | Get structure right in outline, before prose |
| "This doesn't match the outline but it's better" | Unplanned deviations are usually rationalizations | Update outline first, then draft to match |
| "I'll write a quick version now and expand later" | "Later" means never. Cursory drafts stay cursory. | Write it properly the first time |
| "The user just wants to see something fast" | Fast garbage requires more rework than slow quality | Invest in depth now, save rework later |
| "This section only needs 2 paragraphs" | If the outline has 5 subsections, 2 paragraphs is cursory | Match the depth the outline implies |
| "I can skip the evidence for now" | Evidence-free claims are assertions, not arguments | Include every piece of evidence from the outline |

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Drafting without reading the section outline | Prose will drift from structure | Read outline first, always |
| Writing multiple sections simultaneously | Lose focus, miss transitions, cursory treatment | One section at a time |
| Ignoring domain style rules | Generic prose instead of appropriate register | Load and follow domain skill |
| Skipping the PRECIS cross-reference | Section may not advance the argument | Check which claim this section serves |
| Stopping after one section to ask user | Breaks momentum and context | Continue to next section immediately |
| Writing a section in 2 paragraphs when outline has 5 subsections | You are being cursory to "finish" faster | Expand every subsection properly |
| Skipping evidence mapped in the outline | Claims without evidence are assertions | Include all evidence, developed in prose |

---

## Next Phase

After all sections are drafted:

Invoke `/writing-review` to diagnose structural issues (transitions, repetition, late-introduced concepts), then `/writing-revise` to fix them.
