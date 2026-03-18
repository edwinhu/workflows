# Writing Workflow: Common Constraints

Shared enforcement for ALL writing skills. Every writing phase skill MUST `Read()` this file before doing work.

**If this file and a phase skill disagree, this file wins.** Phase skills add phase-specific constraints on top of these.

---

## The Progressive Expansion Hierarchy

Writing proceeds through levels of detail. Each level expands the previous. **Never skip levels.**

```
.planning/PRECIS.md          # Level 1: Thesis, claims, audience
       ↓
.planning/OUTLINE.md         # Level 2: Master structure (sections, goals)
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
| **Workflow state** | `.planning/ACTIVE_WORKFLOW.md` | Always |
| **Structural intent** | `.planning/PRECIS.md`, `.planning/OUTLINE.md` | Always |
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

## Post-Subagent Enforcement: Verification vs Investigation Boundary

When a subagent returns (review subagent, draft subagent, outline reviewer), main chat MUST NOT read source files, edit draft content, or "check" quality directly. Only verification actions are allowed.

<EXTREMELY-IMPORTANT>
### The Iron Law of Post-Subagent Boundaries

**AFTER ANY SUBAGENT RETURNS, MAIN CHAT MUST NOT READ DRAFTS OR EDIT PROSE. This is not negotiable.**

This enforcement exists because dev-debug (March 16, 2026) showed that 71 protocol violations occurred when main chat "verified" subagent work by reading source code. The same pattern applies to writing: after a review subagent returns REVIEW.md, main chat must not "verify" by reading the draft, "check the tone", or "quickly fix the intro."

| Verification (main chat CAN do) | Investigation (main chat CANNOT do) |
|----------------------------------|--------------------------------------|
| Check that REVIEW.md exists | Read draft files in `drafts/` |
| Read REVIEW.md for issue count/severity | Edit any prose in `drafts/` or `outlines/` |
| Read ACTIVE_WORKFLOW.md for state | "Check the tone" of a section |
| Read PRECIS.md / OUTLINE.md for structure | "Polish" or "quickly fix" any passage |
| Count files in `drafts/` / `outlines/` | Read source material in `references/` |
| Update REVIEW_STATE.md iteration count | Rephrase, reword, or reorganize sections |
| Invoke the next skill (/writing-revise) | Run ai-anti-patterns checks directly on text |

**The test: If the action requires reading prose content (not metadata), it's investigation. Delegate to a subagent.**

### Why This Exists

The moment main chat reads a draft, it forms opinions about quality. Those opinions bypass the structured review process. Main chat starts "improving" text that the review subagent should be evaluating. This is how structured workflows collapse into unstructured editing sessions.
</EXTREMELY-IMPORTANT>

### Rationalization Table — Post-Subagent Boundary

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "Let me read the draft to understand the review" | REVIEW.md already summarizes the issues with citations | Read REVIEW.md, not the draft |
| "Let me check the tone real quick" | Tone checking IS review work — delegate it | Invoke /writing-review or spawn a subagent |
| "Quick edit to the intro" | Quick edits bypass constraint loading and review | Invoke /writing-revise with full constraint loading |
| "I need to verify the subagent's fixes" | Verification = checking REVIEW.md exists with issues resolved. Reading prose = investigation | Check artifact existence, not content |
| "The review missed something obvious" | If it's obvious, it'll be caught in re-review. If you read the draft, you'll edit it | Spawn a new review subagent |
| "I'll just glance at the opening paragraph" | "Glance" becomes "read" becomes "edit" becomes unstructured session | STOP. Invoke the appropriate skill |

### STOP Triggers — Post-Subagent

If you catch yourself about to do ANY of these after a subagent returns, **STOP immediately**:

- **"Let me read the draft"** — STOP. That's investigation. Invoke /writing-revise.
- **"Let me check the tone"** — STOP. Tone checking is review work. Spawn a review subagent.
- **"Quick edit to the intro"** — STOP. All edits go through /writing-revise with full constraint loading.
- **"Let me verify the changes look right"** — STOP. Check artifact existence (REVIEW.md, draft file count), not content.
- **"I'll just read one section"** — STOP. One section becomes all sections. Subagent.
- **"The subagent's review seems thin, let me supplement it"** — STOP. Spawn a fresh review subagent with stricter instructions.

---

## Topic Change Protocol

<EXTREMELY-IMPORTANT>
### The Iron Law of Topic Changes

**If the user sends a message that is NOT about the current writing workflow, you MUST announce the pause before responding. This is not negotiable.**

This pattern was discovered in dev-debug (March 16, 2026) when a user asked an off-topic question mid-debug-loop. The agent silently abandoned the protocol and never resumed. The user had to re-invoke the workflow.

**Protocol:**
1. Announce: "Pausing writing workflow to address your request."
2. Handle the off-topic request (normal tools allowed — you're outside the workflow)
3. Announce: "Resuming writing workflow. Reading ACTIVE_WORKFLOW.md for current state."
4. Read ACTIVE_WORKFLOW.md, reload constraint layers, continue at current phase

**If the user's message could be interpreted as EITHER a new topic OR part of the writing workflow:**
- Ask: "Is this related to the current writing project, or a separate request?"
- Do NOT assume it's separate and abandon the workflow silently

**Silent workflow abandonment is NOT HELPFUL — the user invoked /writing because they want structured writing. Silently dropping the structure wastes their explicit request and forces them to re-invoke.**

### Rationalization Table — Topic Changes

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The user clearly wants to switch topics" | Maybe, but announce the pause so the loop state is preserved | Announce pause, handle, announce resume |
| "I can handle this quickly and get back" | You'll forget to resume. The workflow dies silently. | Announce the pause explicitly |
| "The workflow is at a natural pause point" | No point is natural enough to silently abandon | Announce even at phase boundaries |
| "I'll remember to come back" | Context compression will erase your intent to resume | Announce resume, read ACTIVE_WORKFLOW.md |
</EXTREMELY-IMPORTANT>

---

## Writing-Specific STOP Triggers

These are the most common rationalizations that cause main chat to bypass the writing workflow structure. Each one feels productive but actually undermines the phased process.

### Red Flags — STOP If You Catch Yourself:

| Action | Why Wrong | Do Instead |
|--------|-----------|------------|
| Reading a draft file outside of a phase skill | Bypasses constraint loading; you'll form opinions and start editing | Load the appropriate skill first |
| "Let me check the tone" without loading domain skill + ai-anti-patterns | Partial evaluation is worse than no evaluation — it creates false confidence | Load ALL constraint layers, then evaluate via the review skill |
| "Quick edit to the intro" without REVIEW.md | Unstructured edits bypass review → revise pipeline | Run /writing-review first, then /writing-revise |
| Editing prose after reading REVIEW.md (skipping /writing-revise) | REVIEW.md is for /writing-revise to consume, not for main chat to act on directly | Invoke /writing-revise |
| "Let me polish this paragraph" mid-workflow | Polish is revision work; doing it ad-hoc bypasses the revision skill's constraint loading | Continue current phase; polish during revision |
| Summarizing a subagent's draft in your own words | You're rewriting, not summarizing. This is investigation disguised as reporting. | Report the subagent returned, invoke next skill |
| "The draft is almost done, let me finish it myself" | "Almost done" is the most dangerous state — you'll skip the remaining phases | Follow the workflow to completion |
| Reading `references/` source material to "verify" claims | Fact-checking IS investigation. Delegate to a review subagent. | Spawn a review subagent with fact-checking instructions |

---

## Drive-Aligned Default

When in doubt about whether to skip a step, ask: **"If I skip this, does the user's published work get worse?"**

If yes, do not skip. The user experiences the quality of the final document, not your sense of completion. Every step you skip to "help faster" chooses YOUR comfort over the USER's outcome.

---

## Deviation Rules

Drafting subagents follow a 4-rule system for unplanned discoveries:

- **R1-R3 (Auto):** Factual errors, missing evidence, and structural blockers are fixed automatically and tracked.
- **R4 (STOP):** Argument restructuring requires user decision — may require OUTLINE.md revision.

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure → R4.

Each section's summary must include a deviation tracking line. This is how we know what changed from the outline.

### Rationalization Prevention (Deviation Rules)

| Thought | Reality |
|---------|---------|
| "This restructuring is minor" | If it changes the argument flow, it's R4. User decides. |
| "I'll note the change later" | Later = never. STOP now, track it. |
| "Adding a section won't change the argument" | New sections shift emphasis and flow. User MUST know. |
| "Tracking deviations interrupts the writing flow" | 30 seconds of tracking prevents hours of "why did the argument change?" |
