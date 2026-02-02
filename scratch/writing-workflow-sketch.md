# Writing Workflow Sketch

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    WRITING WORKFLOW                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /writing-brainstorm ──► PRECIS.md + OUTLINE.md                 │
│         │                                                        │
│         ▼                                                        │
│  /writing-legal  ───────────────────────────────┐               │
│  /writing-econ   ─► Auto-loads:                 │               │
│  /writing        │  • Base writing rules        │               │
│                  │  • Domain rules              │               │
│                  │  • Sets ACTIVE_WORKFLOW.md   │               │
│                  └──────────────────────────────┘               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────┐               │
│  │          DRAFT / EDIT LOOP                    │               │
│  │                                               │               │
│  │  User works naturally...                      │               │
│  │  After N edits: "Consider /writing-verify"   │               │
│  │                                               │               │
│  └──────────────────────────────────────────────┘               │
│         │                                                        │
│         ▼                                                        │
│  /writing-verify (user-invoked)                                 │
│      → Recursive verification                                   │
│      → Check against PRECIS.md + OUTLINE.md                     │
│         │                                                        │
│         ▼                                                        │
│  /writing-polish (before "done")                                │
│      → AI anti-patterns check                                   │
│      → Final PRECIS.md alignment                                │
│      → Citations/formatting                                     │
│         │                                                        │
│         ▼                                                        │
│  /writing-done                                                  │
│      → Clear ACTIVE_WORKFLOW.md                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
project/
├── PRECIS.md                    # Thesis, audience, purpose, claims
├── OUTLINE.md                   # Structure with section goals
├── .claude/
│   └── ACTIVE_WORKFLOW.md       # Workflow state
├── outlines/
│   └── Part I (Outline).md      # Detailed section outlines
├── drafts/
│   └── Part I (Draft).md        # Prose expansion
└── references/
    └── ...                      # Source materials
```

---

## Phase 1: Entry Point (/writing-brainstorm)

### Updated SKILL.md additions

```markdown
## Phase 2: INTERVIEW (Create PRECIS.md)

After gathering sources, conduct structured interview:

### 2a. Core Questions

AskUserQuestion(questions=[
  {
    "question": "What is your thesis in one sentence?",
    "header": "Thesis",
    "options": [
      {"label": "I have a thesis", "description": "I'll type it"},
      {"label": "Help me find it", "description": "Synthesize from sources"},
      {"label": "Critique existing view", "description": "[X] is wrong because..."},
      {"label": "Propose reform", "description": "[X] should change to [Y]"}
    ],
    "multiSelect": false
  }
])

### 2b. Audience & Purpose

AskUserQuestion(questions=[
  {
    "question": "Who is your primary audience?",
    "header": "Audience",
    "options": [
      {"label": "Law review", "description": "Academic legal scholars"},
      {"label": "Practitioners", "description": "Lawyers, regulators"},
      {"label": "Policymakers", "description": "Legislators, agency staff"},
      {"label": "General educated", "description": "Informed non-specialists"}
    ],
    "multiSelect": false
  },
  {
    "question": "What should readers think or do after reading?",
    "header": "Purpose",
    "options": [
      {"label": "Change their view", "description": "Persuade them X is true"},
      {"label": "Take action", "description": "Implement recommendation"},
      {"label": "Understand complexity", "description": "See nuance they missed"},
      {"label": "Apply framework", "description": "Use this for future cases"}
    ],
    "multiSelect": false
  }
])

### 2c. Claims & Counterarguments

AskUserQuestion(questions=[
  {
    "question": "What are your 2-3 key claims that support the thesis?",
    "header": "Claims",
    "options": [
      {"label": "I'll list them", "description": "Type my claims"},
      {"label": "Derive from sources", "description": "Extract from gathered highlights"},
      {"label": "Need to think more", "description": "Come back to this"}
    ],
    "multiSelect": false
  },
  {
    "question": "What's the strongest objection to your thesis?",
    "header": "Counter",
    "options": [
      {"label": "I know it", "description": "I'll describe the objection"},
      {"label": "Find from sources", "description": "What do critics say?"},
      {"label": "Steel-man for me", "description": "Generate the best counter"}
    ],
    "multiSelect": false
  }
])

