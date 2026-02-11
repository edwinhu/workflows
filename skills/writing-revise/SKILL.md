---
name: writing-revise
version: 1.0
description: "This skill should be used when the user asks to 'revise writing', 'fix review issues', 'polish draft', 'apply review feedback', 'complete writing workflow', or after /writing-review produces REVIEW.md with issues to fix."
---

# Writing Revise

The revision loop for writing projects. Consumes `.claude/REVIEW.md` (produced by `/writing-review`) and applies targeted fixes, then completes the workflow when all issues are resolved.

## IRON LAW: Critique Over Comfort

**If the writing has problems, SAY SO. Being nice is LYING to the user.**

### Red Flag Detection

If you catch yourself thinking:
- "This is pretty good overall" - STOP. Find the weakness.
- "I don't want to be too harsh" - STOP. Harsh is kind.
- "The author probably knows what they're doing" - STOP. Check anyway.

### Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "It's a draft, I'll be gentle" | Drafts need MORE critique, not less | Critique hardest on drafts |
| "The main point is clear enough" | "Clear enough" means unclear | Find the ambiguity and fix it |
| "I'll focus on positives first" | Positives don't help improve writing | Lead with problems |
| "This is good enough for a first pass" | "Good enough" is reward hacking | Find specific problems to fix |
| "The user will polish it themselves" | Relying on human editing defeats the workflow | Fix it now |
| "I don't want to discourage the writer" | False kindness produces bad writing | Honest critique is the kindest act |
| "The argument flows well overall" | "Overall" hides section-level problems | Check each section against PRECIS claims |
| "Minor style issues aren't worth flagging" | Minor issues compound into unprofessional prose | Flag every issue you find |
| "The structure matches the outline" | Structural match doesn't mean quality match | Check content quality, not just structure |
| "This section is creative, rules don't apply" | Creative writing still needs clarity and precision | Apply rules, note creative exceptions explicitly |

**Reporting "all checks pass" without actually running every check is LYING.** You must have evidence for every checkmark. An unchecked box with "assumed OK" is fraud.

## When to Use

- After `/writing-review` produces `.claude/REVIEW.md`
- When hook suggests it (after ~10 edits)
- Before finishing a writing project

## Prerequisites Gate

Before running edits, verify the workflow is ready:

1. **IDENTIFY**: `.claude/ACTIVE_WORKFLOW.md`, `.claude/PRECIS.md`, `.claude/OUTLINE.md`, and at least one file in `drafts/` must exist
2. **RUN**: Check file existence
3. **READ**: Confirm ACTIVE_WORKFLOW shows `workflow: writing`
4. **VERIFY**: All required files present and draft content exists
5. **CHECK FOR REVIEW.MD**: Look for `.claude/REVIEW.md`

If any file is missing, report and suggest the appropriate phase:
- No PRECIS.md -> `/writing` (start from brainstorm)
- No OUTLINE.md -> writing-setup needed
- No drafts -> writing-draft needed
- **No REVIEW.md** -> suggest `/writing-review` first (see backward-compatibility below)

## Process

### Step 1: Load Context

```
Read(".claude/ACTIVE_WORKFLOW.md")
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
Read([current draft files in drafts/])
```

If any file is missing, report and suggest starting with `/writing`.

### Step 2: Load REVIEW.md or Fall Back

**Primary path (REVIEW.md exists):**

```
Read(".claude/REVIEW.md")
```

Parse the review into:
- **Critical issues** -- fix first, these break the argument
- **Major issues** -- fix second, these weaken the document
- **Minor issues** -- fix last, these polish the prose

**Backward-compatibility path (no REVIEW.md):**

If `.claude/REVIEW.md` does not exist, inform the user:

```
No REVIEW.md found. For best results, run /writing-review first to produce
a structured diagnosis, then re-run /writing-revise.

Proceeding with inline review (less thorough than /writing-review).
```

If user chooses to proceed without REVIEW.md, perform a lightweight inline check:
1. Load domain skill (Step 3)
2. Do a single-pass review: structure verification, AI anti-patterns, domain check, formatting
3. Fix issues found in-line
4. Skip to Step 6 (Generate Report)

