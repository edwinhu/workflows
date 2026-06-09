---
name: audit-fix-loop
description: "Canonical doctrine for scored iterative improvement, and the generic fallback for ad-hoc 'iteratively improve / audit and fix / grade and improve / hill-climb quality / score and fix' requests that don't map to a domain workflow."
user-invocable: false
---

**Announce:** "Using audit-fix-loop to plan a scored iterative improvement loop."

## What this skill is (and isn't)

`/goal` is the **mechanism**: it re-fires turns and uses a separate-model evaluator to gate exit on a condition it reads from the transcript. This skill is the **doctrine** that tells you how to set a loop up so `/goal` enforces the *right* thing — `/goal` will just as happily enforce a wrong condition.

It is also the **generic fallback**. The domain workflows below are specialized, pre-wired instances of this same doctrine — prefer them when one fits. Use this skill directly only for ad-hoc "improve <arbitrary artifact>" requests that don't map to any of them:

| Domain workflow | Use it instead when… |
|---|---|
| **visual-verify** | improving slides/charts/rendered output (Gemini vision, zero-blocking-defects gate) |
| **bluebook-audit** | correcting Bluebook citations in a DOCX |
| **source-verify** | verifying citations exist + quotes match sources |
| **writing-review / writing-revise** | improving a prose draft |
| **workflow-creator** Mode 3 | hardening a skill/workflow (wc-audit substrate gate) |

<EXTREMELY-IMPORTANT>
## Iron Law 1 — The auditor must not be the fixer

**This is the one thing `/goal` cannot supply.** `/goal` decides *when to exit*; it does not enforce that the *score* came from someone other than the fixer. If the agent that wrote the fix also grades it, you get rubber-stamping — the fixer's opinion of its own work is worthless.

The audit must be structurally independent every iteration: a **fresh subagent** (no fixer context), a **different model** (e.g. Gemini), or a **mechanical checker**. If you ran an audit with the fixer's context, DELETE the result and re-run with a fresh auditor — tainted findings are worse than none.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Iron Law 2 — Gate on the substrate, not on a bare score

**Terminate on the deterministic/categorical substrate going clean + the 0-10 score going FLAT — never on a bare "composite ≥ 9.5".**

The substrate is the convergent signal: **zero CRITICAL and zero HIGH findings outstanding** (and, where the domain has them, mechanical gates pass / citations resolve / zero blocking defects). It monotonically converges and is what "done" actually means.

The 0-10 score is a noisy LLM proxy: it re-rolls ±0.2 each run and regenerates fresh minor findings every pass, so it asymptotes (empirically ~9.0) and never stably crosses 9.5. Chasing it is a treadmill where every fix surfaces a new nit and the last half-point is only buyable by over-engineering the artifact — which makes it *worse*. (See `project_wc_mode3_asymptote`.) Treat the score as an advisory thermometer and a **flatness** check, not the summit.

So the exit condition is: **substrate clean AND score flat (within ±0.2 of the prior turn, at/above your chosen floor)** — or the turn budget elapses. The threshold you pick in Step 1 is a *floor the substrate must clear*, not a bar to grind toward. For a **pure-judgment** scorer with no hard substrate (e.g. prose rhythm), gate on convergence/flat + zero blocking alone — there is no threshold to chase.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## Iron Law 3 — No `/goal` without a plan

**A naive condition like "fix all issues" gives the evaluator nothing concrete to check.** Before setting the `/goal`, identify: (1) the artifact, (2) the scoring surfaces, (3) how the audit stays independent, (4) the substrate gate + score floor. The condition MUST pin completion to external state the auditor writes — `.planning/SCORES.md` (score trend + finding counts) — so the evaluator reads the substrate and the flatness from the transcript, not from your say-so.

If you set a `/goal` without planning, run `/goal clear`, plan via Step 1, and set a new one. No patching a naive condition mid-flight.
</EXTREMELY-IMPORTANT>

## The loop

```
PLAN (Step 1) → /goal <substrate-gate condition pinned to .planning/SCORES.md>
  │
  └─► each turn the evaluator re-fires:
        AUDIT  fresh independent auditor scores the artifact
               → findings → .planning/AUDIT.md ; score + CRITICAL/HIGH counts → .planning/SCORES.md
        DECIDE substrate clean (0 CRITICAL/0 HIGH) AND score flat?  → end turn; evaluator marks done
               substrate dirty, OR score still climbing run-to-run? → FIX
        FIX    apply targeted fixes worst-severity-first (CRITICAL → HIGH → MEDIUM); do NOT self-assess
        → end turn immediately (the /goal refires for re-audit)
```

`/goal` owns the re-firing and the exit decision. You own AUDIT → DECIDE → FIX inside each turn. After fixing, **do not pause to summarize or ask "should I continue?"** — end the turn so the goal refires. The evaluator decides when to stop, not you.

## Step 1: Plan the loop

