---
name: writing-outline
description: Internal skill for creating detailed section outlines. Called by /writing workflow after PRECIS and master OUTLINE are complete.
---

# Writing Outline

Create a detailed outline for a specific section/part before drafting prose. This is Level 3 of the progressive expansion workflow.

## Progressive Expansion Context

```
.claude/PRECIS.md          # Level 1: Thesis, claims, audience
       ↓
.claude/OUTLINE.md         # Level 2: Master structure (sections, goals)
       ↓
outlines/Part I.md         # Level 3: THIS STEP - Detailed section outline
       ↓
drafts/Part I.md           # Level 4: Prose expansion
```

**Never skip to prose drafting without a detailed outline first.**

## Process

### Step 1: Load Context

```
Read(".claude/ACTIVE_WORKFLOW.md")
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
```

If master OUTLINE.md is missing, run writing-brainstorm first.

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

Write to `outlines/[Section Name] (Outline).md`:

```markdown
# [Section Name] - Detailed Outline

## Section Goal
[From master OUTLINE.md - what this section accomplishes]

## Claim Supported
[Which claim from PRECIS.md this section advances]

## Structure: [Chronological/Thematic/Problem-Solution/Comparative]

---

## Opening

**Lead sentence**: [Draft or TBD]
**Context needed**: [What reader must know]
**Transition from previous**: [How we got here]

---

## Body

### Subsection A: [Name]

**Point**: [Main argument of this subsection]
**Evidence**:
  - [Source 1]: "[key quote or fact]"
  - [Source 2]: "[key quote or fact]"
**Logic**: [How evidence supports point]
**Transition**: [Bridge to next subsection]

### Subsection B: [Name]

**Point**: [Main argument]
**Evidence**:
  - [Source]: "[key quote or fact]"
**Logic**: [How evidence supports point]
**Anticipated objection**: [If applicable]
  - Response: [How to address]
**Transition**: [Bridge to next]

### Subsection C: [Name]

[Continue pattern...]

---

## Closing

**Section summary**: [One sentence recap]
**Bridge to next section**: [How this leads to what follows]
**Thesis thread**: [How this connects to main thesis from PRECIS]

---

## Sources Used in This Section
- [Source 1] - used for [what]
- [Source 2] - used for [what]

## Open Questions
- [Anything unresolved before drafting]

## Estimated Length
[Paragraph count or word count target]
```

### Step 5: Cross-Reference with PRECIS

Verify the detailed outline against PRECIS.md:

- [ ] Advances at least one claim from PRECIS
- [ ] Addresses relevant counterarguments (if applicable)
- [ ] Stays within IN scope
- [ ] Avoids OUT scope items
- [ ] Maintains thesis thread

Report any misalignments.

### Step 6: Update Workflow State

Update `.claude/ACTIVE_WORKFLOW.md`:

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

## Gate: Exit Outline Phase

Before proceeding to draft phase:

1. **IDENTIFY**: What proves outlining is complete?
   - Every section in OUTLINE.md has a corresponding file in `outlines/`
   - Each outline cross-references PRECIS.md claims
2. **RUN**: List files in `outlines/`, compare against sections in OUTLINE.md
3. **READ**: Check each outline has POINT, EVIDENCE, LOGIC for subsections
4. **VERIFY**: All sections have outlines, all outlines reference PRECIS claims
5. **CLAIM**: Only if steps 1-4 pass, proceed to draft phase

**Claiming "outlines complete" without checking each file is LYING.** You must verify every outline exists and has real structure.

---

## Outline Quality Checklist

Before finalizing each outline, verify:

- [ ] Every subsection has a clear POINT
- [ ] Evidence is specific (quotes, data), not vague ("sources say")
- [ ] Logic connecting evidence to point is explicit
- [ ] Transitions between subsections are planned
- [ ] Section contributes to thesis (not tangential)
- [ ] Anticipated objections are noted where relevant
- [ ] Length estimate is realistic

## Red Flags - STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Creating an outline without reading PRECIS first | Outline won't align with thesis | Read PRECIS.md before every outline |
| Writing a topic list instead of structured outline | Topics ≠ arguments | Add POINT, EVIDENCE, LOGIC for each subsection |
| Skipping the cross-reference with PRECIS | Section may not advance any claim | Check which claim this section serves |
| Stopping after one outline to ask permission | Breaks momentum | Continue to next section immediately |
| Making an outline without sources | Evidence-free outlines produce evidence-free prose | Go back to brainstorm for sources |

## Common Problems

| Problem | Fix |
|---------|-----|
| Outline is just topic list | Add POINT, EVIDENCE, LOGIC for each |
| No sources mapped | Go back to research or brainstorm |
| Section doesn't advance a claim | Rethink why it exists |
| Too long for one section | Split into multiple sections |
| Transitions missing | Add explicit bridges |

## Next Phase

After all section outlines are complete:

```
Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-draft/SKILL.md")
```

Then follow its instructions immediately to expand outlines into prose.
