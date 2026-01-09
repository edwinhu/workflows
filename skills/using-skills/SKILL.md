---
name: using-skills
description: Meta-skill teaching how to use skills. Loaded at session start.
---

# Using Skills

**Invoke relevant skills BEFORE any response or action.**

This is non-negotiable. Even a 1% chance a skill applies requires checking.

## The Rule

```
User message arrives
    ↓
Check: Does this match any skill trigger?
    ↓
YES → Invoke skill FIRST, then follow its protocol
NO  → Proceed normally
```

## Skill Triggers

| User Intent | Skill/Tool | Trigger Words |
|-------------|------------|---------------|
| Bug/fix | `/dev-debug` | bug, broken, fix, doesn't work, crash, error, fails |
| Feature/implement | `/dev` | add, implement, create, build, feature |
| Data analysis | `/ds` | analyze, data, model, dataset, statistics |
| Writing | `/writing` | write, draft, document, essay, paper |
| **Media analysis** | **look-at** | describe image, analyze PDF, what's in this, screenshot, diagram |

## Red Flags - You're Skipping the Skill Check

If you think any of these, STOP:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Simple questions don't involve reading code |
| "I'll gather information first" | That IS investigation - use the skill |
| "I know exactly what to do" | The skill provides structure you'll miss |
| "It's just one file" | Scope doesn't exempt you from process |
| "Let me quickly check..." | "Quickly" means skipping the workflow |
| **"I can read this image directly"** | **Use look-at to save context tokens** |

## Bug Reports - Mandatory Response

When user mentions a bug:

```
1. DO NOT read code files
2. DO NOT investigate
3. DO NOT "take a look"

INSTEAD:
1. Start ralph loop:
   /ralph-wiggum:ralph-loop "Debug: [symptom]" --max-iterations 15 --completion-promise "FIXED"
2. Inside loop, follow /dev-debug protocol
```

**Any code reading before starting the workflow is a violation.**

## Skill Priority

When multiple skills could apply:

1. **Process skills first** - debugging, brainstorming determine approach
2. **Then implementation** - dev, ds, writing execute the approach

## How to Invoke

Use the Skill tool:
```
Skill(skill="dev-debug")
Skill(skill="dev")
Skill(skill="ds")
```

Or start ralph loop first for implementation/debug phases.

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
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "/absolute/path/to/file" \
    --goal "What specific information to extract"
```

### When NOT to Use look-at

**Use Read tool instead for:**
- Source code (`.py`, `.js`, `.rs`, etc.)
- Plain text files (`.txt`, `.md`, `.json`, etc.)
- Config files that need exact formatting preserved
- Any file you might need to edit afterward

### Rationalization Table - STOP If You Think:

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I can read images directly" | Read tool shows you the image, but wastes context tokens | Use look-at to extract ONLY what's needed |
| "It's just one small image" | Still uses 1000+ tokens in conversation context | look-at returns 50-200 tokens of extracted info |
| "I need to see the whole thing" | You can see it, user can't see what you see | Use look-at with specific goal |
| "look-at might miss details" | You can always fall back to Read if needed | Start with look-at, escalate if insufficient |
| "The user didn't ask for look-at" | look-at is FOR YOU, not the user | Use the right tool for the job |

### Red Flags - STOP If You Catch Yourself:

- **"Let me read this image..."** → NO. Use look-at.
- **"I'll use Read to see what's in the PDF..."** → NO. Use look-at.
- **"Just quickly checking this screenshot..."** → NO. Use look-at.
- **Passing image path to Read tool** → STOP. Use look-at instead.

### Cost & Context Benefits

- **Read tool on image:** ~1,000-5,000 context tokens
- **look-at extraction:** ~50-200 output tokens
- **Savings:** 95%+ token reduction
- **Speed:** Faster responses, less context bloat

### Example Usage

```bash
# Extract specific information
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "$HOME/Downloads/screenshot.png" \
    --goal "List all buttons and their labels"

# Analyze diagram
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "$HOME/Documents/architecture.png" \
    --goal "Explain the data flow between components"

# Extract from PDF
python3 ${CLAUDE_PLUGIN_ROOT}/skills/look-at/scripts/look_at.py \
    --file "$HOME/Downloads/report.pdf" \
    --goal "Extract the executive summary section"
