---
name: using-skills
description: "Auto-loaded at session start via SessionStart hook. Teaches skill invocation protocol, tool selection rules (look-at for media, skills for workflows), agent delegation patterns, and enforcement mechanisms. NOT user-triggered - provides foundational skill usage discipline for all sessions."
user-invocable: false
disable-model-invocation: true
---

# Using Skills

**Invoke relevant skills BEFORE any response or action.**

This is non-negotiable. Even a 1% chance a skill applies requires checking.

## CRITICAL: Skill Already Loaded - DO NOT RE-INVOKE

<EXTREMELY-IMPORTANT>
**If you see a skill name in the current conversation turn (e.g., `<command-name>/dev</command-name>`), the skill is ALREADY LOADED.**

**DO NOT:**
- ❌ Use the Skill tool to invoke it again
- ❌ Say "I need to invoke the skill"
- ❌ Call `Skill(skill="dev")` or similar

**DO INSTEAD:**
- ✅ The skill instructions follow immediately in the next message
- ✅ Just proceed to the next step
- ✅ Follow the loaded skill's instructions directly

**If you catch yourself about to invoke a skill that's already loaded, STOP. Just go to the next step.**
</EXTREMELY-IMPORTANT>

## The Rule

```
User message arrives
    ↓
Is user explicitly invoking a skill (e.g., "use /dev")?
    ↓
YES → SKILL IS ALREADY LOADED
      ↓
      DO NOT invoke again with Skill tool
      ↓
      Proceed to next step (follow skill instructions)
NO  → Contains session keyword? (companion, new session, background session, etc.)
    ↓
YES → Invoke COMPANION skill FIRST — put everything else in the session prompt
NO  → Check: Does this match any other skill trigger?
    ↓
YES → Invoke skill FIRST, then follow its protocol
NO  → Proceed normally
```

## Workflow Commands

Each workflow has two entry points — start fresh or re-enter mid-workflow:

| Start Fresh | Mid-Workflow | Purpose |
|-------------|-------------|---------|
| `/dev` | `/dev-debug` | Feature development (7 phases) / debug, fix, re-test |
| `/ds` | `/ds-fix` | Data analysis (5 phases) / wrong results, notebook errors, revisions |
| `/writing` | `/writing-revise` | Writing projects / apply review fixes, polish |
| `/workshop` | `/workshop-revise` | Workshop presentations (4 phases) / revise slides, fix notes |

## IRON LAW: Companion Transport Priority

<EXTREMELY-IMPORTANT>
**When session keywords appear, invoke the companion skill FIRST. This is not negotiable.**

When the user's request mentions **any session keyword** — 'companion session', 'new session', 'separate session', 'background session', 'parallel session', 'companion', 'hand off to a session', 'in a new session' — the **companion skill MUST be invoked FIRST**, regardless of what other skills are mentioned.

The companion skill is a **TRANSPORT mechanism**. It launches the session. Other skills/tasks go **inside** the session's prompt.

```
"use workflows creator in a new companion session"
    ↓
WRONG: invoke workflows:skill-creator directly (or Agent tool)
RIGHT: invoke companion skill, put "use workflows:skill-creator" in the prompt
```

**The rule:** 'do X in a companion session' = companion launches, X goes in the prompt. NOT 'do X directly'.

**Invoking X directly when the user said 'in a companion session' is NOT HELPFUL — the task runs in your current context, dies when the conversation ends, and the user cannot monitor or interact with it in the companion web UI. You did the opposite of what was asked.**
</EXTREMELY-IMPORTANT>

### Companion Routing Facts

- Agent tool with `run_in_background` is NOT a companion session: background agents die when the conversation ends and can't be accessed via the companion web UI. Substituting it for the companion skill gives the user the opposite of the persistent, monitorable session they asked for.

## Skill Triggers (Can Auto-Invoke)

| User Intent | Command | Trigger Words |
|-------------|---------|---------------|
| **Session/companion** | **companion** | **companion session, new session, separate session, background session, hand off, in a new session** |
| Bug/fix | `/dev-debug` | bug, broken, fix, doesn't work, crash, error, fails |
| Wrong results | `/ds-fix` | results wrong, notebook error, reviewer feedback, data changed |
| Writing | `/writing` | write, draft, document, essay, paper |
| **Media analysis** | **look-at** | describe image, analyze PDF, what's in this, screenshot, diagram |
| Create/edit skill | `workflows:skill-creator` | create skill, improve skill, edit skill, add enforcement, audit skill, SKILL.md |
| Create/edit workflow | `workflows:workflow-creator` | create workflow, design workflow, edit workflow, audit workflow, improve workflow |
| Create/edit plugin | `workflows:plugin-creator` | create plugin, scaffold plugin, new plugin, plugin structure, edit plugin |
| Workshop presentation | `/workshop` | workshop presentation, workshop slides, faculty workshop, workshop talk, slides from paper |
| Revise workshop | `/workshop-revise` | revise workshop, fix slides, update presentation, workshop feedback |

