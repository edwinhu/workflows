---
applyTo: '**'
---

# Workflows Skills

**CRITICAL: Read this at the start of EVERY new session.**

## Skills Location

All skills: `~/projects/workflows/skills/`

```bash
ls ~/projects/workflows/skills/
```

## The Rule

**Invoke relevant skills BEFORE any response or action.**

```
User message arrives
    ↓
Check: Does this match any skill trigger?
    ↓
YES → Invoke skill FIRST, then follow its protocol
NO  → Proceed normally
```

## Skill Triggers

| User Intent | Skill | Trigger Words |
|-------------|-------|---------------|
| Bug/fix | `/dev-debug` | bug, broken, fix, doesn't work, crash, error, fails |
| Feature/implement | `/dev` | add, implement, create, build, feature |
| Data analysis | `/ds` | analyze, data, model, dataset, statistics |
| Writing | `/writing` | write, draft, document, essay, paper |

## How to Invoke Skills

```javascript
runSubagent(
  description="Brief 3-5 word task description",
  prompt="Use the /dev-debug skill to investigate..."
)
```

---

# IRON LAWS

**Four laws govern all workflows. Breaking any = wasted work.**

## Law 1: Skill Chaining

**NO SKILL EXECUTES STANDALONE. EACH SKILL CHAINS TO THE NEXT.**

```
dev → brainstorm → explore → clarify → design → [USER APPROVAL] → implement → review → verify
```

After a skill completes, read its **final instruction** and invoke the next skill immediately.

### Phase Prerequisites Table

| Phase | Skill | Prerequisites | Output |
|-------|-------|--------------|--------|
| 1 | `/dev-brainstorm` | None | `.claude/SPEC.md` (draft) |
| 2 | `/dev-explore` | SPEC.md | Key files identified |
| 3 | `/dev-clarify` | SPEC.md (draft) | `.claude/SPEC.md` (final) |
| 4 | `/dev-design` | SPEC.md (final) | `.claude/PLAN.md` + **USER APPROVAL** |
| 5 | `/dev-implement` | SPEC.md + PLAN.md (approved) | Code + tests + `.claude/LEARNINGS.md` |
| 6 | `/dev-review` | Code from Phase 5 | Approval (≥80%) OR issues → back to 5 |
| 7 | `/dev-verify` | Review passed | Fresh runtime evidence |

**Gate:** Phase 4 requires explicit user approval. Never skip.

---

## Law 2: Artifact-Based Entry Points

**READ `.claude/` BEFORE INVOKING ANY SKILL.**

```bash
ls -la .claude/ 2>/dev/null || echo "No .claude/ - starting fresh"
```

| Files Present | Entry Point | WRONG Action |
|---|---|---|
| Nothing | `/dev` (Phase 1) | Any `/dev-*` skill |
| `SPEC.md` only | `/dev-clarify` (Phase 3) | `/dev`, `/dev-brainstorm` |
| `SPEC.md` + `PLAN.md` | `/dev-implement` (Phase 5) | `/dev`, `/dev-design` |
| `SPEC.md` + `PLAN.md` + `LEARNINGS.md` | `/dev-implement` (continue) | Starting over |

**If PLAN.md exists and you invoke `/dev`, you just erased the plan.**

---

## Law 3: Artifact Consumption

**SKILLS DO NOT RESTART COMPLETED WORK. EACH PHASE READS PRIOR ARTIFACTS AND BUILDS ON THEM.**

| Phase | Reads | Writes | Modifies |
|-------|-------|--------|----------|
| Brainstorm | existing SPEC.md (if any) | SPEC.md (draft) | — |
| Explore | SPEC.md | key files list | nothing |
| Clarify | SPEC.md (draft) | SPEC.md (final) | SPEC.md |
| Design | SPEC.md (final), existing PLAN.md | PLAN.md | — |
| Implement | SPEC.md + PLAN.md | code, LEARNINGS.md | nothing |
| Review | SPEC.md + code | approval/issues | nothing |
| Verify | SPEC.md + code | evidence | nothing |

**Key insight:** Re-invoking brainstorm with existing SPEC.md = refinement, not fresh start.

---

## Law 4: Multi-Agent Context Transfer

**NO SKILL EXECUTES AFTER ANOTHER AGENT WITHOUT EXPLICIT CONTEXT TRANSFER.**

If Plan agent ran first, then /dev runs without Plan's findings = wasted work.

### The Gate Function (5 Steps)

