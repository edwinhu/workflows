---
name: skill-creator
description: "This skill should be used when the user asks to 'create a skill', 'improve a skill', 'edit a skill', 'add a skill to a plugin', 'add enforcement patterns', 'add Iron Laws or fact rows', 'fix a skill description', 'audit skill enforcement', or needs to substantially create or edit any SKILL.md file — including a single skill inside a plugin. Use plugin-creator only for plugin-level work (manifest, hooks wiring, multi-component scaffolding)."
---

# Skill Creator (with Superpowers Enforcement)

This skill wraps the built-in `skill-creator:skill-creator` with enforcement pattern awareness from the superpowers framework. It adds an enforcement audit layer to the skill-creator's draft-test-iterate loop.

**A path-validation hook runs on your edits.** `hooks/validate-skill-paths.ts` is registered on `PostToolUse Edit|Write` in `hooks/hooks.json`; it reports any `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` reference resolving to a file that does not exist. It is non-blocking — read what it says. `hooks/plugin-validate.ts` is **not registered** (its only finding here is a constant symlink warning); run `claude plugin validate` by hand if you need it.

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

!`cat ${CLAUDE_SKILL_DIR}/../../references/creator-anti-patterns.md`

### Step 1b: Check for Mechanical Enforcement Opportunities

Before drafting, identify what should be **mechanically enforced** rather than prompt-enforced. Four mechanisms are available, each resolving at a different time:

| Mechanism | Resolves at | Gives you | Use for |
|-----------|------------|-----------|---------|
| `${CLAUDE_SKILL_DIR}` | Skill load | A path string | Script paths in Bash templates |
| `!`command`` (bang) | Skill load | Command stdout as inline text | Injecting reference files, environment state |
| Scoped hooks (Pre/PostToolUse) | Each tool call | Pass/fail gate | Mechanically checkable constraints |
| SessionStart hook (`once: true`) | Session start | Value written to a file | Expensive computations (API calls, index builds) |

#### `${CLAUDE_SKILL_DIR}` — Script Path References

Use directly in Bash command templates — substituted at skill load time to the full absolute path:

```bash
# ✅ CORRECT: Variable substituted at load time, Claude sees literal path
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/my_script.py" --arg value

# ❌ WRONG: Broken $() subshell — executes script with no args, captures garbage
SCRIPT=$(${CLAUDE_SKILL_DIR}/scripts/my_script.py) && uv run python3 "$SCRIPT" --arg value
```

The `$()` indirection pattern is a common mistake. It tries to execute the script in a subshell and capture its stdout — but scripts require arguments and fail with no args, leaving the variable empty.

#### Bang-Backtick Injection (`!`command``)

Bangs run a shell command at skill load time and inline the stdout into the prompt text. Use them to inject **content**, not paths:

| Use Case | Example |
|----------|---------|
| Inline reference files | `!`cat ${CLAUDE_SKILL_DIR}/../../references/constraints.md`` |
| Environment detection | `!`if [ -f /.dockerenv ]; then echo "CONTAINER"; else echo "HOST"; fi`` |
| Inject current state | `!`git branch --show-current`` |

Bangs only work in **top-level skills** loaded via `Skill()`. Internal skills loaded via `Read()` should use direct `Read()` instructions.

#### Scoped Hooks (PreToolUse / PostToolUse)

Hooks in skill frontmatter fire only while the skill is active — automatically cleaned up when the skill finishes:

```yaml
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/guard.py"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/lint.py"
```

**⚠️ Hook-command variable rule:** use `${CLAUDE_PLUGIN_ROOT}` in hook `command:` fields — **not** `${CLAUDE_SKILL_DIR}`. The latter is for skill content (markdown body, bang-backtick commands). Hook frontmatter is a different substitution context; mixing these up causes silent failures when the hook fires outside an active `Skill()` session. See `workflow-creator` Step 3b for the April 2026 incident.