## Red Flags

- About to invoke a skill the user already invoked (e.g., "use /dev") → it is ALREADY LOADED; check for the `<command-name>` tag and just proceed.
- About to "gather information" or "quickly check" code before starting the matching workflow → that IS investigation; invoke the skill first. Scope ("just one file", "simple question") doesn't exempt you from the process.
- About to Read an image/PDF directly → use look-at.
- User said "use X in a companion session" and you're about to invoke X directly or via the Agent tool → companion skill is the transport, X goes in the prompt. Agent = subagent in THIS session; companion = separate server session.

## Bug Reports - Mandatory Response

When user mentions a bug:

```
DO NOT:
1. Read code files
2. Investigate independently
3. "Take a look" without structure

INSTEAD:
1. Invoke dev-debug — it runs its own progress-gated subagent loop
   (no /goal needed; dev-debug uses main-chat-runs-the-test gating instead of an evaluator)
2. Follow the /dev-debug protocol
```

**Any code reading before starting the workflow is a violation.**

## Skill Priority

When multiple skills could apply:

1. **Transport skills first** - companion session routes EVERYTHING else inside the session prompt
2. **Process skills next** - debugging, brainstorming determine approach
3. **Then implementation** - dev, ds, writing execute the approach

## How to Invoke

Use the Skill tool to invoke skills:

```bash
# dev-debug: Midpoint entry for dev workflow - debug, fix, re-test
Skill(skill="dev-debug")

# dev: Feature development workflow with 7 phases and TDD enforcement
Skill(skill="dev")

# ds: Data analysis workflow with 5 phases and output-first verification
Skill(skill="ds")
```

For implementation phases, set a `/goal` at the top of the phase (dev-implement walks you through writing the condition):

```
/goal All tasks in PLAN.md marked [x], [test command] exits 0, VALIDATION.md status = validated. Stop after [N] turns.
```

For debugging, invoke `dev-debug` directly; it runs its own progress-gated loop.

## IRON LAW: Multimodal File Analysis

**NO READING IMAGES/PDFS WITH Read TOOL. USE look-at INSTEAD.**

### The Rule

```
User asks about image/PDF/media content
    ↓
Is it a media file requiring interpretation?
    ↓
YES → Use look-at skill (bash call to look_at.py)
NO  → Use Read tool for source code/text
```

### When to Use look-at

**ALWAYS use look-at for:**
- `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.heic` - Images
- `.pdf` - PDFs requiring content extraction
- `.mp4`, `.mov`, `.avi`, `.webm` - Videos
- `.mp3`, `.wav`, `.aac`, `.ogg` - Audio
- Any file where you need to UNDERSTAND content, not just see raw bytes

**Pattern:**
```bash
# look-at: Extract information from media file with specific goal
uv run --script "${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py" \
    --file "/absolute/path/to/file" \
    --goal "What specific information to extract"
```

### When NOT to Use look-at

**Use Read tool instead for:**
- Source code files (`.py`, `.js`, `.rs`, etc.) - need exact formatting for editing
- Plain text files (`.txt`, `.md`, `.json`, etc.) - preserve exact content
- Config files requiring exact formatting preservation
- Any file that needs editing after reading

### Tool Routing Facts

- Read on an image costs 1,000+ context tokens even for a "small" file; look-at returns 50-200 tokens of extracted info. File size doesn't change this — content type determines the tool.
- look-at is FOR YOU, not the user — it applies whether or not the user asked for it. You can always fall back to Read if the extraction is insufficient; start with look-at and escalate.

### Red Flags

- Passing an image, PDF, or screenshot path to the Read tool → use look-at.

### Cost & Context Benefits

- **Read tool on image:** ~1,000-5,000 context tokens
- **look-at extraction:** ~50-200 output tokens
- **Savings:** 95%+ token reduction
- **Speed:** Faster responses, less context bloat

### Example Usage

```bash
# look-at: Extract specific information from image file
uv run --script "${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py" \
    --file "$HOME/Downloads/screenshot.png" \
    --goal "List all buttons and their labels"

# look-at: Analyze diagram to understand data flow
uv run --script "${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py" \
    --file "$HOME/Documents/architecture.png" \
    --goal "Explain the data flow between components"

# look-at: Extract information from PDF document
uv run --script "${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py" \
    --file "$HOME/Downloads/report.pdf" \
    --goal "Extract the executive summary section"
```

### Enforcement

**Using Read on images/PDFs when look-at should be used results in:**
1. Wasting context tokens unnecessarily
2. Making conversations slower
3. Ignoring available optimization tools
4. Violating the tool selection protocol

