# GSD Framework Learnings

Reference document capturing patterns from the GSD (get-shit-done) framework for future application to DS and Writing workflows.

---

## 1. State Management (.planning/ directory)

GSD uses a `.planning/` directory at the project root for all workflow state.

**Top-level files:**
- `PROJECT.md` — project description, goals, constraints
- `REQUIREMENTS.md` — enumerated requirements with unique IDs
- `ROADMAP.md` — ordered phases with status tracking
- `STATE.md` — current workflow state (active phase, blockers, decisions)
- `config.json` — model profiles, agent overrides, workflow settings
- `MILESTONES.md` — milestone definitions and completion criteria

**Per-phase subdirectories** (`phases/XX-name/`):
- `CONTEXT.md` — phase background and scope
- `RESEARCH.md` — discovery findings
- `PLAN.md` — implementation plan
- `SUMMARY.md` — post-execution summary with rich frontmatter
- `VERIFICATION.md` — verification evidence
- `VALIDATION.md` — Nyquist validation map

**STATE.md dual-format pattern:**
- YAML frontmatter (machine-readable) synced with markdown body (human-readable)
- Agents read frontmatter for routing; humans read markdown for understanding
- Single source of truth — both representations updated atomically

**Design principles:** file-based, git-trackable, human-editable. No databases, no external services.

---

## 2. Deviation Rules (4-rule system)

Governs when agents can deviate from the approved plan without user approval.

| Rule | Category | Action | Examples |
|------|----------|--------|----------|
| R1 | Bug | Auto-fix | Broken behavior, errors, type errors, security vulnerabilities |
| R2 | Missing Critical | Auto-fix | Missing error handling, validation, auth, CSRF protection |
| R3 | Blocking | Auto-fix | Missing dependencies, wrong types, broken imports |
| R4 | Architectural | ASK USER | New DB tables, schema changes, switching libraries, breaking API changes |

**Priority:** R4 > R1-3 > unsure (defaults to R4)

**Documentation:** All deviations recorded in phase `SUMMARY.md` with `[Rule N - Category]` format, including rationale and what was changed.

---

## 3. Nyquist Validation Framework

Named after the Nyquist sampling theorem — every requirement needs automated verification coverage at a frequency sufficient to catch regressions.

**Process:**
1. Create `VALIDATION.md` mapping requirements to test commands **before code is written**
2. Gap analysis categorizes each requirement:
   - **COVERED** — test exists, passing (green)
   - **PARTIAL** — test exists, failing (needs attention)
   - **MISSING** — no test (must be created)
3. Nyquist auditor agent generates missing tests (max 3 debug iterations per test)
4. Auditor **never fixes implementation bugs** — escalates to executor

**Wave 0 tasks:** Test scaffolding that must exist before any implementation begins. Ensures the verification infrastructure is in place first.

---

## 4. Model Profiles

Four profiles control which model tier each agent uses:

| Profile | Planning/Design | Execution | Exploration |
|---------|----------------|-----------|-------------|
| quality | Opus | Opus | Opus |
| balanced | Opus | Sonnet | Sonnet |
| budget | Sonnet | Sonnet | Haiku |
| inherit | Session model | Session model | Session model |

**Philosophy:**
- Opus for design judgment and ambiguous decisions
- Sonnet for plan-following execution (cheaper, fast, reliable when plan is clear)
- Haiku for read-only exploration and information gathering

**Per-agent overrides** available in `config.json` for fine-tuning costs.

The per-agent profile table worked out from this is [model-profiles.md](model-profiles.md) — still a design note; this repo never built the resolution step.

---

## 5. Autonomous Mode

Chains `discuss → plan → execute` per phase automatically without human intervention.

**Key mechanisms:**
- **Smart Discuss:** Batches table proposals for grey areas instead of asking sequential questions. Presents all ambiguities at once for a single human response.
- **Re-reads ROADMAP** after each phase completes to catch dynamically inserted phases (e.g., phases added during execution of an earlier phase).
- **Pauses at decision points** (typed checkpoints — see section 6).
- **Blocker handling:** retry / skip / stop options when execution fails.
- **Post-execution routing:** Based on verification status, routes to next phase, retry, or human escalation.

---

## 6. Checkpoint Types

Three checkpoint types with dramatically different frequencies:

| Type | Frequency | Description | What happens |
|------|-----------|-------------|--------------|
| `human-verify` | ~90% | Claude did the work, human confirms correctness | Review and approve |
| `decision` | ~9% | Human chooses direction from options with pros/cons | Select from options |
| `human-action` | ~1% | Auth gates, 2FA — truly manual steps only | Human performs action |

