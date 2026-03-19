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
| legal | `skills/writing-legal/SKILL.md` |
| econ | `skills/writing-econ/SKILL.md` |
| general | `skills/writing-general/SKILL.md` |

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
6. SUMMARY: Append phase summary with YAML frontmatter to .planning/PHASE_SUMMARY.md (see Phase Summary Frontmatter section)
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

## Context Monitoring

Writing workflows span 6+ phases and multi-section documents. Context exhaustion is the #1 cause of lost work in long sessions.

<EXTREMELY-IMPORTANT>
### The Iron Law of Context Awareness

**NO NEW PHASE WITHOUT SUFFICIENT CONTEXT. This is not negotiable.**

Before starting any phase (especially Draft, Review, Revise), check remaining context:

| Level | Remaining Context | Action |
|-------|------------------|--------|
| **Normal** | >35% | Proceed normally |
| **Warning** | 25-35% | Complete current section/task, then invoke `writing-handoff` |
| **Critical** | ≤25% | Invoke `writing-handoff` IMMEDIATELY — no new work |

**Starting a 5-section draft phase with 20% context remaining produces garbage for the last 3 sections. Handoff now, resume fresh.**
</EXTREMELY-IMPORTANT>

### Rationalization Table — Context Monitoring

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I'm almost done, just one more section" | "Almost done" is the most dangerous state — you'll produce degraded output | Handoff. The next session picks up clean. |
| "Handoff takes too long" | Handoff takes 2 minutes. Redoing 3 botched sections takes hours. | Write the handoff. |
| "I can tell I still have enough context" | You can't reliably self-assess context remaining | Check the signal (response quality, lost details) and err toward handoff |
| "The user wants this done now" | The user wants it done RIGHT. Degraded output wastes more time than a session break. | Handoff is faster than re-doing degraded work. |

---

## Checkpoint Type Classification

Gates in the writing workflow fall into three types. Autonomous mode can auto-advance `human-verify` gates but must pause at `decision` and `human-action` gates.

| Gate | Phase Transition | Type | Notes |
|------|-----------------|------|-------|
| PRECIS reviewer approval | Setup → Outline | `human-verify` | Agent reviewer decides; auto-advanceable |
| Outline reviewer approval | Outline → Draft | `human-verify` | Agent reviewer decides; auto-advanceable |
| Domain/style selection | Entry routing | `decision` | User chooses legal/econ/general |
| Review strategy selection | Review start | `decision` | User chooses sequential vs parallel |
| VALIDATION.md gap decisions | Validate → Review | `decision` | User decides fix vs accept vs restructure for gaps |
| Draft gate (all sections exist) | Draft → Validate | `human-verify` | File existence check; auto-advanceable |
| Review gate (3 levels complete) | Review → Revise | `human-verify` | Artifact completeness check; auto-advanceable |
| Iteration escalation (3+ cycles) | Revise loop | `decision` | User chooses next step when stuck |
| Completion verdict | Revise → Done | `human-verify` | Zero issues in re-review; auto-advanceable |

**Most gates are `human-verify` — the workflow can run autonomously through them.** Only domain selection, review strategy, gap decisions, and escalation require genuine human input.

**Phase skills MUST check this table at each gate.** If the gate type is `human-verify`, auto-advance without pausing. If `decision`, present options and wait. This is how the workflow runs autonomously through 6 of 9 gates while pausing only for genuine choices.

---

## Phase Summary Frontmatter

When completing any phase, produce a structured summary in `.planning/PHASE_SUMMARY.md` (append, don't overwrite):

```yaml
---
phase: [phase-name]
status: completed
sections_affected: [list of section names]
artifacts_produced: [list of files created/modified]
requires: [artifacts this phase consumed]
provides: [artifacts this phase produced]
deviations: {r1: 0, r2: 0, r3: 0, r4: 0}
---

One-liner: [SUBSTANTIVE summary — not "Phase complete" but "Outlined 4 sections mapping 3 PRECIS claims with transition bridges planned"]

## Key Decisions
- [decisions made during this phase]

## Issues Encountered
- [blockers, deviations, or surprises]
```

**Required fields:** `phase`, `status`, `artifacts_produced`, `provides`. One-liner must be substantive.

**Why:** Without structured summaries, handoff and resume require re-reading all changed files. With frontmatter, the next session can reconstruct what happened from `provides`/`artifacts_produced` fields alone.

---

## Requirement Traceability via Claim IDs

PRECIS.md assigns unique IDs to every claim (CLAIM-01, CLAIM-02, etc.). These IDs flow through the entire workflow:

| Artifact | How IDs appear |
|----------|---------------|
| **PRECIS.md** | `CLAIM-01: [claim text]` — unique ID per claim |
| **OUTLINE.md** | `Implements: [CLAIM-01, CLAIM-02]` per section |
| **outlines/*.md** | `Claim Supported: CLAIM-01` per section outline |
| **VALIDATION.md** | `CLAIM-01: COVERED / PARTIAL / MISSING` — full coverage map |
| **REVIEW.md** | Issues reference claim IDs when relevant |

**Without IDs, "we covered the argument" is vague. With IDs, you can verify that CLAIM-01, CLAIM-02, and CLAIM-03 are each addressed with evidence in specific sections.**

---

## Iteration Topology Per Phase

Each phase uses the iteration strategy best suited to its work:

| Phase | Topology | Exit Gate | Escalate When |
|-------|----------|-----------|---------------|
| **Setup** | One-shot + verify | PRECIS reviewer APPROVED | 5 iterations without approval |
| **Outline** | One-shot + verify | Outline reviewer APPROVED | 5 iterations without approval |
| **Draft** | Serial (per section) | All sections pass depth check | 5+ iterations on same section |
| **Validate** | One-shot | VALIDATION.md status = validated | Gaps found (user decision) |
| **Review** | Team (parallel or sequential reviewers) | All 3 levels complete | Reviewers diverge on direction |
| **Revise** | Serial hypothesis (audit-fix loop) | Zero issues in re-review | 3 iterations without convergence |

---

## Autonomous Phase Chaining

The writing workflow supports autonomous execution. Phases chain automatically without human intervention at `human-verify` checkpoints (see Checkpoint Type Classification).

**How it works:**
1. After each phase gate passes, check the checkpoint type
2. `human-verify` gates → auto-advance to next phase (no pause)
3. `decision` gates → pause, present options, wait for user choice
4. After each phase completes, re-read ACTIVE_WORKFLOW.md to catch state changes

**Smart Discuss:** When multiple ambiguities arise within a phase, batch them into a single `AskUserQuestion` call instead of asking sequentially. Present all grey areas at once for one human response.

**Blocker handling:** When execution fails at any point:
- Offer: retry / skip / stop
- If retry fails twice: escalate to user with diagnosis

**This means a typical writing workflow pauses only 3 times for genuine decisions** (domain selection, drafting strategy, review strategy) rather than 9 times for every gate. The reviewer gates, draft completeness gate, and completion verdict all auto-advance.

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