### 2d. Create PRECIS.md

Write the PRECIS.md file:

```markdown
# Precis: [Working Title]

## Thesis
[One sentence from interview]

## Audience
[From interview + what they know/believe]

## Purpose
[What reader should think/do after]

## Hook
[Concrete problem, controversy, or question - draft or TBD]

## Key Claims
1. [Claim 1] → supports thesis by...
2. [Claim 2] → supports thesis by...
3. [Claim 3] → supports thesis by...

## Counterarguments to Address
1. **[Objection]**: [description]
   - Response: [how we'll address it]
   - Section: [where it appears]

## Scope
### In
- [What we cover]

### Out
- [What we explicitly exclude and why]

## Domain
[legal | econ | general] → determines which /writing-X skill
```

### Phase 3: OUTLINE (existing, enhanced)

Enhance existing outline creation to map to PRECIS.md:

```markdown
# OUTLINE: [Title from PRECIS]

## Structure

### I. Introduction
- **Goal**: Hook reader, state thesis, roadmap
- **Hook**: [from PRECIS or TBD]
- **Thesis**: [from PRECIS]
- **Claims preview**: [list from PRECIS]

### II. [Section Name]
- **Goal**: [what this section accomplishes]
- **Claim supported**: [which claim from PRECIS]
- **Key points**:
  - Point A (sources: ...)
  - Point B (sources: ...)
- **Transition to next**: [how it leads to Section III]

### III. [Section Name]
...

### IV. Counterarguments
- **Goal**: Address objections from PRECIS
- **Objection 1**: [from PRECIS] → Response
- **Objection 2**: ...

### V. Conclusion
- **Goal**: Restate thesis with earned authority
- **Implications**: What follows from this argument
- **Future questions**: What remains unresolved

## Section Status
| Section | Status | Notes |
|---------|--------|-------|
| I. Introduction | outlined | |
| II. ... | outlined | |
```

### Phase 4: HANDOFF

```markdown
## Handoff to Domain Skill

Based on PRECIS.md domain field, set up workflow:

1. **Create ACTIVE_WORKFLOW.md**:

```yaml
workflow: writing
style: [legal|econ|general]
phase: draft
project_root: [path to project]
precis: PRECIS.md
outline: OUTLINE.md
current_section: "I. Introduction"
edits_since_verify: 0
verify_threshold: 10
skill_stack:
  - writing                    # base (always)
  - writing-[domain]           # domain layer
  - ai-anti-patterns           # quality (on polish)
```

2. **Load domain skill**:

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/writing-[domain]/SKILL.md")
```

3. **Announce**:

"Workflow initialized. Working on [project].
Current phase: draft
Current section: I. Introduction

I'll suggest /writing-verify after significant edits.
Use /writing-polish before finalizing."
```
```

---

## Phase 2: Domain Skills (Layered)

### Base: /writing (always loaded)

```markdown
---
name: writing
description: Base writing rules. Auto-loaded by domain skills.
---

# Base Writing Rules (Strunk & White)

## Iron Laws

1. **OMIT NEEDLESS WORDS** - Every word must earn its place
2. **USE ACTIVE VOICE** - "The committee approved" not "was approved"
3. **BE CONCRETE** - Specific details over vague abstractions
4. **WRITE IN PROSE** - No bullet points unless explicitly requested

## Sentence-Level Rules

| Rule | Check |
|------|-------|
| Active voice | Subject does the action |
| Concrete nouns | Specific > abstract |
| Strong verbs | "Decided" not "made a decision" |
| No hedging | Cut "arguably", "it could be said" |
| No filler | Cut "very", "really", "quite" |

## Paragraph-Level Rules

| Rule | Check |
|------|-------|
| Topic sentence | First sentence states main point |
| Unity | One idea per paragraph |
| Exposition | Sentences develop the topic |
| Bridge | Last sentence connects to next paragraph |

## Section-Level Rules

| Rule | Check |
|------|-------|
| Heading promise | Section delivers what heading promises |
| Logical order | Points build on each other |
| Transitions | Reader understands why each paragraph follows |

## Document-Level Rules

| Rule | Check |
|------|-------|
| Thesis thread | Every section serves the thesis |
| No contradictions | Claims don't conflict |
| Arc | Builds to earned conclusion |

## Quick Fixes

| Weak | Strong |
|------|--------|
| utilize | use |
| in order to | to |
| due to the fact that | because |
| at this point in time | now |
| it is important to note | [delete] |
| there are X that Y | X Y |
```

