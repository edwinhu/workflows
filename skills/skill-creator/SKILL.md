---
name: skill-creator
description: "This skill should be used when the user asks to 'create a skill', 'improve a skill', 'add enforcement patterns to a skill', 'audit skill enforcement', 'skill with superpowers patterns', or needs skill creation with behavioral enforcement (Iron Laws, Rationalization Tables, Red Flags). Wraps the built-in skill-creator with superpowers enforcement awareness. Use this INSTEAD of skill-creator:skill-creator when working in the workflows plugin."
---

# Skill Creator (with Superpowers Enforcement)

This skill wraps the built-in `skill-creator:skill-creator` with enforcement pattern awareness from the superpowers framework. It adds an enforcement audit layer to the skill-creator's draft-test-iterate loop.

## When This Skill Applies

All skill creation and improvement work. This skill loads **instead of** the built-in skill-creator because it adds enforcement awareness that the built-in version lacks.

## Process

### Step 1: Classify the Skill

Before drafting, classify the skill being created:

| Type | Description | Enforcement Needs |
|------|-------------|-------------------|
| **Workflow skill** | Multi-phase process (like /dev, /ds, /writing) | High — needs Iron Laws, gates, rationalization tables |
| **Tool skill** | Wraps a tool or API (like readwise, wrds, bluebook) | Medium — needs Red Flags for common misuse |
| **Knowledge skill** | Domain knowledge reference (like ai-anti-patterns) | Low — needs trigger-only descriptions |

This classification determines how much enforcement audit to apply after each draft.

### Anti-Patterns: Read Before Drafting

These are real lessons from production. Read them before writing your first draft.

#### Anti-Pattern 1: Using `${CLAUDE_PLUGIN_ROOT}`

The `${CLAUDE_PLUGIN_ROOT}` environment variable is **NOT available at runtime** in Claude Code plugin contexts. Skills that reference it (e.g., `"${CLAUDE_PLUGIN_ROOT}/scripts/my-script.sh"`) will fail silently or error.

**Instead**, use the cache discovery pattern with absolute paths via glob + sort:

```bash
# Discover and run a script
FSP=$(command ls -d ~/.claude/plugins/cache/MARKETPLACE/PLUGIN/*/scripts/script-name.sh 2>/dev/null | sort -V | tail -1) && "$FSP" args

# Discover and read a reference file
REF=$(command ls -d ~/.claude/plugins/cache/MARKETPLACE/PLUGIN/*/references/file.md 2>/dev/null | sort -V | tail -1) && echo "$REF"
```

Replace `MARKETPLACE` and `PLUGIN` with the actual marketplace and plugin names. The `sort -V | tail -1` picks the latest version.

#### Anti-Pattern 2: Including Implementation Code Directly in SKILL.md

When a skill body contains step-by-step implementation code (create this file, run this command, parse the output with this script), agents memorize the recipe on first read and then **reimplement it inline** in subsequent invocations — bypassing all the skill's enforcement patterns (red flags, rationalization tables, Iron Laws).

No amount of "don't reimplement me" enforcement text can overcome this. The skill is literally a cookbook that says "don't cook this yourself" while printing the full recipe. The agent will always cook.

**The fix:** Extract deterministic multi-step implementations into `scripts/` and have the skill invoke the script. This flips the path of least resistance — running the script becomes easier than hand-rolling the implementation.

**Real example:** The `find-slide-page` skill had Steps 1-3 showing how to create a `query-headings.typ` wrapper file, run `typst query`, and parse JSON output with an inline Python script. Despite having 10 red flag entries and 8 rationalization table entries, agents in every session reimplemented the recipe inline instead of invoking the skill. After extracting to `scripts/find-slide-page.sh`, the skill became a one-liner invocation and the bypass pattern stopped completely.

| Extract to `scripts/` when | Keep inline when |
|---|---|
| Implementation is >10 lines of deterministic code | Implementation requires judgment calls that change per invocation |
| Same sequence of commands repeats every invocation | Code is truly trivial (1-2 lines) |
| Enforcement patterns agents keep bypassing | Skill is a knowledge reference, not a tool wrapper |
| Multiple steps could be a single script call | |

### Step 2: Invoke the Built-in Skill Creator

Use the Skill tool to invoke the built-in skill-creator:

```
Skill(skill="skill-creator:skill-creator")
```

Follow its full process: capture intent, interview, draft SKILL.md, write test cases, run evals, iterate. The built-in skill-creator handles the eval loop — do not reimplement it.

### Step 3: Enforcement Audit (After Each Draft)

After writing or revising the skill draft (and before running test cases), audit it against the superpowers enforcement patterns. Read the enforcement checklist:

Discover and read the enforcement checklist:
```bash
command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/lib/references/enforcement-checklist.md 2>/dev/null | sort -V | tail -1
```
Use the output path with `Read()`.

Then score the draft using the process below.

#### For Workflow Skills (High Enforcement)

Score against all 12 patterns. Use the scoring template from the checklist. Focus on:

