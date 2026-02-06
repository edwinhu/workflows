---
name: writing-review
description: Internal skill for hierarchical document review. Called after drafting to diagnose structural issues before editing.
---

# Writing Review

Hierarchical bottom-up review that diagnoses structural problems across a drafted document. Produces `.claude/REVIEW.md` — a structured diagnosis consumed by `/writing-edit`.

**Prerequisites:** PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md, and draft files in `drafts/` must exist.

<EXTREMELY-IMPORTANT>
## The Iron Law of Reading

**NO REVIEW WITHOUT READING. Every claim in REVIEW.md must cite specific text from the draft. This is not negotiable.**

If you find yourself writing a review comment without quoting the draft text it refers to:
1. STOP immediately
2. DELETE the comment
3. Go back and READ the draft passage
4. QUOTE the specific text, THEN write your diagnosis

A review that says "transitions could be improved" without citing the actual transition text is useless. A review that says "Section III ends with 'The market has spoken.' and Section IV opens with 'Turning to regulatory concerns...' — no bridge connects the market conclusion to the regulatory pivot" is actionable.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Evidence

**NO PASSES WITHOUT EVIDENCE. Checking a box requires quoting the text that satisfies it. This is not negotiable.**

If you find yourself marking something as "OK" or "no issues found":
1. STOP
2. Quote the specific text that proves it passes
3. Only THEN mark it as passing

"Transitions are smooth" is a lie unless you can quote adjacent section boundaries and explain why they connect. "No repetition found" is a lie unless you compared the argument summaries across all sections.

**Reporting "all checks pass" without evidence for every checkmark is LYING.**
</EXTREMELY-IMPORTANT>

## Rationalization Table

| Excuse | Reality | Do Instead |
|---|---|---|
| "The draft looks good overall" | "Overall" hides section-level rot | Review each section individually |
| "Minor issues aren't worth a full review" | Minor issues compound into incoherent documents | Flag every issue, let writing-edit prioritize |
| "I already read it during drafting" | Drafting context ≠ review context; you miss what you wrote | Read fresh, as a reviewer, not an author |
| "The transitions are fine" | "Fine" without evidence is rubber-stamping | Quote both sides of every boundary |
| "I don't see repetition" | You read linearly; repetition hides across sections | Compare argument summaries side-by-side |
| "The concepts are introduced naturally" | "Naturally" is subjective; track first appearances with line numbers | Build a concept introduction map |
| "This section is self-contained, no cross-section issues" | Self-contained sections don't make a document | Check how it connects to thesis and adjacent sections |
| "I'll be thorough on the important sections" | Every section matters equally in review | Same depth for every section |

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Writing "no issues" for a section without quoting evidence | Rubber-stamping | Quote the text that proves it passes |
| Skipping boundary analysis between sections | Transition problems are the #1 reason for this skill | Compare every adjacent boundary pair |
| Reviewing only the section you think is weakest | Bias blinds you to problems elsewhere | Review ALL sections with equal rigor |
| Writing vague suggestions ("improve flow") | Unactionable for writing-edit | Cite specific text, diagnose specific problem, suggest specific fix |
| Finishing review in under 5 minutes for a multi-section doc | You skimmed | Go back and read properly |
| Copying outline structure as if it were review | Outline compliance ≠ quality review | Check content quality, not just structural match |

---

## Process

### Step 1: Load Context

```
Read(".claude/ACTIVE_WORKFLOW.md")
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
Glob("outlines/*.md")
Glob("drafts/*.md")
```

Verify: every section in OUTLINE.md has both an outline file and a draft file. If any draft is missing, STOP and report — you cannot review what doesn't exist.

### Step 2: Load Domain Skill

Based on `style` in ACTIVE_WORKFLOW.md:

| Style | Action |
|---|---|
| legal | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-legal/SKILL.md")` |
| econ | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-econ/SKILL.md")` |
| general | `Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/writing-general/SKILL.md")` |

The domain skill contains style rules that inform your review criteria. You MUST read it before reviewing.

### Step 3: Choose Review Strategy