| Enforce with Hook | Keep as Prompt |
|-------------------|----------------|
| File path/extension guards | Fact rows (incident-grounded) |
| Missing prerequisite file checks | Iron Laws with drive-consequence framing |
| Tool parameter validation | Red flags (judgment-based, action-targeted) |
| Post-edit lint/format checks | "Why" explanations |
| Outline-before-prose guards | Deviation rule classification |

#### SessionStart Hooks for Expensive Resolutions

For values that genuinely require expensive computation (API calls, multi-step searches, environment probes) and are stable for the session:

```yaml
hooks:
  SessionStart:
    - hooks:
        - type: command
          command: "expensive-api-call --query env > .planning/CACHED_VALUE"
          once: true
```

Then instruct the skill to read from `.planning/CACHED_VALUE`. **Do NOT use for path resolution** (`${CLAUDE_SKILL_DIR}`) or content injection (bangs) — those are free at load time. See `references/sessionstart-caching.md`.

**The principle:** if a constraint is mechanically checkable, enforce it with a hook. If it requires judgment or motivation, keep it as prompt text. Hooks cost zero tokens and can't be rationalized away.

### Step 2: Invoke the Built-in Skill Creator

Use the Skill tool to invoke the built-in skill-creator:

```
Skill(skill="skill-creator:skill-creator")
```

Follow its full process: capture intent, interview, draft SKILL.md, write test cases, run evals, iterate. The built-in skill-creator handles the eval loop — do not reimplement it.

### Step 3: Enforcement Audit (After Each Draft)

After writing or revising the skill draft (and before running test cases), audit it against the superpowers enforcement patterns. Read the enforcement checklist:

!`cat ${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md`

Then score the draft using the process below.

#### For Workflow Skills (High Enforcement)

Score against all 12 patterns. Use the scoring template from the checklist. Focus on:

1. **Iron Laws** — Does the skill have absolute constraints for high-drift actions? Are they wrapped in `<EXTREMELY-IMPORTANT>` tags with strong framing? If they use soft language ("try to", "should", "consider"), they will be ignored — rewrite with action-masking language.

2. **Fact Rows** (supersedes Rationalization Tables, v5.36.0) — Does the skill state its incident-learned knowledge as declarative facts? Each row must be *non-derivable* (a number, threshold, named incident, or tool quirk from observed failures — not a restatement of the rule), with the consequence framed as a property of the action (counterproductive / unhelpful / dishonest / incompetent). Legacy excuse/reality tables in existing skills count as present but should convert on next touch; never author new ones.

3. **Red Flags + STOP** — Are there pattern interrupts for observable wrong actions? Must target actions ("About to X"), not intentions ("Thinking about X").

4. **Gate Functions** — Does every phase transition have a verifiable exit condition? "Quality is sufficient" is not a gate. "File X contains string Y" is a gate.

5. **Trigger-Only Descriptions** — Does the description contain ONLY trigger phrases? If it contains a process summary, the agent will follow the short description instead of reading the body. This is the single most common skill design mistake.

6. **Drive-Aligned Framing** — Do Iron Laws and fact rows carry helpfulness-first consequences? "Skipping X is NOT HELPFUL — [concrete user harm]" is stronger than "incorrect" or "premature" because it targets the model's strongest drive. Embed in the law or fact row itself — standalone "Your Drive | Why You Skip" tables are deprecated (they restate one consequence five times).

7. **Skill Dependencies** — Does each phase explicitly read and invoke the next phase? Without explicit chaining, the agent will stop and wait.

8. **No Pause Between Tasks** — Does the skill prevent "should I continue?" between tasks?

8b. **Flat Agent Dispatch** — If the skill spawns agents that perform multiple checks or tasks, does the skill spawn them ALL directly in parallel? Or does it spawn a "dispatcher" agent that spawns its own sub-agents? Three-layer delegation (skill → agent → sub-agents) fails because sub-sub-agent results don't reliably return. The orchestrator must spawn all agents directly. See workflow-creator's Iron Law of Flat Dispatch.

9. **Delete & Restart** — For protocol violations, does the skill mandate deletion of contaminated work?