1. **Iron Laws** — Does the skill have absolute constraints for high-drift actions? Are they wrapped in `<EXTREMELY-IMPORTANT>` tags with strong framing? If they use soft language ("try to", "should", "consider"), they will be ignored — rewrite with action-masking language.

2. **Rationalization Tables** — Does the skill preempt the agent's excuses? The table must contain *actual excuses the agent generates*, not hypothetical ones. Observe failure modes in test runs, then add entries.

3. **Red Flags + STOP** — Are there pattern interrupts for observable wrong actions? Must target actions ("About to X"), not intentions ("Thinking about X").

4. **Gate Functions** — Does every phase transition have a verifiable exit condition? "Quality is sufficient" is not a gate. "File X contains string Y" is a gate.

5. **Trigger-Only Descriptions** — Does the description contain ONLY trigger phrases? If it contains a process summary, the agent will follow the short description instead of reading the body. This is the single most common skill design mistake.

6. **Drive-Aligned Framing** — Do verification steps use helpfulness-first framing? "Skipping X is NOT HELPFUL — [concrete user harm]" is stronger than "incorrect" or "premature" because it targets the model's strongest drive.

7. **Skill Dependencies** — Does each phase explicitly read and invoke the next phase? Without explicit chaining, the agent will stop and wait.

8. **No Pause Between Tasks** — Does the skill prevent "should I continue?" between tasks?

9. **Delete & Restart** — For protocol violations, does the skill mandate deletion of contaminated work?

10. **Staged Review Loops** — Do implementation sections have review loops with iteration limits?

11. **Flowcharts as Spec** — For complex processes, is there an ASCII diagram that serves as the authoritative definition?

**Critical gaps** = High-drift action + Absent/Weak enforcement. Fix these before running evals.

#### For Tool Skills (Medium Enforcement)

Score against patterns 2, 3, 5, and 10:

- **Rationalization Tables** — What are common misuse patterns? (e.g., using the wrong API endpoint, skipping authentication)
- **Red Flags + STOP** — What wrong actions can the agent take? (e.g., calling a destructive API without confirmation)
- **Trigger-Only Descriptions** — Keep description to triggers only
- **Staged Review Loops** — For multi-step tool interactions, add review after each step

#### For Knowledge Skills (Low Enforcement)

Score against pattern 5 only:

- **Trigger-Only Descriptions** — This is the most important pattern for knowledge skills. If the description summarizes the knowledge, the agent reads the summary instead of the full body.

### Step 4: Reconcile Tensions

The built-in skill-creator's writing advice and superpowers enforcement patterns have a genuine tension:

| skill-creator says | superpowers says | Resolution |
|---|---|---|
| "Explain the why, avoid heavy-handed MUSTs" | "Iron Laws use strongest framing available" | **Both are right for different contexts.** Use "explain the why" for standalone instructions. Use Iron Laws for high-drift actions where the agent will rationalize shortcuts. |
| "Keep the prompt lean" | "Add Rationalization Tables, Red Flags" | **Enforcement patterns go in the skill body, not the description.** Progressive disclosure keeps it lean — move detailed tables to `references/` if SKILL.md exceeds 500 lines. |
| "Generalize from feedback, don't overfit" | "Observe failure modes, add entries to tables" | **Rationalization Tables ARE generalization.** Each entry captures a class of failures, not a specific test case. |

When the built-in skill-creator suggests removing enforcement patterns because they're "not pulling their weight" or are "oppressively constrictive MUSTs," push back if the pattern addresses a real observed failure mode. The test: did an agent actually take the shortcut this pattern prevents? If yes, keep it.

### Step 5: Continue the Eval Loop

Return to the built-in skill-creator's process for running test cases, grading, and iterating. After each iteration's skill revision, re-run the enforcement audit (Step 3) on the updated draft.

During the eval loop, also look for enforcement-specific signals:

- **Agent skipped a step** → needs an Iron Law or Gate Function
- **Agent rationalized a shortcut** → capture the exact excuse in a Rationalization Table
- **Agent went down a wrong path** → add a Red Flag + STOP
- **Agent claimed completion without evidence** → add Drive-Aligned Framing
- **Agent stopped between tasks** → add No Pause Between Tasks

These signals come from reading test run transcripts, not just final outputs.

## References

- **Enforcement checklist**: `lib/references/enforcement-checklist.md` (in plugin root) — Full 12-pattern reference with templates. Discover via: `command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/lib/references/enforcement-checklist.md 2>/dev/null | sort -V | tail -1`
- **Philosophy**: `PHILOSOPHY.md` (in plugin root) — Three pillars (phased decomposition, deterministic gates, adversarial review). Discover via: `command ls -d ~/.claude/plugins/cache/edwinhu-plugins/workflows/*/PHILOSOPHY.md 2>/dev/null | sort -V | tail -1`
- **Built-in skill-creator**: Handles the eval loop (draft → test → grade → iterate → description optimization)