### Domain: /writing-legal

```markdown
---
name: writing-legal
description: Academic legal writing (Volokh). Auto-loads base writing rules.
includes:
  - writing           # base layer
  - ai-anti-patterns  # quality layer (on polish)
---

# Legal Writing Rules

**On load, first read base rules:**
Read("${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md")

## Legal-Specific Iron Laws

1. **NO CLAIM WITHOUT CONFRONTING COUNTERARGUMENTS**
2. **NO SECONDARY SOURCE FOR PRIMARY SOURCES** - Read the original case
3. **NO "THIS ARTICLE DISCUSSES"** - Hook with concrete problem

## Paragraph-Level (Legal)

| Rule | Check |
|------|-------|
| Synthesize precedents | "Courts hold X except Y" not case-by-case |
| Cite precisely | Case name, specific holding, not treatise summary |

## Section-Level (Legal)

| Rule | Check |
|------|-------|
| Background ≤ Proof | Don't bury claim under background |
| Test suite | Apply proposal to concrete cases |
| Confront objections | Address counterarguments in dedicated section |

## Document-Level (Legal)

| Rule | Check |
|------|-------|
| Hook first | Concrete question before abstract topic |
| Earned authority | Conclusion follows from argument |
| Candor | Acknowledge costs and limitations |

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Background needs more" | Only what proves claim | Cut to essentials |
| "Counterargument would hurt" | Ignoring hurts worse | Confront and refine |
| "Treatise explains it" | Treatises have errors | Read original |
| "Arguably shows nuance" | Shows you didn't argue | Make the argument |
| "This metaphor is clear" | Metaphors hide logic | Unpack the mechanism |
```

### Domain: /writing-econ

```markdown
---
name: writing-econ
description: Economics and finance writing (McCloskey). Auto-loads base writing rules.
includes:
  - writing           # base layer
  - ai-anti-patterns  # quality layer (on polish)
---

# Economics Writing Rules

**On load, first read base rules:**
Read("${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md")

## Econ-Specific Iron Laws

1. **NO FRONT-LOADED QUALIFICATIONS** - State claim, then qualify
2. **PREFER TABLES TO DESCRIPTION** - Show data, don't describe it
3. **NO "COMPLEX"** - If you can't explain it simply, you don't understand it

## Abstract Rules (5-paragraph structure)

1. State importance of topic
2. State your claim
3. Evidence summary
4. Implications
5. Audience takeaway

## Section-Level (Econ)

| Rule | Check |
|------|-------|
| Data presentation | Tables/figures before prose description |
| Identification | Clearly state causal strategy |
| Robustness | Address alternative explanations |

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Readers need context first" | Context buries the point | Lead with claim |
| "The data is complex" | Your explanation is unclear | Simplify |
| "Qualifications show rigor" | Front-loading shows fear | State then qualify |
```

---

## Phase 3: The Draft/Edit Loop

### State Tracking

```yaml
# .claude/ACTIVE_WORKFLOW.md (updated during work)

workflow: writing
style: legal
phase: edit           # draft | edit | polish
project_root: /path/to/project
precis: PRECIS.md
outline: OUTLINE.md
draft: drafts/Part I (Draft).md

current_section: "II. Background"
current_level: paragraph    # sentence | paragraph | section | document

edits_since_verify: 7
verify_threshold: 10

section_status:
  "I. Introduction": complete
  "II. Background": editing
  "III. Argument": drafted
  "IV. Counterarguments": outlined
  "V. Conclusion": outlined
```