10. **Staged Review Loops** — Do implementation sections have review loops with iteration limits?

11. **Flowcharts as Spec** — For complex processes, is there an ASCII diagram that serves as the authoritative definition?

**Critical gaps** = High-drift action + Absent/Weak enforcement. Fix these before running evals.

#### For Tool Skills (Medium Enforcement)

Score against patterns 2, 3, 5, and 10:

- **Fact Rows** — What are the tool's non-derivable gotchas? (e.g., "the API validates format, not correctness — an empty response returns 200"; rate limits; auth quirks)
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
| "Keep the prompt lean" | "Add Fact Rows, Red Flags" | **Enforcement patterns go in the skill body, not the description.** Progressive disclosure keeps it lean — move detailed facts to `references/` if SKILL.md exceeds 500 lines. |
| "Generalize from feedback, don't overfit" | "Observe failure modes, add fact rows" | **Fact Rows ARE generalization.** Each row captures a class of failures (the fact + its consequence), not a specific test case. |

When the built-in skill-creator suggests removing enforcement patterns because they're "not pulling their weight" or are "oppressively constrictive MUSTs," push back if the pattern addresses a real observed failure mode. The test: did an agent actually take the shortcut this pattern prevents? If yes, keep it.

### Step 4b: Keep or cut? — the trim test

Applies when editing an EXISTING skill and something reads like backstory. Ask in order; the first
answer that fires decides.

| # | Ask | Verdict |
|---|---|---|
| 1 | Is this fact already stated elsewhere in the file? | **Cut the second instance.** Provenance earns its tokens once, not once per section. |
| 2 | Could a strong model with no project history derive it from the rule it sits under? | **Cut.** The rule statement carries it. |
| 3 | Does it change an action — a number you would write, a command you would run, a rule you would decline to add? | **Keep.** |
| 4 | Is it the observed evidence behind a live Iron Law, lint rule, or hook? | **Keep, even though it reads as history.** That evidence is what survives an agent's confident override; delete it and the rule becomes arguable. |

<EXTREMELY-IMPORTANT>
**Never trim on volume.** The budget is the 500-line threshold above — under it, move nothing to
`references/`. "A third of this file is history" is a description, not a defect: the questions are
duplication and derivability, and neither is measured in percentages. A share-of-file argument will
happily delete rows 3 and 4, which are the rows carrying the enforcement.
</EXTREMELY-IMPORTANT>

- Measured 2026-09-01 on `goal-and-loop` (191 lines): a volume-based read proposed cutting
  ~400 words because 31% of the file was retrospective. The trim test found one true duplicate
  and one bloated row — **-126 words, every rule intact**. The rows the volume argument would
  also have taken were the incidents behind lint rules G2 and G9.

### Step 5: Continue the Eval Loop

Return to the built-in skill-creator's process for running test cases, grading, and iterating. After each iteration's skill revision, re-run the enforcement audit (Step 3) on the updated draft.

During the eval loop, watch for enforcement iteration signals (see "Enforcement Iteration Signals" in the anti-patterns reference loaded above).

## References

- **Enforcement checklist**: `references/enforcement-checklist.md` (in plugin root) — Full 12-pattern reference with templates. Discover via: `${CLAUDE_SKILL_DIR}/../../references/enforcement-checklist.md`
- **Description patterns**: `references/skill-description-patterns.md` (in plugin root) — The three description shapes (standalone / user-triggered, workflow-phase / orchestrator-triggered, internal-only) with templates and a migration guide for reclassifying an existing skill. Discover via: `${CLAUDE_SKILL_DIR}/../../references/skill-description-patterns.md`
- **Philosophy**: `PHILOSOPHY.md` (in plugin root) — Three pillars (phased decomposition, deterministic gates, adversarial review). Discover via: `${CLAUDE_SKILL_DIR}/../../PHILOSOPHY.md`
- **Built-in skill-creator**: Handles the eval loop (draft → test → grade → iterate → description optimization)
