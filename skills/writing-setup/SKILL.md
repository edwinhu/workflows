---
name: writing-setup
description: Internal skill for creating PRECIS.md, OUTLINE.md, and ACTIVE_WORKFLOW.md. Called after brainstorm sources are gathered.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Agent|Bash"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/LIT_REVIEW_COMPLETE.md
            GATE_STATUS=APPROVED
            GATE_BLOCKED_TOOLS=Write,Edit,Agent,Bash
            GATE_DESCRIPTION="Lit review completion"
            GATE_REMEDY="Return to writing-lit-review: materialize sources into references/, run gap analysis, then write .planning/LIT_REVIEW_COMPLETE.md"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
  PostToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/writing-precis-guard.py"
---

# Writing Setup

Create the project foundation: PRECIS.md (thesis, audience, claims), OUTLINE.md (document structure), and ACTIVE_WORKFLOW.md (state tracking).

**Prerequisites:** Brainstorm and lit review complete. User has confirmed topic, angle, and audience. Sources materialized in `references/` (PDFs + markdown).

## Session Resume Detection

Before starting, check for an existing handoff:

1. Check if `.planning/HANDOFF.md` exists
2. **If found:** Read it and present to user:
   - Show the phase, section in progress, and Next Action
   - Ask: "Resume from handoff, or start fresh?"
   - If resume: skip to the recorded step
   - If fresh: proceed normally
3. **If not found:** Proceed normally

## Shared Enforcement

Auto-load all constraints matching `applies-to: writing-setup`:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py writing-setup`

**You MUST have these constraints loaded before proceeding. No claiming you "remember" them.**

## Setup Flowchart (This IS the Spec)

```
START (brainstorm confirmed)
  │
  ├─ Step 1: Create project directories
  │  └─ mkdir outlines/ drafts/ references/ scratch/ .planning/
  │
  ├─ Step 2: Interview → Create PRECIS.md
  │  ├─ Ask thesis question
  │  ├─ Ask counterargument question
  │  └─ Write .planning/PRECIS.md (thesis, claims, audience, scope)
  │
  ├─ Step 2b: PRECIS Review Gate
  │  └─ Dispatch writing-precis-reviewer subagent
  │     ├─ APPROVED → proceed to Step 3
  │     └─ ISSUES_FOUND → fix PRECIS.md → re-dispatch (max 5)
  │
  ├─ Step 3: Create OUTLINE.md
  │  ├─ Step 3a: Load the DOMAIN structure template FIRST (writing-{domain} → its
  │  │           document-structure section; domain is already pinned in PRECIS Step 2)
  │  └─ Map sections → claims from PRECIS, CONFORMING to that structure template
  │     Each section has: Goal, Claim, Key Points, Transition
  │
  ├─ Step 4: Confirm domain (already pinned in PRECIS; do NOT re-detect after the outline)
  │
  ├─ Step 5: Create ACTIVE_WORKFLOW.md
  │
  └─ GATE: All 3 files exist with required content?
     ├─ NO → Report missing content, fix before proceeding
     └─ YES → IMMEDIATELY load writing-outline (no pause)
