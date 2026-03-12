# Writing Workflow: Common Constraints

Shared enforcement for ALL writing skills. Every writing phase skill MUST `Read()` this file before doing work.

**If this file and a phase skill disagree, this file wins.** Phase skills add phase-specific constraints on top of these.

---

## The Progressive Expansion Hierarchy

Writing proceeds through levels of detail. Each level expands the previous. **Never skip levels.**

```
.claude/PRECIS.md          # Level 1: Thesis, claims, audience
       ↓
.claude/OUTLINE.md         # Level 2: Master structure (sections, goals)
       ↓
outlines/Part I.md         # Level 3: Detailed section outline (bullets, sources)
       ↓
drafts/Part I.md           # Level 4: Prose expansion
```

| Iron Law | Means |
|----------|-------|
| NO OUTLINE WITHOUT PRECIS | PRECIS.md must exist before OUTLINE.md creation |
| NO DRAFT WITHOUT OUTLINE | Every section in drafts/ must have a matching outlines/ file |
| NO REVISION WITHOUT REVIEW.md | writing-revise refuses to proceed without structured review diagnosis |

---

## Constraint Loading Protocol

Every phase that touches draft prose MUST load ALL constraint layers before editing. Prior context may be compressed or lost — the midpoint must be self-contained.

### Required Layers

| Layer | What | When |
|-------|------|------|
| **Workflow state** | `.claude/ACTIVE_WORKFLOW.md` | Always |
| **Structural intent** | `.claude/PRECIS.md`, `.claude/OUTLINE.md` | Always |
| **Domain skill** | `writing-legal`, `writing-econ`, or `writing-general` based on `style` in ACTIVE_WORKFLOW | Before any prose work (drafting, reviewing, revising) |
| **AI anti-patterns** | `Skill(skill="workflows:ai-anti-patterns")` | Before any prose work (drafting, reviewing, revising) |

### Domain Skill Loading Table

| Style in ACTIVE_WORKFLOW | Skill to Read() |
|--------------------------|-----------------|
| legal | `lib/skills/writing-legal/SKILL.md` |
| econ | `lib/skills/writing-econ/SKILL.md` |
| general | `lib/skills/writing-general/SKILL.md` |

<EXTREMELY-IMPORTANT>
### Iron Law: Full Constraint Loading

**NO PROSE WORK WITHOUT ALL CONSTRAINT LAYERS. This is not negotiable.**

Editing with only domain skill loaded misses AI anti-patterns. Editing with only ai-anti-patterns loaded misses domain-specific rules. Both layers are required for drafting, reviewing, AND revising.

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I loaded the domain skill, that's enough" | Domain skill doesn't catch AI writing smell | Load ai-anti-patterns too |
| "ai-anti-patterns covers the basics" | It doesn't know legal citation rules or econ style | Load domain skill too |
| "I remember the rules from earlier" | Context may be compressed; you're guessing | Read() the skill files every time |
| "This is just a quick fix" | Quick fixes without constraints introduce new violations | Load constraints, then fix |

**Editing with partial constraints is NOT HELPFUL — the user publishes prose that passes one quality check but fails another.** Both constraint layers exist because each catches problems the other misses.
</EXTREMELY-IMPORTANT>

---

## Flowchart Authority

Every phase skill has a flowchart. **If text and flowchart disagree, the flowchart wins.** The flowchart IS the spec — text is commentary.

---

## No Pause Between Phases

After completing any phase and passing its gate, IMMEDIATELY load the next skill and execute it. Do NOT:
- Ask "should I continue?"
- Summarize what you just did
- Wait for confirmation

**Pausing between phases is procrastination disguised as courtesy.** The gate passed. The user confirmed (where required). Load the next skill.

---

## Gate Function Standard

Every phase exits through a gate. All gates follow this 5-step pattern:

```
1. IDENTIFY: What artifact proves this phase is complete?
2. RUN: Execute the verification (read file, run test, check output)
3. READ: Examine the actual result
4. VERIFY: Does the result match the gate condition?
5. CLAIM: Only if steps 1-4 pass, proceed to next phase
```

**"Looks good" is not verification. "File X contains Y" is verification.** Gates must be evidence-based.

---

## Artifact Review Gates

Artifacts that cross phase boundaries MUST be independently reviewed:

| Artifact | Reviewer | Gate |
|----------|----------|------|
| PRECIS.md | writing-precis-reviewer (subagent) | Before OUTLINE.md creation |
| outlines/*.md | writing-outline-reviewer (subagent) | Before drafting begins |
| drafts/*.md | writing-review (3-level hierarchical) | Before revision begins |

**Self-review is rubber-stamping.** The reviewer must be a fresh subagent with no context from the writing phase.

---

## Progress Gating

**If 5+ iterations on the same artifact without meaningful progress, STOP and escalate to the user.**

Signs you are stuck:
- Rewriting the same section repeatedly without quality improvement
- Cycling between two approaches
- Unable to find evidence for a claimed point
- Reviewer keeps flagging the same issue after "fixes"

**Spinning without progress is anti-helpful.** Recognizing when to ask for guidance is competence, not weakness.

---

## Drive-Aligned Default

When in doubt about whether to skip a step, ask: **"If I skip this, does the user's published work get worse?"**

If yes, do not skip. The user experiences the quality of the final document, not your sense of completion. Every step you skip to "help faster" chooses YOUR comfort over the USER's outcome.
