---
description: Writing edit loop - verify structure, check anti-patterns, polish, and complete workflow
allowed-tools: Read, Edit, Write, Bash, Skill
---

# Writing Edit

The edit loop for writing projects. Verifies structure, checks for AI anti-patterns, applies domain-specific rules, and completes the workflow when all checks pass.

## IRON LAW: Critique Over Comfort

**If the writing has problems, SAY SO. Being nice is LYING to the user.**

### Red Flag Detection

If you catch yourself thinking:
- “This is pretty good overall” - STOP. Find the weakness.
- “I don’t want to be too harsh” - STOP. Harsh is kind.
- “The author probably knows what they’re doing” - STOP. Check anyway.

### Rationalization Table

| Excuse | Reality |
|--------|---------|
| “It’s a draft, I’ll be gentle” | Drafts need MORE critique, not less |
| “The main point is clear enough” | “Clear enough” means unclear |
| “I’ll focus on positives first” | Positives don’t help improve writing |

## When to Use

- After drafting prose, to verify and polish
- When hook suggests it (after ~10 edits)
- Before finishing a writing project

## Process

### Step 1: Load Context

```
Read(“.claude/ACTIVE_WORKFLOW.md”)
Read(“.claude/PRECIS.md”)
Read(“.claude/OUTLINE.md”)
Read([current draft files in drafts/])
```

If any file is missing, report and suggest starting with `/writing`.

### Step 2: Structure Verification

Check the document against PRECIS.md and OUTLINE.md:

#### Document Level
- [ ] All sections present from OUTLINE.md
- [ ] Thesis thread consistent throughout
- [ ] All claims from PRECIS.md addressed
- [ ] All counterarguments from PRECIS.md confronted
- [ ] No contradictions between sections
- [ ] Scope matches PRECIS.md (IN/OUT honored)
- [ ] Hook delivered as specified
- [ ] Conclusion follows from argument

#### Section Level
- [ ] Each section delivers what heading promises
- [ ] Sections advance claims from PRECIS.md
- [ ] Logical flow between paragraphs
- [ ] Transitions connect sections

#### Paragraph Level
- [ ] Topic sentences state main points
- [ ] Paragraphs develop single ideas
- [ ] Bridge sentences connect paragraphs

### Step 3: AI Anti-Patterns Check

Load and apply the AI anti-patterns skill:

```
Read(“${CLAUDE_PLUGIN_ROOT}/skills/ai-anti-patterns/SKILL.md”)
```

Scan for:

#### Sycophantic Patterns
- [ ] No “Great question!” or similar
- [ ] No excessive hedging
- [ ] No unnecessary validation

#### Hollow Emphasis
- [ ] No overuse of “crucial”, “vital”, “essential”, “Moreover”
- [ ] No “It is important to note that...”
- [ ] No “This is particularly significant because...”

#### Structure Issues
- [ ] Prose paragraphs, not bullet lists (unless data)
- [ ] No generic conclusions (“In conclusion, we have seen...”)
- [ ] No filler transitions (“Moving on to the next point...”)

#### Voice and Style
- [ ] Active voice predominant
- [ ] Concrete nouns and strong verbs
- [ ] No weasel words (“some argue”, “it could be said”)

### Step 4: Domain-Specific Check

Based on `style` in ACTIVE_WORKFLOW.md:

#### If Legal (Volokh)
- [ ] Hook is concrete problem, not “This article discusses...”
- [ ] All claims confront counterarguments
- [ ] No secondary source citations for primary sources
- [ ] Background section does not exceed proof section
- [ ] Precedents synthesized, not summarized case-by-case

#### If Economics (McCloskey)
- [ ] No boilerplate opening (“This paper discusses...”)
- [ ] No table-of-contents paragraph
- [ ] One word per concept (no elegant variation)
- [ ] Tables/figures before prose description

#### If General (Strunk & White)
- [ ] Omit needless words achieved
- [ ] Active voice throughout
- [ ] Concrete and specific language
- [ ] Positive form (say what is, not what isn’t)

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

### Structure Verification
- [x] All sections present
- [x] Thesis consistent
- [x] Claims addressed: 3/3
- [x] Counterarguments: 2/2

### AI Anti-Patterns
- [x] No sycophantic patterns
- [x] No hollow emphasis
- [ ] Found 2 instances of “crucial” - revise

### Domain Check
- [x] Concrete hook
- [x] Counterarguments confronted

### Formatting
- [x] Citations formatted
- [x] Headings consistent

### Status: [PASS | ISSUES FOUND]
```

### Step 7: Branch Based on Results

#### If Issues Found

Update `.claude/ACTIVE_WORKFLOW.md`:

```yaml
phase: edit
edits_since_verify: 0
```

Report issues with suggested fixes:
- **Minor issues**: “Address issues above, then re-run `/writing-edit`.”
- **Major issues**: “Significant revisions needed. Fix and re-run `/writing-edit`.”

#### If All Checks Pass → Complete Workflow

Archive workflow state:

```bash
mkdir -p .claude/completed-workflows
mv .claude/ACTIVE_WORKFLOW.md “.claude/completed-workflows/$(date +%Y-%m-%d)-writing.md”
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

Announce:

```
Writing workflow complete. All checks passed.

The workflow has been archived to .claude/completed-workflows/.
PRECIS.md and OUTLINE.md remain for reference.

To start a new writing project, use /writing.
```