```

If text and flowchart disagree, the flowchart wins.

<EXTREMELY-IMPORTANT>
## The Iron Law of Progressive Expansion

**NO OUTLINE WITHOUT PRECIS. NO DRAFTING WITHOUT OUTLINE. This is not negotiable.**

The levels are:
1. PRECIS.md (thesis, claims, audience)
2. OUTLINE.md (structure mapped to claims)
3. Section outlines in outlines/ (detailed per-section)
4. Prose drafts in drafts/ (expanded from outlines)

Skipping levels produces incoherent documents. Each level expands the previous.
</EXTREMELY-IMPORTANT>

## Step 1: Create Project Structure

```bash
mkdir -p outlines drafts references scratch .planning
echo "scratch/" >> .gitignore
touch references/sources.bib
# Seed the append-only decision log (standard state file — see writing-learnings-log.md)
[ -f .planning/LEARNINGS.md ] || printf '# Learnings — decision log\n\nAppend-only. One terse dated bullet per notable decision (angle, rejected framings, R4 restructurings, accepted gaps). Never rewrite.\n\n' > .planning/LEARNINGS.md
```

After writing PRECIS.md, append the scope decisions (claims cut, In/Out boundary) to `.planning/LEARNINGS.md` — these are the choices a resuming session cannot reconstruct from PRECIS alone.

The `references/sources.bib` file is the single source of truth for every
citation. Drafts use pandoc cite-keys (`[@authorYEAR]`) and pandoc-citeproc
renders them in Bluebook style (via the CSL configured in `ACTIVE_WORKFLOW.md`).
Populate the .bib during brainstorm/research — see
`sources_md_to_bib.py` in this skill's `scripts/` directory if you have an
existing `sources.md` to convert.

## Step 2: Create PRECIS.md

### Interview for PRECIS

Use `AskUserQuestion` to gather remaining details:

```
AskUserQuestion(questions=[
  {
    "question": "What is your thesis in one sentence?",
    "header": "Thesis",
    "options": [
      {"label": "I have a thesis", "description": "I will type it"},
      {"label": "Help me find it", "description": "Synthesize from sources"},
      {"label": "Critique: X is wrong", "description": "Argue against existing view"},
      {"label": "Propose: X should change", "description": "Recommend reform"}
    ],
    "multiSelect": false
  },
  {
    "question": "What is the strongest objection to your thesis?",
    "header": "Counter",
    "options": [
      {"label": "I know it", "description": "I will describe the objection"},
      {"label": "Find from sources", "description": "What do critics say?"},
      {"label": "Steel-man for me", "description": "Generate the best counter"}
    ],
    "multiSelect": false
  }
])
```

### PRECIS.md Template

Write to `.planning/PRECIS.md`:

```markdown
# Precis: [Working Title]

## Thesis
[One sentence - the core argument]

## Audience
[From earlier interview - who is reading, what they know/believe]

## Purpose
[What reader should think/do/believe after reading]

## Hook
[Concrete problem, controversy, or question that opens the piece - draft or TBD]

## Key Claims
- **CLAIM-01**: [Claim 1] → supports thesis by...
- **CLAIM-02**: [Claim 2] → supports thesis by...
- **CLAIM-03**: [Claim 3] → supports thesis by...

## Counterarguments to Address
1. **[Objection]**: [description]
   - Response: [how we will address it]
   - Section: [where it appears]

## Scope
### In
- [What we cover]

### Out
- [What we explicitly exclude and why]

## Domain
[legal | econ | general] → determines which writing skill to use
```

## Step 2b: PRECIS Review Gate

After writing PRECIS.md, dispatch the precis reviewer BEFORE creating the outline. Do NOT skip this step.

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-precis-reviewer/SKILL.md` and follow its instructions.

Follow the reviewer skill instructions: dispatch the subagent, handle APPROVED/ISSUES_FOUND, fix and re-review up to 5 times. Only proceed to Step 3 when the reviewer returns APPROVED.

## Step 3: Create OUTLINE.md

Structure the argument with sections mapped to claims from PRECIS.md.

<EXTREMELY-IMPORTANT>
### Step 3a: Load the domain's document-structure template FIRST (before building structure)

**NO MASTER OUTLINE WITHOUT THE DOMAIN STRUCTURE TEMPLATE IN CONTEXT. This is not negotiable.**

The master `## Structure` you build here commits the article's section flow — and the canonical
flow lives in the **domain skill**, not this skill. Building the outline before reading it means
the structure is set one-to-two phases before its own template is ever in context (the
phase-ordering defect: the domain was only loaded at draft/review). The `## Domain` field is
already pinned in PRECIS.md (Step 2), so read the matching domain skill's structure section NOW:

| Domain (from PRECIS) | Read this structure section |
|---|---|
| legal | `${CLAUDE_SKILL_DIR}/../../skills/writing-legal/SKILL.md` → **"Law Review Article Structure"** (Introduction → Background → Proof of the Claim → Conclusion) |
| econ | `${CLAUDE_SKILL_DIR}/../../skills/writing-econ/SKILL.md` → its document-structure section (hook-with-finding → … → conclusion) |
| general | `${CLAUDE_SKILL_DIR}/../../skills/writing-general/SKILL.md` → its structure guidance |

