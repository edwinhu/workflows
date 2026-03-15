# Agent Team Drafting (Parallel)

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
- `PLUGIN_ROOT` → resolved base directory for skill paths (relative to this skill's base directory)

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
Discover the domain style skill path, then Read() it:
command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/lib/skills/writing-{STYLE}/SKILL.md 2>/dev/null | sort -V | tail -1
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