This path exists for quick edits and backward compatibility. The `/writing-review` -> `/writing-revise` pipeline is the recommended workflow.

### Step 3: Load Domain Skill

Load the full domain skill based on `style` in ACTIVE_WORKFLOW.md:

| Style | Load |
|-------|------|
| legal | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/SKILL.md")` |
| econ | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-econ/SKILL.md")` |
| general | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-general/SKILL.md")` |

**You MUST Read() the domain skill before editing.** The domain skill contains the full rules, reference material, and enforcement patterns. Editing without it produces generic fixes.

### Step 4: Fix Issues from REVIEW.md

Work through REVIEW.md issues in priority order:

#### 4a: Critical Issues First

For each critical issue in REVIEW.md:
1. Read the cited location in the draft
2. Understand the diagnosis
3. Apply the suggested fix (or a better one if you see it)
4. Verify the fix resolves the issue without creating new problems

#### 4b: Major Issues

For each major issue:
1. Read the cited location
2. Apply fix
3. Verify

**Transition fixes** (from REVIEW.md "Transition Issues" section):
- Read the boundary summaries for context
- Write bridge text that connects Section N's closing to Section N+1's opening
- Ensure the bridge advances the argument, not just changes the topic

**Repetition fixes** (from REVIEW.md "Cross-Section Repetition"):
- Decide which section should own the point
- Remove or differentiate the duplicate
- Ensure removing the duplicate doesn't leave a gap

**Late introduction fixes** (from REVIEW.md "Concept Introduction Order"):
- Add foreshadowing in the Introduction or earlier section
- Or restructure to move the concept's first substantive use earlier

#### 4c: Minor Issues

For each minor issue:
1. Apply fix
2. Quick verify

### Step 5: Formatting Check

- [ ] Consistent heading styles
- [ ] Citations formatted (Bluebook for legal, journal style for econ)
- [ ] Footnotes properly numbered (if applicable)
- [ ] No orphaned references

### Step 6: Generate Report

```markdown
## Edit Report

**Document**: [title from PRECIS]
**Style**: [legal | econ | general]
**Word count**: [approximate]
**Source**: [REVIEW.md | inline review]

### Issues Fixed
- Critical: [N] fixed / [N] total
- Major: [N] fixed / [N] total
- Minor: [N] fixed / [N] total

### Remaining Issues
[List any issues that could not be fixed automatically]

### Formatting
- [x] Citations formatted
- [x] Headings consistent

### Status: [PASS | ISSUES REMAIN]
```

### Step 7: Branch Based on Results

#### If Issues Remain

Update `.claude/ACTIVE_WORKFLOW.md`:

```yaml
phase: edit
edits_since_verify: 0
edit_iteration: [current iteration + 1]
```

**Iteration limit: maximum 3 edit cycles.** Each cycle is: fix issues -> re-run `/writing-review` -> re-run `/writing-revise`. If issues persist after 3 rounds, escalate to the user:

```
Edit cycle [N]/3: Issues remain after [N] review-edit passes.

Persistent issues:
- [list unresolved issues]

These may require human judgment. Please review and advise.
```

Report issues with suggested fixes:
- **Minor issues**: "Address remaining issues, then re-run `/writing-review` -> `/writing-revise`."
- **Major issues**: "Significant revisions needed. Fix and re-run `/writing-review` -> `/writing-revise`."

#### If All Issues Fixed -> Complete Workflow

Archive workflow state:

```bash
mkdir -p .claude/completed-workflows
mv .claude/ACTIVE_WORKFLOW.md ".claude/completed-workflows/$(date +%Y-%m-%d)-writing.md"
```

Generate completion summary:

```markdown
## Writing Workflow Complete

**Project**: [directory name]
**Completed**: [date]
**Style**: [legal | econ | general]

### Artifacts
- `.claude/PRECIS.md` - Thesis, audience, claims
- `.claude/OUTLINE.md` - Document structure
- `.claude/REVIEW.md` - Final review diagnosis
- `outlines/` - Detailed section outlines
- `drafts/` - Final prose

### Document Summary
- **Thesis**: [from PRECIS.md]
- **Sections**: [count]

### Next Steps
- Export to Word: `/docx`
- Export to PDF: `/pdf`
- Start new project: `/writing`
```
