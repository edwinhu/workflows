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

For long documents (5+ sections) with independent sections, use agent teams:

1. **Create a team** with one teammate per section (or group of related sections)
2. Each teammate receives:
   - The PRECIS.md and OUTLINE.md for context
   - Their specific section outline from `outlines/`
   - The domain skill to follow
   - Instructions to write a full, developed draft (not cursory)
3. **Reconciliation pass** after all teammates finish:
   - Check transitions between sections (each teammate wrote independently)
   - Verify consistent terminology across sections
   - Ensure argument threads connect (claim from Section II feeds Section III)
   - Fix any redundancies or contradictions

This mirrors how co-authors work: each writes their section independently, then the group reconciles.

**When to use agent teams:**
- Document has 5+ substantive sections
- Sections are relatively independent (each advances a different claim)
- Time matters more than perfect flow (flow gets fixed in reconciliation)

**When NOT to use agent teams:**
- Sections build tightly on each other (argument chains)
- Document is short (3 or fewer sections)
- Consistent voice matters more than speed

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
5. **CLAIM**: Only if steps 1-4 pass, proceed to writing-edit

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

Invoke `/writing-edit` to verify structure, check anti-patterns, and complete the workflow.