```
AskUserQuestion(questions=[
  {"question": "What artifact are you improving?", "header": "Artifact", "multiSelect": false,
   "options": [
     {"label": "Writing draft", "description": "Document, essay, paper, or prose"},
     {"label": "Skill or workflow", "description": "SKILL.md / workflow being hardened — prefer workflow-creator Mode 3"},
     {"label": "Visual output", "description": "Slides/charts/rendered docs — use visual-verify instead"},
     {"label": "Citations", "description": "Footnotes / quotes — use bluebook-audit or source-verify instead"}]},
  {"question": "Which scoring surfaces should the audit use?", "header": "Scorers", "multiSelect": true,
   "options": [
     {"label": "AI anti-patterns", "description": "12-category checklist for AI writing indicators"},
     {"label": "Style guide", "description": "Legal / econ / Strunk & White"},
     {"label": "Enforcement patterns", "description": "12 superpowers enforcement patterns (skills/workflows)"},
     {"label": "Source verification", "description": "Citations vs bib + quotes vs sources — use source-verify"}]}
])
```

Redirect to the domain workflow if the artifact is visual / citations / a skill — they already implement this pattern, calibrated.

**Derive the parameters:**

| Parameter | How to derive |
|-----------|--------------|
| Audit method | Fresh subagent reads the scorer's rules (see table), then audits — independence per Iron Law 1 |
| Fix method | Self-edit for small artifacts; parallel subagents for large ones |
| Turn budget | 10 default, encoded as `Stop after N turns` |
| Substrate gate | 0 CRITICAL / 0 HIGH (+ any domain mechanical/categorical gates) |
| Score floor | 9.5/10 default — a floor the substrate must clear, NOT a bar to grind |

| Scorer | Audit method (independence mechanism) |
|--------|---------------------------------------|
| AI anti-patterns | fresh subagent reads `../ai-anti-patterns/SKILL.md` + refs, then audits |
| Style guide | fresh subagent reads the domain skill (writing-legal / -econ / -general), then audits |
| Enforcement patterns | fresh subagent reads `references/enforcement-checklist.md`, scores all 12 |
| Source verification | invoke `Skill(skill="workflows:source-verify")` — mechanical bib grep + quote search |

When multiple scorers are selected, every iteration runs ALL of them and the substrate is the union of their CRITICAL/HIGH findings.

## Step 2: Initialize state files

```bash
mkdir -p .planning
```

**`.planning/AUDIT.md`** (overwritten each iteration) — findings table per scorer: `# | Severity | Finding | Location | Suggestion` (severities CRITICAL/HIGH/MEDIUM/LOW).

**`.planning/SCORES.md`** (append-only) — one row per iteration so the evaluator can read both the substrate and the trend:

```markdown
# Score History
| Iteration | Score | CRITICAL | HIGH | Δ vs prior | Note |
|-----------|-------|----------|------|-----------|------|
| 1 | 6.5 | 3 | 2 | — | baseline |
| 2 | 8.9 | 0 | 0 | +2.4 | substrate clean; not yet flat |
| 3 | 9.0 | 0 | 0 | +0.1 | substrate clean + flat → done |
```

## Step 3: Set the `/goal`

Pin the condition to the substrate (CRITICAL/HIGH counts) **and** score-flatness in `.planning/SCORES.md`:

```
/goal The artifact is substrate-clean — zero CRITICAL and zero HIGH findings outstanding in
.planning/SCORES.md across the selected scorers — AND its score has gone flat (within ±0.2 of the
prior turn, at or above the floor). Audit with a fresh independent auditor, then fix worst-first,
each turn. Stop after 10 turns. Do NOT keep iterating to lift a flat score once substrate-clean.
```

The fresh-auditor prompt (Phase A, every turn):

```
Agent(prompt="""
You are an independent auditor with NO knowledge of any prior fixes.
Read the scoring rules: [SCORER SKILL PATH]
Then audit this artifact: [ARTIFACT PATH]
Output findings EXACTLY as: | # | Severity | Finding | Location | Suggestion |
Severities: CRITICAL, HIGH, MEDIUM, LOW. Be thorough — a clean audit that misses issues is worse
than a harsh one. Do NOT soften findings. Do NOT say "overall good." Then give a 0-10 score.
""", subagent_type="general-purpose")
```

Compile into `.planning/AUDIT.md`, append the row to `.planning/SCORES.md`, then DECIDE → FIX → end turn.

## Loop Facts

- A CRITICAL caused by a measurement artifact still keeps the substrate dirty. Verify it against the real files, then either fix it or neutralize the artifact — waiving it informally ("it's just an artifact") converts the gate back into the honor system, which is claiming the gate without checking it.
- A flat score below the floor with a clean substrate is the domain ceiling / judge noise, not a defect — record the number as the honest reading and stop. Grinding a flat score toward 9.5 over-engineers the artifact and makes it worse (Iron Law 2).