```
AskUserQuestion(questions=[
  {
    "question": "How should we review the document?",
    "header": "Strategy",
    "options": [
      {"label": "Sequential (Recommended)", "description": "Review sections one at a time. Best for most documents."},
      {"label": "Agent team (parallel)", "description": "Spawn one reviewer per section for parallel review. Best for long documents (5+ sections). Requires reconciliation."}
    ],
    "multiSelect": false
  }
])
```

---

## Level 1: Section Review

Review each section individually against its outline and PRECIS claims.

### Sequential Mode (Default)

For each section, in document order:

1. **Read the section outline**: `Read("outlines/[Section] (Outline).md")`
2. **Read the section draft**: `Read("drafts/[Section] (Draft).md")`
3. **Identify the PRECIS claim** this section advances
4. **Run the section review checklist** (below)
5. **Produce the boundary summary** (below)
6. **Record all issues** with severity, location, and suggested fix

After completing each section, IMMEDIATELY start the next. Do NOT pause to ask.

### Agent Team Mode (Parallel)

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled. If unavailable, fall back to Sequential.

##### 1. Prerequisites Check

Verify all outlines and drafts exist. If any are missing, STOP.

##### 2. Create Tasks and Enter Delegate Mode

Create one task per section using `TaskCreate`:
- Subject: `Review: [Section Name]`
- Description: section outline path, draft path, PRECIS claim to check

Press **Shift+Tab** to enter delegate mode. The lead coordinates, does NOT review.

##### 3. Spawn Prompt Template

Each teammate receives this self-contained prompt. **Teammates start with a blank conversation and do NOT auto-load skills.** The prompt must be completely self-contained.

**Before spawning, substitute these variables:**
- `SECTION_NAME` → actual section name
- `SECTION_OUTLINE_PATH` → path to outline file
- `SECTION_DRAFT_PATH` → path to draft file
- `PREV_SECTION` → previous section name, or "none"
- `NEXT_SECTION` → next section name, or "none"
- `STYLE` → style value from ACTIVE_WORKFLOW.md
- `PLUGIN_ROOT` → resolved value of `${CLAUDE_PLUGIN_ROOT}`
- `PRECIS_CLAIM` → the specific PRECIS claim this section advances

```
You are reviewing one section of a longer document as part of a review team.
Your job is DIAGNOSIS ONLY — do not rewrite or fix anything.

## Your Assignment
Section: {SECTION_NAME}
Previous section: {PREV_SECTION}
Next section: {NEXT_SECTION}
PRECIS claim this section advances: {PRECIS_CLAIM}

## Iron Laws (Non-Negotiable)

1. **NO REVIEW WITHOUT READING.** Every issue you report must cite specific
   text from the draft. A review comment without a quote is useless.

2. **NO PASSES WITHOUT EVIDENCE.** If you say something is OK, quote the
   text that proves it. "Transitions are fine" without evidence is lying.

## Step 1: Read Context

```
Read(".claude/PRECIS.md")
Read(".claude/OUTLINE.md")
Read("{SECTION_OUTLINE_PATH}")
Read("{SECTION_DRAFT_PATH}")
Read("{PLUGIN_ROOT}/lib/skills/writing-{STYLE}/SKILL.md")
```

## Step 2: Section Review Checklist

For each item, either cite the text that passes OR record an issue:

### Outline Compliance
- [ ] Every subsection from outline has corresponding prose
- [ ] Every piece of evidence from outline appears in draft
- [ ] Word count is in the range the outline implies
- [ ] Section advances its assigned PRECIS claim

### Internal Coherence
- [ ] Topic sentences state paragraph main points
- [ ] Each paragraph develops a single idea
- [ ] Logical flow between paragraphs (no jumps)
- [ ] Bridge sentences connect paragraphs

### Domain Style ({STYLE})
- [ ] Follows domain-specific rules from skill file
- [ ] Register appropriate for audience
- [ ] Citation style correct (if applicable)

### AI Anti-Patterns
- [ ] No sycophantic patterns ("Great question!", hedging)
- [ ] No hollow emphasis ("crucial", "vital", "Moreover")
- [ ] No filler transitions ("Moving on to the next point...")
- [ ] No generic conclusions ("In conclusion, we have seen...")
- [ ] Active voice predominant
- [ ] Concrete nouns and strong verbs

## Step 3: Produce Boundary Summary

This is CRITICAL — the lead uses these to check transitions.

```markdown
## Boundary Summary: {SECTION_NAME}