```

### Enforcement

**If you use Read on an image/PDF when look-at should be used, you are:**
1. Wasting context tokens unnecessarily
2. Making the conversation slower
3. Ignoring available optimization tools
4. Violating the tool selection protocol

**Check yourself:** Before calling Read, ask "Is this a media file?" If yes, use look-at.

## Advanced Agent Harnessing Patterns

**Based on oh-my-opencode production patterns for specialized agent control.**

### Background + Parallel Execution (Default)

When spawning multiple Task agents for exploration or profiling:

**ALWAYS use background + parallel:**
```
# CORRECT: All agents in ONE message, all with run_in_background=true
Task(subagent_type="Explore", description="Find auth", run_in_background=true, prompt="...")
Task(subagent_type="Explore", description="Find errors", run_in_background=true, prompt="...")
Task(subagent_type="Explore", description="Find API", run_in_background=true, prompt="...")

# Collect results later with TaskOutput
```

**NEVER wait synchronously:**
```
# WRONG: Sequential execution
task1 = Task(...) # Blocks
task2 = Task(...) # Blocks
```

**Benefits:**
- 3x faster for 3 agents
- Main conversation continues immediately
- Results collected asynchronously

### Tool Restrictions (Enforce Focus)

Every delegated Task agent should have explicit tool restrictions:

| Agent Purpose | Denied Tools | Reason |
|---------------|--------------|--------|
| Exploration | Write, Edit, NotebookEdit, Bash | Read-only search |
| Review | Write, Edit, NotebookEdit | Analysis without changes |
| Profiling | Write, Edit, NotebookEdit | Data inspection only |
| Implementation | None | Full development access |

**Pattern:** Default to most restrictive, grant only when needed.

See: `common/helpers/tool-restrictions.md`

### Structured Delegation Template

Every Task agent delegation MUST include:
1. TASK - What to do
2. EXPECTED OUTCOME - Success criteria
3. REQUIRED SKILLS - Why this agent
4. REQUIRED TOOLS - What they'll need
5. MUST DO - Non-negotiable constraints
6. MUST NOT DO - Hard blocks
7. CONTEXT - Parent session state
8. VERIFICATION - How to confirm

See: `common/templates/delegation-template.md`

Used by: `/dev-delegate`, `/ds-delegate`

### Failure Recovery Protocol

**After 3 consecutive failures, STOP and escalate:**

1. STOP all further attempts
2. REVERT to last known working state
3. DOCUMENT what was attempted and why it failed
4. CONSULT with user before continuing
5. ASK USER for direction

**NO EVIDENCE = NOT COMPLETE**

Implemented in: `/dev-debug`, `/dev-implement`

### Environment Context Injection

Research-heavy skills use current date/time context for:
- Date range validation
- Fiscal year calculations
- API version checking
- Documentation freshness

See: `common/metadata/skill-metadata.py` - `get_env_context()`

Applied to: `/wrds`, `/lseg-data`, `/gemini-batch`

### Cost Classification System

Skills are classified by cost:
- **FREE**: Simple operations, no model calls (explore, grep)
- **CHEAP**: Fast models, simple tasks (profiling, review)
- **EXPENSIVE**: Complex reasoning, architecture decisions (design, debug after 3 failures)

See: `common/metadata/skill-metadata.py` - `CostLevel`

### Metadata-Driven Prompts

Skills declare metadata in YAML frontmatter:
```yaml
---
name: skill-name
description: "..."
category: workflow | domain | phase | utility
cost: FREE | CHEAP | EXPENSIVE
triggers:
  - domain: "Feature implementation"
    trigger: "add, implement, create, build"
use_when:
  - "Complex multi-file changes"
avoid_when:
  - "Simple single-line fixes"
---
```

Parent skills consume metadata to build decision tables dynamically.

See: `common/metadata/skill-metadata.py`

## Pattern References

All new patterns documented in:
- `common/metadata/` - Metadata infrastructure and cost classification
- `common/templates/` - Delegation and agent templates
- `common/helpers/` - Tool restrictions and utilities

Based on: [obra/superpowers](https://github.com/obra/superpowers) and oh-my-opencode production patterns.