### Hook: Suggest Verification

```python
# hooks/writing-suggest-verify.py
# Runs PostToolUse on Edit/Write for .md files in writing workflow

import json
import os
import sys

def main():
    tool_input = json.loads(os.environ.get("CLAUDE_TOOL_INPUT", "{}"))
    file_path = tool_input.get("file_path", "")

    # Only for markdown files
    if not file_path.endswith(".md"):
        return

    # Check for active writing workflow
    workflow_file = ".claude/ACTIVE_WORKFLOW.md"
    if not os.path.exists(workflow_file):
        return

    # Parse workflow state (simplified - would use yaml in practice)
    with open(workflow_file) as f:
        content = f.read()

    if "workflow: writing" not in content:
        return

    # Increment edit counter and check threshold
    # (In practice, update the YAML file)
    edits = extract_edits_count(content)
    threshold = extract_threshold(content)

    if edits >= threshold:
        print(json.dumps({
            "result": "continue",
            "message": f"📝 {edits} edits since last verify. Consider `/writing-verify` to check structure."
        }))
        # Reset counter in file
        reset_counter(workflow_file)
    else:
        # Increment counter
        increment_counter(workflow_file)

if __name__ == "__main__":
    main()
```

---

## Phase 4: Verification (/writing-verify)

```markdown
---
name: writing-verify
description: Recursive verification of writing structure. User-invoked.
---

# Writing Verification

Verify current work against PRECIS.md and OUTLINE.md.

## Process

### Step 1: Load Context

```
Read(".claude/ACTIVE_WORKFLOW.md")  # Get current section, phase
Read("PRECIS.md")                    # Get thesis, claims
Read("OUTLINE.md")                   # Get structure
Read([current_draft])                # Get current prose
```

### Step 2: Verify Current Level

Based on `current_level` in workflow state:

#### If sentence-level work:
- [ ] Active voice throughout
- [ ] Needless words omitted
- [ ] Concrete and specific
- [ ] No hedging (arguably, it could be said)

#### If paragraph-level work:
- [ ] Topic sentence states main point
- [ ] Exposition develops topic
- [ ] Bridge to next paragraph
- [ ] Matches corresponding outline bullet

#### If section-level work:
- [ ] Section delivers on heading promise
- [ ] Paragraphs progress logically
- [ ] Transitions connect paragraphs
- [ ] Section advances thesis (check PRECIS.md)
- [ ] Counterarguments addressed (if applicable)

#### If document-level work:
- [ ] All sections present from OUTLINE.md
- [ ] Thesis thread consistent throughout
- [ ] No contradictions between sections
- [ ] Hook delivered, conclusion earned
- [ ] Scope matches PRECIS.md (in/out)

### Step 3: Report Findings

```markdown
## Verification Report

**Section**: [current section]
**Level**: [sentence | paragraph | section | document]

### Passed
- [x] Topic sentences present
- [x] Active voice

### Issues Found
- [ ] Paragraph 3 missing bridge to paragraph 4
- [ ] Section doesn't clearly advance Claim 2 from PRECIS

### Suggested Fixes
1. Add transition sentence at end of paragraph 3
2. Make explicit connection to Claim 2 in topic sentence

### Next Steps
- Fix issues above
- Then verify at [next level up]
```

### Step 4: Update State

Reset `edits_since_verify` to 0 in ACTIVE_WORKFLOW.md
```

---

## Phase 5: Polish (/writing-polish)

```markdown
---
name: writing-polish
description: Final pass before completion. Runs ai-anti-patterns.
---

# Writing Polish

Final verification before marking writing complete.

## Process

### Step 1: Full Document Verification

Run /writing-verify at document level:
- All sections complete
- Thesis consistent
- No contradictions
- PRECIS.md alignment

### Step 2: AI Anti-Patterns Check

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/ai-anti-patterns/SKILL.md")
```