### Opening
- Assumes from previous: [what concept/context this section assumes was established]
- First sentence: "[quote actual first sentence]"
- Tone: [register — formal, conversational, technical, etc.]

### Closing
- Hands off to next: [what concept the next section should pick up]
- Last sentence: "[quote actual last sentence]"
- Argument state: [where the thesis stands after this section]

### Concepts
- Introduced: [concepts that appear here for the first time]
- Used from earlier: [concepts referenced from prior sections]
- Core terms: [domain terms used, for consistency checking]
```

## Step 4: Record Issues

For each issue found, record:

```markdown
### Issue: [short title]
- **Severity**: critical | major | minor
- **Location**: [section name, paragraph number or quote]
- **Problem**: [what's wrong, with quoted evidence]
- **Suggestion**: [specific actionable fix]
```

Severity guide:
- **critical**: Breaks argument logic, contradicts PRECIS, missing key evidence
- **major**: Weak transitions, unclear topic sentences, style violations
- **minor**: Wording, minor style issues, small structural improvements

## Step 5: Report to Lead

Send your complete review to the lead:
1. Section review checklist (with evidence for each item)
2. Boundary summary
3. Issues list (sorted by severity)

Mark your task complete only after all three are sent.
```

##### 4. Lead Monitoring

While teammates review:
- Watch task list for completion
- If a teammate stalls, message for status
- Do NOT review any sections yourself — coordinate and aggregate only

##### 5. Proceed to Level 2

After ALL teammates complete, the lead collects all boundary summaries and issues, then proceeds to Level 2 (Transition Review).

---

### Section Review Checklist (for Sequential Mode)

For each section, check ALL of the following. Every checkmark needs quoted evidence.

#### Outline Compliance
- [ ] Every subsection from outline has corresponding prose
- [ ] Every piece of evidence from outline appears in draft
- [ ] Word count is in the range the outline implies
- [ ] Section advances its assigned PRECIS claim

#### Internal Coherence
- [ ] Topic sentences state paragraph main points
- [ ] Each paragraph develops a single idea
- [ ] Logical flow between paragraphs (no jumps)
- [ ] Bridge sentences connect paragraphs

#### Domain Style
- [ ] Follows domain-specific rules from loaded skill
- [ ] Register appropriate for audience
- [ ] Citation style correct (if applicable)

#### AI Anti-Patterns
- [ ] No sycophantic patterns
- [ ] No hollow emphasis ("crucial", "vital", "Moreover")
- [ ] No filler transitions
- [ ] No generic conclusions
- [ ] Active voice predominant
- [ ] Concrete nouns and strong verbs

### Boundary Summary Format

<!-- NOTE: This format is duplicated in the agent team spawn prompt above.
     Keep both copies in sync when updating. -->

After reviewing each section, produce this structured summary:

```markdown
## Boundary Summary: [Section Name]

### Opening
- Assumes from previous: [concept/context assumed from prior section]
- First sentence: "[quote actual first sentence of section]"
- Tone: [register]

### Closing
- Hands off to next: [concept for next section to pick up]
- Last sentence: "[quote actual last sentence of section]"
- Argument state: [where the thesis stands after this section]

### Concepts
- Introduced: [first appearances of key concepts]
- Used from earlier: [references to concepts from prior sections]
- Core terms: [domain terms for consistency check]
```

---

## Level 2: Transition Review

After all sections are reviewed (sequential or parallel), compare adjacent boundary pairs.

For each boundary (Section N → Section N+1):

1. **Read Section N's closing** from its boundary summary
2. **Read Section N+1's opening** from its boundary summary
3. **Check planned transition**: Does OUTLINE.md specify how these sections connect? Does the draft deliver it?
4. **Evaluate the bridge**:
   - Does Section N+1's opening acknowledge what Section N established?
   - Is there a logical bridge, or does the reader have to make a leap?
   - Is there a tone/register shift at the boundary?
5. **Check terminology**: Do both sections use the same terms for the same concepts? (Cross-reference the "Core terms" lists)
6. **Verdict**: SMOOTH, ABRUPT, or DISCONNECTED
   - **SMOOTH**: Opening picks up closing naturally; reader doesn't notice the section break
   - **ABRUPT**: Related but the connection is jarring or rushed
   - **DISCONNECTED**: No bridge; reader must infer the connection

Record each transition issue:

```markdown
### Transition: [Section N] → [Section N+1]
- **Verdict**: [SMOOTH | ABRUPT | DISCONNECTED]
- **Section N closes with**: "[last sentence]"
- **Section N+1 opens with**: "[first sentence]"
- **Problem**: [what's missing or jarring]
- **Planned transition** (from outline): [what OUTLINE.md says should happen here]
- **Suggestion**: [specific bridge text or restructuring]
```

---

## Level 3: Document Review

Using all section review data and boundary summaries, check the document as a whole.

### Cross-Section Repetition

1. **Collect argument summaries**: For each section, list the main points made (from Level 1 reviews)
2. **Compare all pairs**: Does any point appear in more than one section?
3. **Distinguish**: Intentional callbacks (acceptable) vs. redundant repetition (issue)
4. **Record duplicates** with both locations and quoted text

```markdown
### Repetition: [topic]
- **First appearance**: [Section X, paragraph N]: "[quoted text]"
- **Repeated in**: [Section Y, paragraph M]: "[quoted text]"
- **Verdict**: [redundant | intentional callback]
- **Suggestion**: [remove from one location / consolidate / differentiate angles]
```

### Concept Introduction Order

1. **Build a concept map**: For each key concept, record its first appearance (section + paragraph)
2. **Check introduction order**: Are concepts introduced before they're used?
3. **Flag late introductions**: Any concept that appears in the conclusion or late sections without setup earlier
4. **Check foreshadowing**: Does the Introduction mention or preview concepts that appear later?

```markdown
### Late Introduction: [concept]
- **First use**: [Section Y, paragraph M]: "[quoted text]"
- **Should have been introduced**: [Section X or Introduction]
- **Suggestion**: [add foreshadowing in Introduction / move first mention earlier]
```

### Thesis Threading

1. **Extract thesis** from PRECIS.md
2. **For each section**: Does it advance the thesis? (Use Level 1 PRECIS claim checks)
3. **Check progression**: Do sections build on each other, or do some repeat the same ground?
4. **Flag drift**: Any section that doesn't connect back to the thesis

### Structural Completeness

1. **All PRECIS claims addressed**: Cross-reference claims list against section reviews
2. **All counterarguments confronted**: Check that each counterargument from PRECIS appears in the draft
3. **Scope honored**: Check that the draft doesn't stray outside PRECIS scope (IN/OUT boundaries)
4. **Hook delivered**: Does the Introduction deliver the hook specified in PRECIS?
5. **Conclusion follows**: Does the Conclusion follow from the argument built across sections?

---

## Step 4: Generate REVIEW.md

Write the complete review to `.claude/REVIEW.md`:

```markdown
# Document Review

**Document**: [title from PRECIS]
**Style**: [legal | econ | general]
**Reviewed**: [date]
**Word count**: [approximate]

## Summary

| Severity | Count |
|----------|-------|
| Critical | [N] |
| Major | [N] |
| Minor | [N] |
| **Total** | **[N]** |

**Verdict**: [ISSUES FOUND | CLEAN]

---

## Document-Level Issues

### Concept Introduction Order
[Issues from Level 3, or "All concepts introduced before use (evidence: [concept map])"]

### Cross-Section Repetition
[Issues from Level 3, or "No redundant repetition found (evidence: [comparison summary])"]

### Thesis Threading
[Issues from Level 3, or "All sections advance thesis (evidence: [per-section claim check])"]

### Structural Completeness
- Claims addressed: [N/N]
- Counterarguments confronted: [N/N]
- Scope honored: [yes/no, with evidence]
- Hook delivered: [yes/no, with evidence]
- Conclusion follows: [yes/no, with evidence]

---

## Transition Issues

### [Section N] → [Section N+1]
- **Verdict**: [SMOOTH | ABRUPT | DISCONNECTED]
- **Closes with**: "[last sentence of Section N]"
- **Opens with**: "[first sentence of Section N+1]"
- **Problem**: [description]
- **Planned transition**: [from OUTLINE.md]
- **Suggestion**: [specific fix]

[Repeat for each boundary]

---

## Section-Level Issues

### [Section Name]

#### Outline Compliance
[Pass/fail with evidence for each item]

#### Coherence
[Issues found, or pass with evidence]

#### Domain Style
[Issues found, or pass with evidence]

#### AI Anti-Patterns
[Issues found, or pass with evidence]

#### Issues
[List all issues for this section, sorted by severity]

[Repeat for each section]

---

## Boundary Summaries

[Raw boundary summaries from Level 1, preserved here as reference data for writing-edit]

### [Section Name]
#### Opening
- Assumes from previous: [...]
- First sentence: "[...]"
- Tone: [...]
#### Closing
- Hands off to next: [...]
- Last sentence: "[...]"
- Argument state: [...]
#### Concepts
- Introduced: [...]
- Used from earlier: [...]
- Core terms: [...]

[Repeat for each section]
```

---

## Gate: Exit Review

Before declaring review complete:

1. **IDENTIFY**: `.claude/REVIEW.md` exists
2. **RUN**: Read REVIEW.md, verify every section from OUTLINE.md has a review entry
3. **READ**: Confirm every issue has severity + location + quoted evidence + suggestion
4. **VERIFY**: All three levels completed (section, transition, document)
5. **CLAIM**: Only if steps 1-4 pass, announce review complete

**If any section is missing from REVIEW.md, the review is incomplete. Go back.**

---

## Step 5: Update Workflow State

Update `.claude/ACTIVE_WORKFLOW.md`:

```yaml
phase: review
review_completed: true
issues_found: [total count]
critical_issues: [critical count]
```

## Step 6: Announce and Suggest Next Step

```
Review complete. Results written to .claude/REVIEW.md.

Found [N] issues ([critical] critical, [major] major, [minor] minor).

[If issues found]:
Run /writing-edit to fix issues from the review.

[If clean]:
No issues found. Run /writing-edit to complete the workflow.
```

---

## Rationalization Table (Review Exit)

| Excuse | Reality | Do Instead |
|---|---|---|
| "I found some issues, that's enough" | Partial review misses the worst problems | Complete ALL three levels |
| "The critical issues are the only ones that matter" | Major issues compound; minor issues signal deeper problems | Record everything |
| "REVIEW.md is getting long" | Long review = thorough review. Short review = lazy review. | Keep going |
| "I'll note this mentally instead of writing it down" | If it's not in REVIEW.md, it doesn't exist for writing-edit | Write it down |
| "This section was written by a good agent, probably fine" | Review the text, not the author | Read and quote |

## Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|---|---|---|
| Writing REVIEW.md without reading all drafts | You're fabricating a review | Read every draft file first |
| Skipping Level 2 (transitions) | Transitions are the primary reason this skill exists | Always run all three levels |
| Recording fewer than 3 issues on a multi-section document | Statistically implausible; you're not looking hard enough | Review more carefully |
| Using vague language ("could be improved") | Unactionable for writing-edit | Quote text, diagnose specifically, suggest specifically |
| Finishing in one pass without re-reading | Reviews need multiple passes to catch different issue types | Run each level as a separate pass |

---

## Next Phase

After review is complete:

Invoke `/writing-edit` to fix issues identified in `.claude/REVIEW.md`.