**Validate before calling Read:** Ask "Is this a media file?" If yes, invoke look-at instead.

## IRON LAW: Following Skill Instructions

**WHEN A SKILL LOADS, YOU MUST FOLLOW ITS EXACT INSTRUCTIONS.**

Skills contain specific patterns, required parameters, and enforcement rules. Skipping these requirements defeats the purpose of loading the skill.

### The Rule

```
Skill loads successfully
    ↓
Read the skill's requirements carefully
    ↓
Follow ALL instructions, including:
    - Required tool parameters (descriptions, timeouts, etc.)
    - Specific command patterns
    - Enforcement patterns (Iron Laws, Red Flags)
    - Step sequences
    ↓
Execute using the skill's exact patterns
```

### Common Violations

**Bash Description Parameter:**

When a skill requires `description` parameter on Bash calls (like look-at), you MUST include it:

```bash
# ❌ WRONG: No description parameter
uv run --script "${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py" \
    --file "/path/to/file.pdf" \
    --goal "Extract title"

# ✅ CORRECT: With description parameter as skill requires
Bash(
    command='uv run --script "${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py" --file "/path/to/file.pdf" --goal "Extract title"',
    description="look-at: Extract title"
)
```

### Red Flags

- About to call Bash without the `description` parameter when the skill requires it → add it.
- About to modify a skill's required pattern "to be simpler" → follow the skill or don't load it.

### Why This Matters

**Skills encode:**
1. **Tested patterns** - Proven to work in production
2. **Optimization** - Context/token savings, clean output
3. **Enforcement** - Prevent common mistakes
4. **UX standards** - Consistent, professional output

**When you skip skill instructions:**
- ❌ You waste the effort of loading the skill
- ❌ You create messy, unprofessional output
- ❌ You miss optimizations (context savings, speed)
- ❌ You violate user expectations
- ❌ You make debugging harder

**The skill loaded for a reason - follow it completely.**

## IRON LAW: Creator Activity Routing

**NO CREATING OR SUBSTANTIALLY EDITING SKILLS, PLUGINS, OR WORKFLOWS WITHOUT THE WORKFLOWS WRAPPER.**

The workflows plugin provides wrapper skills that add two layers on top of built-in creator tools:
1. **Behavioral enforcement** — superpowers patterns (Iron Laws, rationalization tables, red flags, enforcement checklist audit)
2. **Mechanical enforcement** — PostToolUse hooks (`plugin-validate.py`, `validate-skill-paths.py`) that fire on every Write/Edit

Using built-in creators directly bypasses both layers. This applies globally — any project, not just the workflows plugin.

"Substantial" means: adding/removing sections, changing enforcement patterns, altering process flow, adding/modifying hooks. Typo fixes, version bumps, and single-line clarifications are exempt.

### The Rule

```
About to create or substantially edit a skill/plugin/workflow
    ↓
What type of creator activity?
    ↓
    +---> Skill creation/editing ------> Invoke workflows:skill-creator
    |
    +---> Workflow creation/editing ----> Invoke workflows:workflow-creator
    |
    +---> Plugin creation/editing ------> Invoke workflows:plugin-creator
    ↓
Follow the wrapper skill's full process
    ↓
DO NOT invoke built-in creators directly (skill-creator:skill-creator,
plugin-dev:skill-development, plugin-dev:plugin-structure, etc.)
```

### Creator Routing Table

| Activity | Route To | Wraps |
|----------|----------|-------|
| Create/edit a skill | `workflows:skill-creator` | `skill-creator:skill-creator` |
| Create/edit a workflow | `workflows:workflow-creator` | (standalone meta-tool) |
| Create/edit a plugin | `workflows:plugin-creator` | `plugin-dev:create-plugin` |

Trigger words: see Skill Triggers table above.

### Red Flags

- About to invoke a built-in creator directly (`skill-creator:skill-creator`, `plugin-dev:*`, etc.) → use the workflows wrapper. The built-in has no PostToolUse hooks; path errors and structural issues go uncaught.
- Editing enforcement patterns without the wrapper → this is exactly when the audit matters most.

## Advanced Agent Harnessing Patterns

**For detailed oh-my-opencode production patterns including:**
- Background + parallel execution (3x speedup)
- Tool restrictions for focused agents
- Structured delegation templates
- Failure recovery protocol
- Environment context injection
- Cost classification system
- Metadata-driven prompts

**See:** `references/agent-harnessing.md`

Quick reference:
- Tool restrictions: `references/tool-restrictions.md`
- Delegation template: `references/delegation-template.md`
- Metadata infrastructure: `references/skill-metadata.py`

Based on: [obra/superpowers](https://github.com/obra/superpowers) and oh-my-opencode production patterns.