Scan for:
- Sycophantic openings
- Hollow emphasis (crucial, vital, essential)
- Unnecessary hedging
- List-heavy structure (should be prose)
- Generic conclusions

### Step 3: Domain-Specific Final Check

**Legal:**
- [ ] All claims confront counterarguments
- [ ] No secondary source citations for primary sources
- [ ] Hook is concrete, not "This article discusses"

**Econ:**
- [ ] Abstract follows 5-paragraph structure
- [ ] Tables/figures before description
- [ ] No front-loaded qualifications

### Step 4: Formatting Check

- [ ] Citations formatted (Bluebook for legal)
- [ ] Consistent heading styles
- [ ] Footnotes properly numbered

### Step 5: Generate Summary

```markdown
## Polish Complete

**Document**: [title]
**Word count**: [N]
**Sections**: [list]

### Final Checks
- [x] Thesis consistent throughout
- [x] AI anti-patterns addressed
- [x] Citations formatted
- [x] Ready for submission

### Optional Next Steps
- /docx - Export to Word with template
- /pdf - Export to PDF
```

---

## Phase 6: Done (/writing-done)

```markdown
---
name: writing-done
description: Complete writing workflow, clear state.
---

# Writing Complete

## Process

1. Confirm polish is complete:
   - "Have you run /writing-polish?"

2. Archive workflow state:
   - Move .claude/ACTIVE_WORKFLOW.md to .claude/COMPLETED_WORKFLOWS/
   - Timestamp the file

3. Summary:
   ```
   Writing workflow complete.

   Artifacts:
   - PRECIS.md (thesis and scope)
   - OUTLINE.md (structure)
   - [draft files]

   Workflow cleared. Ready for new project.
   ```
```

---

## Skill Composition

### How domain skills load base

In each domain skill (writing-legal, writing-econ):

```markdown
---
name: writing-legal
includes:
  - writing
  - ai-anti-patterns
---

# On Skill Load

**Step 1: Load base rules**
Read("${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md")

**Step 2: Load domain rules** (this file)

**Step 3: Register ai-anti-patterns for polish**
(Automatically loaded when /writing-polish runs)

**Step 4: Set up workflow state if not exists**
If no ACTIVE_WORKFLOW.md and PRECIS.md exists:
  → Create ACTIVE_WORKFLOW.md with current project context

If no PRECIS.md:
  → Suggest: "No PRECIS.md found. Run /writing-brainstorm first?"
```

### Workflow state after compact

Hook in `SessionStart:compact`:

```python
# Check for active writing workflow
if os.path.exists(".claude/ACTIVE_WORKFLOW.md"):
    # Re-read the skill stack
    workflow = parse_yaml(".claude/ACTIVE_WORKFLOW.md")
    for skill in workflow["skill_stack"]:
        print(f"Re-loading: {skill}")
        # Inject Read commands for each skill
```

---

## Summary: Parallel to Dev Workflow

| Dev | Writing |
|-----|---------|
| /dev (entry) | /writing-brainstorm (entry) |
| SPEC.md | PRECIS.md |
| PLAN.md | OUTLINE.md |
| dev-implement | draft/edit loop |
| dev-debug (ralph loop) | /writing-verify (recursive) |
| dev-review | /writing-polish |
| dev-verify | /writing-done |
| TDD: test first | Outline first: structure before prose |
| Subagents for code | User for content decisions |

---

## Open Questions

1. **Automatic vs suggested verification**: Current sketch suggests after N edits. Should any verification be automatic?

2. **Section granularity**: Do we track per-section status, or just overall phase?

3. **Multi-part documents**: How to handle projects with multiple Parts (like proxy advisors)?

4. **Readwise integration**: Should /writing-verify check if sources from OUTLINE.md are actually cited?

5. **Hook frequency**: What's the right N for "suggest verify after N edits"?