**Auto-advance mode:** Auto-approves `human-verify` checkpoints, auto-selects first option for `decision` checkpoints. Only `human-action` still pauses.

**Golden rule:** If Claude CAN automate it, Claude MUST automate it. `human-action` is reserved for things that are genuinely impossible to automate (credentials, physical access, etc.).

---

## 7. Context Monitoring

Prevents agents from starting complex work when context is nearly exhausted.

**Architecture:**
- **Statusline hook:** Visual context bar in the terminal (green → yellow → orange → red based on usage percentage)
- **Bridge file pattern:** Statusline writes JSON to `/tmp/claude-ctx-{session}.json`
- **PostToolUse hook:** Reads bridge file, injects `additionalContext` warnings into agent messages

**Thresholds:**
- WARNING at ≤35% context remaining
- CRITICAL at ≤25% context remaining

**Effect:** Agent receives injected warnings and adjusts behavior (e.g., wraps up current work, triggers handoff instead of starting new phase).

---

## 8. Session Handoff

Enables clean continuation across context windows or sessions.

**Pause mechanism** (`/gsd:pause-work`):
- Creates `.continue-here.md` with: current position, completed work, remaining work, open decisions, blockers, next concrete action
- Creates `HANDOFF.json` (machine-readable) for automated resume
- Dual format: JSON for agent parsing, markdown for human reading

**Resume mechanism:**
- On workflow start, check for handoff files
- If found, restore state and continue from recorded position
- `current-agent-id.txt` tracks interrupted agents for resumption

---

## 9. Summary Frontmatter

Phase summaries use rich YAML frontmatter for machine-readable context assembly.

**Fields:**
- `phase`, `plan`, `subsystem`, `tags` — categorization
- `requires` / `provides` / `affects` — dependency graph between phases
- `tech-stack.added`, `patterns` — technology tracking
- `key-files.created`, `key-files.modified` — file tracking
- `metrics.duration`, `metrics.completed` — timing

**One-liner rule:** Must be SUBSTANTIVE. Good: "JWT auth with refresh rotation using jose". Bad: "Phase complete" or "Implemented authentication".

---

## 10. Agent Specialization

15+ specialized agents with distinct roles and tool restrictions.

**Key pattern:** Verification agents are READ-ONLY (no Write/Edit tools). This prevents them from "fixing" issues they discover, which would bypass the plan-execute-verify cycle.

**Agent types:**
- **Planner** — creates plans from requirements
- **Executor** — implements plans (has Write/Edit)
- **Verifier** — validates execution against plan (READ-ONLY)
- **Plan-checker** — reviews plans for completeness before execution
- **Debugger** — diagnoses failures (limited Write for test fixes only)
- **Researchers** — gather information (READ-ONLY)
- **Auditors** — cross-cutting quality checks (READ-ONLY)

**Execution model:**
- Fresh context per agent — each agent starts clean, receives only relevant state files
- Orchestrator stays thin — routes work, does not accumulate agent context
- Wave-based execution: dependency analysis groups independent plans for parallel execution

---

## 11. Requirement Traceability

End-to-end tracing from requirements through implementation to verification.

**REQUIREMENTS.md format:**
- Unique IDs per requirement (e.g., `AUTH-01`, `AUTH-02`, `DATA-01`)
- Categorized as `v1` / `v2` / `out-of-scope`

**Tracing chain:**
1. Requirements get unique IDs in `REQUIREMENTS.md`
2. Plans reference requirement IDs in frontmatter (`implements: [AUTH-01, AUTH-02]`)
3. Verification maps requirements to evidence (test results, manual checks)
4. Milestone audit checks all v1 requirements are satisfied before milestone is marked complete

---

## 12. Applicability to DS/Writing Workflows

Brief notes on how each pattern could map to existing plugin workflows.

**Data Science:**
- Nyquist validation → verify analysis outputs match spec (row counts, schema, statistical properties)
- Deviation rules → handle data pipeline surprises (unexpected nulls, schema drift, missing files)
- State management → track multi-notebook analysis progression
- Agent specialization → separate data exploration, transformation, and validation agents

**Writing:**
- State folder → track drafts, outlines, revision history
- Deviation rules → manage scope creep (new sections, tangential research)
- Handoff → multi-session documents that span context windows
- Summary frontmatter → track document structure and revision decisions

**Both workflows:**
- Model profiles → right-size model selection per task complexity
- Session handoff → clean continuation across sessions
- Context monitoring → prevent degraded output when context is exhausted
- Checkpoint types → distinguish automated checks from human judgment calls