Build the master `## Structure` so its sections CONFORM to that template (e.g. for legal: an
Introduction, a Background that does not exceed the Proof, a Proof-of-the-Claim core, a
Conclusion). If the argument needs to deviate from the canonical flow, that is an R4 decision —
note it in LEARNINGS.md, don't drift silently.

### OUTLINE.md is a MACHINE-EXECUTABLE SPEC (born-canonical)

`scripts/writing/writing_section_index.py` parses OUTLINE.md to build the section set the
draft and review engines run on (and `writing-outline-executable-guard.py` gates approval on
it). Two blocks are **load-bearing and must be emitted in this exact shape** — get them right
here and the outline is born-canonical (the guard goes strict; nothing relies on tolerant
regex papering over drift):

1. **`## Structure`** — one `### <Section Name>` per section, IN DOCUMENT ORDER. The heading
   text MUST equal the section's outline/draft **filename stem** (the parser pairs
   `### Part I. Foo` ⇄ `outlines/Part I. Foo.md` ⇄ `drafts/Part I. Foo (Draft).md`). Do NOT
   prefix with bare roman numerals like `### I. Introduction` unless the files are named that
   way — use the real section names (`### Introduction`, `### Part I. <Name>`, `### Conclusion`).
2. **`## Claim → Section Map`** — the CANONICAL claim→section assignment (the spec the ⊇ gate
   reads). Each claim has ONE primary home (a section, by `Part` numeral `II.A` or section
   name); Intro/Conclusion are echo-only. A section's draft must `implements: ⊇` the claims
   primary-homed to it.
</EXTREMELY-IMPORTANT>

### OUTLINE.md Template

```markdown
# Outline: [Title from PRECIS]

## Structure

### Introduction
- **Goal**: Hook reader, state thesis, roadmap
- **Thesis**: [from PRECIS]
- **Claims preview**: CLAIM-01 → CLAIM-0N

### Part I. [Section Name]
- **Goal**: [what this section accomplishes]
- **Implements**: [CLAIM-01, CLAIM-02 — the claims primary-homed here, from the map below]
- **Key points**:
  - Point A — [@bibkey or specific authority]  (pin a real source per substantive claim)
  - Point B — [@bibkey]
- **Transition to next**: [how it leads to the next section]

### Part II. [Section Name]
- **Goal**: [what this section accomplishes]
- **Implements**: [CLAIM-XX]
- **Key points**:
  - [points, each with a pinned source]

### Conclusion
- **Goal**: Restate thesis with earned authority; synthesize CLAIM-01 … CLAIM-0N
- **Implications**: What follows from this argument

## Claim → Section Map
| Claim | Primary home | Setup / echo |
|-------|--------------|--------------|
| CLAIM-01 ([gloss]) | Part I.A | Introduction |
| CLAIM-02 ([gloss]) | Part II.A | Part I.B |
| CLAIM-0N ([gloss]) | Part II.B | Conclusion |

## Key Sources
[Deduplicated from search phase]

## Open Questions
[Gaps to address before drafting]
```

## Step 4: Confirm Domain (already pinned in PRECIS — do NOT re-detect after the outline)

The domain is set in PRECIS.md's `## Domain` (Step 2) and was used to load the structure template
in Step 3a — it must be known BEFORE the outline, not detected after it. Here, just **confirm** the
PRECIS domain matches the source/topic indicators and **record** it for ACTIVE_WORKFLOW.md. If the
indicators contradict the PRECIS domain, that is a Step-2 error — fix PRECIS and re-run Step 3a, do
not silently proceed with an outline built against the wrong structure template.

| Domain Indicators | Style | Skill |
|---|---|---|
| Legal cases, statutes, law reviews, constitutional | legal | writing-legal |
| Economics, markets, policy, data, empirical | econ | writing-econ |
| General/other | general | writing-general |

## Step 5: Create ACTIVE_WORKFLOW.md

Create `.planning/ACTIVE_WORKFLOW.md` to track workflow state:

```yaml
---
workflow: writing
style: [legal|econ|general]
phase: outline
project_root: [current directory]
bibliography: references/sources.bib
precis: .planning/PRECIS.md
outline: .planning/OUTLINE.md
current_part: [if multi-part document]
edits_since_verify: 0
verify_threshold: 10
skill_stack:
  - writing
  - writing-[domain]
# Optional — set if the project has an NLM notebook populated with source PDFs
# titled by their bibkeys. Enables the cite-fidelity pipeline.
nlm_notebook: [UUID or omit if no notebook]
nlm_url: [https://notebooklm.google.com/notebook/UUID or omit]
---
```

## Step 5b: Source Inventory (if NLM notebook is set)

If `nlm_notebook` is populated and the notebook already contains the project
sources titled by their bibkeys, build the source inventory now so drafting
can disambiguate same-author works:

```bash
uv run ${CLAUDE_SKILL_DIR}/../../scripts/cite-fidelity/nlm_source_inventory.py
```

This writes `references/source_summaries.md` — a per-bibkey thesis,
supports, and does-not-support summary keyed by NLM `LAST UPDATED`
timestamp. The script is idempotent and safe to re-run after any source
update. See `references/constraints/cite-fidelity-source-inventory.md` for
when to run it and when to skip.

**Skip this step if:** the project has no NLM notebook, or the notebook
is empty / sources aren't yet titled by bibkey.

## Step 6: Announce Handoff

```
Writing project initialized.

Project: [directory name]
Style: [legal/econ/general]
Phase: outline

Files created:
- .planning/PRECIS.md (thesis, audience, claims)
- .planning/OUTLINE.md (structure)
- .planning/ACTIVE_WORKFLOW.md (workflow state)

Next: Create detailed section outlines.
```

---

## Gate: Exit Setup

Before proceeding to outline phase (see `constraints/gate-function-standard.md` for the full 6-step gate including SUMMARY):

1. **IDENTIFY**: What proves setup is complete?
   - `.planning/PRECIS.md` exists with thesis, claims, audience
   - `.planning/OUTLINE.md` exists with sections mapped to claims
   - `.planning/ACTIVE_WORKFLOW.md` exists with style and phase
2. **RUN**: Read each file
3. **READ**: Check content
   - PRECIS has non-empty Thesis, Key Claims, Audience, Domain
   - OUTLINE has sections with Goals and Claim references
   - ACTIVE_WORKFLOW has `workflow: writing` and valid `style:`
4. **VERIFY**: All three files exist and contain required content
5. **CLAIM**: Only if steps 1-4 pass, proceed to outline phase. **Gate type: `human-verify` — auto-advance to writing-outline.**
6. **SUMMARY**: Append phase summary to `.planning/PHASE_SUMMARY.md` (see `constraints/phase-summary-frontmatter.md`):
   - phase: setup
   - artifacts_produced: [PRECIS.md, OUTLINE.md, ACTIVE_WORKFLOW.md, PRECIS_REVIEWED.md]
   - implements: [all CLAIM-XX ids defined in PRECIS — the requirement→phase trace]
   - provides: [.planning/PRECIS.md, .planning/OUTLINE.md, .planning/ACTIVE_WORKFLOW.md]
   - Include substantive one-liner (NOT "Setup complete")

**Skipping PRECIS verification is NOT HELPFUL — the user builds an entire document on a vague thesis that collapses under scrutiny.** A vague thesis is not a thesis. Placeholder claims are not claims.

## Red Flags

- About to create OUTLINE.md before PRECIS.md → STOP. Structure without a thesis is incoherent; write the PRECIS first.
- About to skip the thesis interview → STOP. That produces a document without an argument; ask the thesis questions.
- About to set the domain without checking source indicators → STOP. Wrong domain means wrong style rules loaded for every later phase; check the domain detection table.
- About to create ACTIVE_WORKFLOW.md without PRECIS and OUTLINE → STOP. Workflow state without its foundation artifacts is meaningless; create them first.
- About to rush PRECIS to get to drafting → STOP. A thin PRECIS yields a thin argument and high rework; invest the time now.

## Next Phase

After setup is complete, IMMEDIATELY proceed to the outline phase. Do NOT pause to ask the user. Do NOT summarize what you just created. Load the next skill and continue:

Read `${CLAUDE_SKILL_DIR}/../../skills/writing-outline/SKILL.md` and follow its instructions.

Then follow its instructions immediately to create detailed section outlines.