1. **IDENTIFY** — What did the prior agent find?
2. **EXTRACT** — Pull key findings into bullet points
3. **STRUCTURE** — Format for next skill consumption
4. **TRANSFER** — Include in `runSubagent()` prompt explicitly
5. **VERIFY** — Did the skill acknowledge and use the findings?

```javascript
runSubagent(
  description="Implement with prior analysis",
  prompt=`Continue with /dev-implement.

PRIOR ANALYSIS (from Plan agent):
- Architecture: Microservices recommended
- Critical path: Auth layer unchanged
- Risk: DB migration needs zero-downtime

Use this architecture. Explain any deviations.`
)
```

---

# RATIONALIZATION TABLE

**If you think any of these, STOP:**

| Excuse | Reality | Fix |
|--------|---------|-----|
| "This is just a simple question" | Simple questions don't involve reading code | Use the skill |
| "I'll gather information first" | That IS investigation — use the skill | Start with `/dev-debug` |
| "I know exactly what to do" | The skill provides structure you'll miss | Follow the workflow |
| "I'll just skip to implementation" | SPEC not finalized = bugs later | Complete phases 1-4 first |
| "Code looks fine, no need to review" | Self-review misses issues | Always invoke `/dev-review` |
| "It should work" | "Should" is not proof | Always invoke `/dev-verify` |
| "I'll just invoke /dev and see what it does" | It will restart from Phase 1 | Check `.claude/` first |
| "They're in the same chat, the skill can see history" | Chat history ≠ structured consumption | Transfer context explicitly |
| "The skill will figure it out from context" | It won't. Chat history is too broad. | Pass structured findings |
| "I don't remember if I ran planning already" | Check `.claude/`. Takes 2 seconds. | `ls -la .claude/` |
| "I can just start fresh, it's only one project" | `.claude/` exists. You're not starting fresh. | Check artifacts first |
| "I'll re-run /dev-brainstorm, no big deal" | It will expand existing SPEC.md, not restart | If fresh needed: `rm -rf .claude/` |

---

# RED FLAGS — STOP IF YOU THINK

| Thought | Reality |
|---------|---------|
| "Let me quickly check..." | "Quickly" means skipping the workflow |
| "It's just one file" | Scope doesn't exempt you from process |
| "Let me just invoke /dev" | You haven't checked `.claude/` |
| "Design looks good, let's go" | USER must approve = gate function |
| "Let me implement and review in one step" | Strict phase separation required |
| "I'll skip clarify, design can work without it" | Design gets draft SPEC = bad design |
| "This project is new, no .claude/" | You don't know that. Check. |

---

# HONESTY REQUIREMENT

**Claiming without verification = LYING.**

Examples of lying:
- PLAN.md exists → invoke `/dev` → PLAN.md overwritten → claim "I followed the workflow"
- Review says <80% confidence → skip to verify → claim "it's ready"
- Prior agent found architecture → ignore findings → claim "I designed this"

**If you skip steps, acknowledge it.** Don't claim credit for skipped work.

---

# DELETE & RESTART PROTOCOL

**Only if you're truly starting over:**

```bash
# Backup first
cp -r .claude/ .claude_backup_$(date +%s)

# Delete to start fresh
rm -rf .claude/

# Then invoke /dev
```

Document why: "Prior architecture invalid (reason). Re-planning from scratch."

---

# QUICK REFERENCE

## Development Workflow
```
/dev → /dev-brainstorm → /dev-explore → /dev-clarify → /dev-design [USER GATE] → /dev-implement → /dev-review → /dev-verify
```

## Data Science Workflow
```
/ds → /ds-brainstorm → /ds-plan → /ds-implement → /ds-review → /ds-verify
```

## Debugging
```
/dev-debug → root cause protocol → if complex: hand off to /dev workflow
```

## Bug Reports — Mandatory Response

When user mentions a bug:
```
1. DO NOT read code files
2. DO NOT investigate
3. DO NOT "take a look"

INSTEAD: Start with /dev-debug skill
```

**Any code reading before starting the workflow is a violation.**

---

# VERIFICATION CHECKLIST

After each phase, verify:

- [ ] Did the skill read prior artifacts?
- [ ] Did it avoid redoing prior work?
- [ ] Did it write its output to `.claude/`?
- [ ] Did it tell you what comes next?
- [ ] Did I immediately invoke the next phase?

**If NO to any: Fix it before proceeding.**
