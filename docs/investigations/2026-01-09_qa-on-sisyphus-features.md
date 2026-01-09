# Q&A: How Our Features Compare to oh-my-claude-sisyphus

**Date**: 2026-01-09
**Context**: Answering specific questions about overlap and differences

---

## 1. Boulder State vs Our SPEC.md/PLAN.md/LEARNINGS.md

### What We Currently Have

**Our approach**: Instruction-based file creation in `.claude/` directory

```markdown
## /dev Workflow Phases

1. /dev-brainstorm    → Creates `.claude/SPEC.md` (draft)
2. /dev-explore       → Reads SPEC.md, explores codebase
3. /dev-clarify       → Updates `.claude/SPEC.md` (final)
4. /dev-design        → Creates `.claude/PLAN.md` (chosen approach)
5. /dev-implement     → Reads SPEC.md + PLAN.md, writes code
6. /dev-review        → Checks against SPEC.md
```

**Files created**:
- `.claude/SPEC.md` - Requirements specification
- `.claude/PLAN.md` - Implementation plan with tasks
- `.claude/LEARNINGS.md` - What was tried, what worked, what didn't

**How it works**:
```
Session 1:
  User: Implement feature X
  /dev-brainstorm → writes .claude/SPEC.md
  /dev-design → writes .claude/PLAN.md

Session 2 (next day):
  User: Continue working on feature X
  Claude: [Reads .claude/SPEC.md and PLAN.md if told to]
  User: "Continue implementing from PLAN.md"
  Claude: [Reads files, continues]
```

### What Boulder State Adds

**Their approach**: State management with automatic continuation

```json
// .sisyphus/boulder.json (created automatically)
{
  "active_plan": "/project/.sisyphus/plans/feature-x.md",
  "started_at": "2026-01-09T10:00:00Z",
  "session_ids": ["sess_123", "sess_456"],
  "plan_name": "feature-x",
  "metadata": {}
}
```

**How it works**:
```
Session 1:
  User: Implement feature X
  Claude creates: .sisyphus/plans/feature-x.md
  Claude creates: .sisyphus/boulder.json (tracks active plan)
  Works on tasks...

Session 2 (next day):
  User: [just starts Claude]
  Claude: [Reads boulder.json automatically]
  Claude: "I see you're working on feature-x.md (5/20 tasks done). Continuing..."
  [No user prompt needed to continue!]
```

### Key Differences

| Aspect | Our SPEC/PLAN | Boulder State |
|--------|---------------|---------------|
| **Creation** | Manual skill invocation | Automatic on large tasks |
| **Continuation** | User must tell Claude to continue | Claude auto-detects active plan |
| **Progress Tracking** | Manual (read PLAN.md, count checkboxes) | Automatic (counts checkboxes in plan) |
| **Multi-Session** | User reminds Claude each time | State file tracks sessions automatically |
| **File Location** | `.claude/SPEC.md`, `.claude/PLAN.md` | `.sisyphus/plans/*.md`, `.sisyphus/boulder.json` |
| **State Persistence** | None (files only) | JSON state file tracks progress |

### Why Boulder State Is Better

**Problem with our approach**:
```
Day 1: User runs /dev-design, creates PLAN.md with 20 tasks
       Claude implements task 1-3
       User closes terminal

Day 2: User opens Claude
       User: "Continue working on that feature"
       Claude: "Which feature? I don't remember."
       User: "The one from yesterday! Check PLAN.md"
       Claude: "Let me read .claude/PLAN.md..."

       [User must explicitly guide Claude back to the plan every time]
```

**With boulder state**:
```
Day 1: User asks to implement feature
       Claude creates plan automatically
       Boulder.json tracks: active plan = feature-x.md, progress = 3/20

Day 2: User opens Claude
       Claude reads boulder.json on startup
       Claude: "Continuing work on feature-x.md (3/20 tasks complete).
                Next task: Implement authentication service."
       [Zero user prompting needed]
```

### Concrete Example: Multi-Week Project

**Our current workflow**:
```
Week 1, Day 1:
  User: Refactor entire codebase to use TypeScript
  /dev-design → Creates PLAN.md with 50 tasks
  Claude completes task 1-5

Week 1, Day 2:
  User: Continue the refactor
  Claude: Read PLAN.md, continue from task 6

Week 1, Day 3:
  User: Keep going
  Claude: Read PLAN.md, continue from task 11

[User must prompt EVERY DAY: "continue the refactor"]
```

**With boulder state**:
```
Week 1, Day 1:
  User: Refactor entire codebase to TypeScript
  boulder.json: active_plan = refactor.md, progress = 5/50

Week 1, Day 2:
  User: [Opens Claude]
  Claude: "Continuing refactor.md (5/50). Starting task 6: Convert utils/ to TS"

Week 1, Day 3:
  User: [Opens Claude]
  Claude: "Continuing refactor.md (11/50). Starting task 12: Convert services/ to TS"

[Claude AUTOMATICALLY knows to continue!]
```

### What We Could Adopt

**Option 1: Add boulder state alongside our files**
```
.claude/
├── SPEC.md          # Keep for requirements
├── PLAN.md          # Keep for detailed plan
├── LEARNINGS.md     # Keep for iteration learnings
└── .sisyphus/
    ├── boulder.json # ADD: State tracker
    └── plans/       # ADD: Auto-generated plans
```

**Option 2: Enhance our files with state tracking**
```yaml
# Add to .claude/PLAN.md header
---
active: true
started_at: 2026-01-09T10:00:00Z
sessions: [sess_123, sess_456]
progress:
  total: 20
  completed: 5
---

# Feature X Implementation Plan
...
```

**My recommendation**: **Option 1**
- Boulder state is specifically for **multi-session continuation**
- Our SPEC/PLAN files are good for **workflow phases**
- They serve different purposes
- Boulder state adds automatic resumption without changing our workflow

---

## 2. Ralph Loop: Theirs vs Ours

### What We Currently Have

**Our implementation**: `/ralph-wiggum:ralph-loop` skill

```bash
# Usage
/ralph-wiggum:ralph-loop "Task 1: Create types" --max-iterations 5 --completion-promise "TASK1_DONE"

# Inside loop
[Claude spawns Task agents]
[Claude checks if done]
[If done] <promise>TASK1_DONE</promise>
[If not done] Keep iterating
```

**Implementation**: Pure instruction-based
```markdown
## Promise Rules (from dev-ralph-loop skill)

You may ONLY output the promise when the statement is
COMPLETELY AND UNEQUIVOCALLY TRUE.

The promise is a claim that:
- For implementation: "This task's tests pass. Complete."
- For debugging: "Bug is fixed. Regression test passes."

If the promise isn't true, don't output it. Keep iterating.
```

**Verification**: Manual (Claude decides)
- No state file tracking iterations
- No automatic detection of completion promise
- Relies on Claude following instructions

### What Their Ralph Loop Has

**Their implementation**: State-based enforcement with hook

```typescript
// State file: .sisyphus/ralph-state.json
{
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "completion_promise": "TASK_COMPLETE_abc123",  // Random token
  "started_at": "2026-01-09T14:00:00Z",
  "prompt": "Fix all TypeScript errors",
  "session_id": "sess_123"
}
```

**Enforcement**: Hook-based (Stop event)
```typescript
// When Claude tries to stop
function processRalphLoop(input: HookInput): HookOutput {
  const state = readRalphState(directory);

  // Check if completion promise was output
  const completed = detectCompletionPromise(sessionId, state.completion_promise);

  if (!completed) {
    // NO! Promise not found. Force iteration.
    incrementIteration();
    return {
      continue: true,
      message: `[RALPH LOOP - ITERATION ${state.iteration}/${state.max_iterations}]

      Your previous attempt did not output the completion promise.
      Continue working on the task.

      When TRULY complete, output: <promise>${state.completion_promise}</promise>`
    };
  }

  // Yes! Promise found. Allow completion.
  clearRalphState();
  return { continue: true };
}
```

### Key Differences

| Aspect | Our Ralph Loop | Their Ralph Loop |
|--------|----------------|------------------|
| **Enforcement** | Instructions | Hook intercepts Stop event |
| **State Tracking** | None | JSON file with iteration count |
| **Completion Check** | Claude decides | Hook searches transcript for promise |
| **Can be Ignored** | Yes (Claude can skip instructions) | No (hook forces continuation) |
| **Iteration Count** | Claude tracks manually | State file auto-increments |
| **Promise Token** | User chooses | Auto-generated random token |
| **Bypass Prevention** | Instructions only | Stop event hook blocks exit |

### Why Theirs Is Better

**Scenario: Claude thinks it's done but it's not**

**Our approach**:
```
Iteration 1:
  Claude: "I fixed the bug. Tests pass."
  <promise>TASK_DONE</promise>
  [Loop exits]

User runs tests:
  npm test
  5 tests failing ❌

User: "Tests are still failing!"
Claude: "Oh, let me check..."
[User has to manually restart the loop]
```

**Their approach**:
```
Iteration 1:
  Claude: "I fixed the bug. Tests pass."
  <promise>TASK_COMPLETE_8f3a9b</promise>

Hook on Stop:
  detectCompletionPromise("TASK_COMPLETE_8f3a9b")
  → Searches transcript for exact token
  → Found! Allow completion.

User runs tests:
  [Same problem - tests failing]
```

**Wait, same result? YES! But here's the difference:**

The real power is in **preventing premature stopping WITHOUT the promise**:

**Our approach** (instruction-based):
```
Iteration 1:
  Claude: "I think I fixed it, but tests still fail"
  [Claude gets impatient]
  Claude: "Let me just output the promise to move on"
  <promise>TASK_DONE</promise>
  [Loop exits even though task not done!]
```

**Their approach** (hook-enforced):
```
Iteration 1:
  Claude: "I think I fixed it, but tests still fail"
  [Claude gets impatient]
  Claude: "Let me move on"
  [Doesn't output promise]

Hook on Stop:
  detectCompletionPromise("TASK_COMPLETE_8f3a9b")
  → Not found in transcript
  → BLOCK stop, inject continuation message
  → Force iteration 2

Iteration 2:
  [Message injected: "Continue working, promise not found"]
  Claude: "Right, need to actually fix it"
  [Fixes remaining issues]
  <promise>TASK_COMPLETE_8f3a9b</promise>
```

### The Critical Difference: Hook Enforcement

**Our implementation relies on Claude being honest**:
- "Don't output promise unless done" → Claude can ignore this
- "Keep iterating" → Claude can decide to stop anyway
- No enforcement mechanism

**Their implementation uses a hook as gatekeeper**:
- Stop event → Hook checks for promise in transcript
- No promise found → Stop is BLOCKED, iteration injected
- Promise found → Stop is allowed
- Claude CANNOT exit without outputting the promise

### What We Could Adopt

**Option 1: Add Stop hook to enforce our ralph-loop skill**

```python
# hooks/scripts/ralph-loop/enforce-loop.py

def check_ralph_loop_completion():
    """On Stop event, check if ralph loop is active"""

    # Check if we're in a ralph loop (look for /ralph-wiggum:ralph-loop in transcript)
    if not in_ralph_loop():
        return {"continue": True}

    # Get the expected promise from skill invocation
    expected_promise = extract_promise_from_invocation()

    # Search transcript for the promise
    if promise_found_in_transcript(expected_promise):
        # Found! Allow stop
        return {"continue": True}

    # Not found! Block stop and force iteration
    return {
        "continue": False,
        "message": f"""
        [RALPH LOOP ENFORCEMENT]

        The completion promise was not output. The loop is not complete.

        Continue working on the task. When truly done, output:
        <promise>{expected_promise}</promise>
        """
    }
```

**Option 2: Create state files for ralph loops**

```bash
# When /ralph-wiggum:ralph-loop is invoked
# Create: .claude/.ralph/loop-state.json

{
  "active": true,
  "task": "Task 1: Create types",
  "iteration": 1,
  "max_iterations": 5,
  "promise": "TASK1_DONE",
  "started_at": "...",
  "session_id": "..."
}

# On Stop: Check this file, enforce continuation
```

**My recommendation**: **Option 1 (Add Stop hook)**
- Don't need state files (our transcript has all info)
- Stop hook can extract promise from transcript
- Minimal changes to existing ralph-loop skill
- Just adds enforcement layer

---

## 3. Rules Injectors: What We Already Have

### Our Current Rules Injectors

**We have 3 PostToolUse hooks**:

1. **Marimo notebook hook** (`hooks/scripts/marimo/marimo-check.py`)
   - Triggers on: Edit/Write to `*.py` files
   - Checks: If file is a marimo notebook (has `__marimo__` metadata)
   - Injects: "This is a marimo notebook. Use `marimo edit` to modify."

2. **Jupytext notebook hook** (`hooks/scripts/jupytext/jupytext-sync.py`)
   - Triggers on: Edit/Write to `*.py` files
   - Checks: If file has jupytext pairing (`.ipynb` + `.py`)
   - Injects: "Changes synced to paired notebook. Re-run cells if needed."

3. **Markdown validation hook** (`hooks/scripts/markdown/markdown-check.py`)
   - Triggers on: Edit/Write to `*.md` files
   - Checks: Unescaped `$` signs (cause LaTeX rendering)
   - Injects: Warning about dollar signs

### What Their Rules Injector Does

**Glob pattern-based injection** with YAML frontmatter:

```markdown
<!-- File: .claude/rules/react.md -->
---
applies_to:
  - "**/*.tsx"
  - "**/*.jsx"
priority: 10
tags: ["frontend", "react"]
---

# React Component Rules

- Always use functional components
- Props must be typed with TypeScript
- Use hooks instead of class components
```

**How it works**:
```python
# When Claude reads src/Button.tsx

1. Hook intercepts PostToolUse (Read tool)
2. Finds all rule files: .claude/rules/, .github/copilot-instructions.md
3. Parses YAML frontmatter from each rule file
4. Checks if "src/Button.tsx" matches applies_to patterns
5. react.md matches "**/*.tsx" → Inject it
6. Deduplicates (don't inject same rule twice in session)
7. Injects content into context
```

### Key Differences

| Aspect | Our Hooks | Their Rules Injector |
|--------|-----------|---------------------|
| **Trigger** | Specific file types | Glob pattern matching |
| **Config** | Hardcoded in Python | YAML frontmatter |
| **Extensibility** | Edit hook Python code | Add new `.md` files |
| **Scope** | Plugin-defined | User-defined per project |
| **Pattern Matching** | Filename suffix check | Full glob patterns |
| **Deduplication** | None | Session-based cache |

### What We Could Adopt

**Current limitation**: To add a new rule type, we need to edit Python code and rebuild plugin.

**With their approach**: Users can add rules without touching plugin:

```bash
# User creates their own rule files

.claude/rules/
├── api-standards.md
│   ---
│   applies_to: ["**/api/**/*.py"]
│   ---
│   All APIs must use async/await
│
├── database.md
│   ---
│   applies_to: ["**/models/*.py", "**/migrations/*.sql"]
│   ---
│   Never use CASCADE deletes
│
└── testing.md
    ---
    applies_to: ["**/tests/**/*.py"]
    ---
    All tests must use pytest fixtures
```

**Hook automatically finds and injects these when Claude reads matching files.**

**My recommendation**: **Yes, adopt this!**
- Makes plugin extensible without code changes
- Users can add project-specific rules
- We keep our existing marimo/jupytext hooks (they're specific validation)
- Add general rules injector for user-defined rules

**Implementation**:
```python
# hooks/scripts/rules/rules-injector.py

def inject_matching_rules(file_path: str):
    """Find and inject rule files that match this file path"""

    # Find rule files in .claude/rules/, .github/
    rule_files = find_rule_files()

    for rule_file in rule_files:
        # Parse YAML frontmatter
        metadata, body = parse_frontmatter(rule_file)

        # Check if file matches any glob pattern
        if matches_any_pattern(file_path, metadata['applies_to']):
            # Check session cache (don't inject twice)
            if not already_injected(rule_file, session_id):
                # Inject the rule content
                inject_message(body)
                mark_as_injected(rule_file, session_id)
```

---

## 4. Context Injector: README.md, AGENTS.md

### What We Currently Have

**Relies on Claude Code's built-in CLAUDE.md support**:
```
Claude Code automatically injects:
  ~/.claude/CLAUDE.md       (global config)
  ~/project/.claude/CLAUDE.md   (project config)
```

**That's it.** No automatic README discovery, no AGENTS.md support.

### What Their Context Injector Does

**Systematic discovery** of documentation files:

```typescript
// On session start or file read
const entries: ContextEntry[] = [];

// 1. Find project README
if (exists('README.md')) {
  entries.push({
    source: 'README.md',
    content: readFile('README.md'),
    priority: 10,
    type: 'readme'
  });
}

// 2. Find AGENTS.md (agent knowledge base)
if (exists('AGENTS.md')) {
  entries.push({
    source: 'AGENTS.md',
    content: readFile('AGENTS.md'),
    priority: 20,
    type: 'agents'
  });
}

// 3. Find directory-specific READMEs
if (readingFile('backend/api/users.py')) {
  if (exists('backend/README.md')) {
    entries.push({
      source: 'backend/README.md',
      content: readFile('backend/README.md'),
      priority: 15,
      type: 'readme'
    });
  }
}

// 4. Inject all into context
injectContext(entries);
```

**Result**:
```markdown
<injected-context>
# Context from README.md
[Project architecture notes...]

---

# Context from AGENTS.md
## oracle
Use for complex debugging
[Agent knowledge...]

---

# Context from backend/README.md
[Backend-specific conventions...]
</injected-context>

---

[User prompt or file content...]
```

### Why This Is Useful

**Current state**: You have to put EVERYTHING in `.claude/CLAUDE.md`

```markdown
<!-- .claude/CLAUDE.md -->

# Project Instructions

## Architecture
[Copy entire README here...]

## Backend Conventions
[Copy backend/README here...]

## Agent Knowledge
[Copy agent docs here...]

[CLAUDE.md becomes 1000+ lines!]
```

**With context injector**: Documentation stays where it belongs

```
README.md                    ← Architecture notes
backend/README.md            ← Backend conventions
AGENTS.md                    ← Agent knowledge
.claude/CLAUDE.md            ← Only plugin-specific config

Context injector collects all automatically!
```

### Potential Conflict with CLAUDE.md

**Question**: Does this overlap with Claude Code's built-in CLAUDE.md support?

**Answer**: No, they're complementary:

| File | Purpose | Injected By |
|------|---------|-------------|
| `CLAUDE.md` | **Behavior instructions** for Claude | Claude Code (built-in) |
| `README.md` | **Project documentation** | Context injector (new) |
| `AGENTS.md` | **Agent knowledge base** | Context injector (new) |
| `backend/README.md` | **Directory-specific docs** | Context injector (new) |

**Example**:
```markdown
<!-- .claude/CLAUDE.md -->
Use pixi for Python dependencies
Never install global packages

<!-- README.md -->
# My App

Architecture: Microservices with FastAPI
Database: PostgreSQL with SQLAlchemy

<!-- AGENTS.md -->
## oracle
Use for debugging complex async issues
```

All three are injected, serving different purposes.

### My Recommendation

**Yes, adopt for README.md and AGENTS.md**:
- Keeps documentation in natural places
- Avoids bloating CLAUDE.md
- Makes project documentation automatically available

**Don't go overboard**:
- Don't inject ALL README files recursively (context explosion)
- Only inject:
  - Project root README.md
  - AGENTS.md (if exists)
  - Directory README when Claude accesses files in that directory

---

## 5. Background Manager: How It's Actually Implemented

### What Claude Code's Task Tool Does

**Built-in background execution**:
```python
Task(
    prompt="Search for all API endpoints",
    subagent_type="Explore",
    run_in_background=True    # ← Claude Code handles this
)

# Claude Code:
# - Spawns subprocess
# - Returns immediately (non-blocking)
# - Stores output for later retrieval
```

**What Claude Code provides**:
- ✅ Background execution (non-blocking)
- ✅ Output capture
- ✅ TaskOutput tool to retrieve results
- ❌ No concurrency limits
- ❌ No status tracking
- ❌ No timeout handling
- ❌ No notifications on completion

### What Their Background Manager Adds

**Task queue with management**:

```typescript
class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private concurrency: ConcurrencyManager;  // Max N concurrent

  // Submit task to queue
  async submitTask(config: TaskConfig): Promise<string> {
    const taskId = generateId();
    const task = {
      id: taskId,
      status: 'pending',      // ← Track status
      prompt: config.prompt,
      createdAt: new Date(),
    };

    this.tasks.set(taskId, task);
    this.persistTask(task);    // ← Save to disk
    this.tryStartTasks();      // ← Start if slots available

    return taskId;
  }

  // Try to start pending tasks
  private tryStartTasks() {
    const pending = getTasks('pending');

    for (const task of pending) {
      if (this.concurrency.canStart()) {  // ← Check limit
        this.startTask(task);
      }
    }
  }

  // Actually run the task
  private async startTask(task: BackgroundTask) {
    this.concurrency.acquire(task.id);
    task.status = 'running';              // ← Update status

    try {
      // Launch Claude Code Task tool
      const result = await executeTask(task);
      task.status = 'completed';           // ← Mark done
      task.result = result;

      // Notify user
      notifyCompletion(task);              // ← Hook injects message

    } catch (error) {
      task.status = 'failed';              // ← Mark failed
    } finally {
      this.concurrency.release(task.id);
      this.tryStartTasks();                // ← Start next queued task
    }
  }
}
```

**Concurrency control**:
```typescript
class ConcurrencyManager {
  private maxConcurrent = 3;               // ← Limit to 3 simultaneous
  private running: Set<string> = new Set();

  canStart(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  acquire(taskId: string): void {
    this.running.add(taskId);
  }

  release(taskId: string): void {
    this.running.delete(taskId);
  }
}
```

**Persistence**:
```
~/.claude/.sisyphus/background-tasks/
├── bg_abc123.json       # Task 1 state
├── bg_def456.json       # Task 2 state
└── bg_ghi789.json       # Task 3 state
```

### Concrete Example: Without vs With Manager

**Without background manager** (current):
```python
# Launch 10 parallel exploration tasks
for topic in topics:
    Task(prompt=f"Search for {topic}", run_in_background=True)

# Problems:
# - All 10 spawn immediately (resource spike!)
# - No way to check status
# - No way to know when they're done
# - If Claude crashes, all progress lost
```

**With background manager**:
```python
# Submit 10 tasks
task_ids = []
for topic in topics:
    task_id = manager.submitTask({
        prompt: f"Search for {topic}",
        subagent: "Explore"
    })
    task_ids.append(task_id)

# Queue behavior:
# Time 0s:  Task 1 (running), Task 2 (running), Task 3 (running)
#           Task 4-10 (pending, queued)
#
# Time 10s: Task 1 (done) → Task 4 starts
#           Task 2 (running), Task 3 (running), Task 4 (running)
#
# Time 20s: Task 2 (done) → Task 5 starts
#           Task 3 (running), Task 4 (running), Task 5 (running)

# Check status anytime
status = manager.getStatus(task_ids[0])
# { status: 'completed', result: '...', duration: 12.3s }

# Get notification when done
# → Hook injects: "Background task 'Search X' completed"
```

### Do We Need This?

**Arguments FOR**:
- ✅ Prevents resource exhaustion (limit concurrent tasks)
- ✅ Provides status visibility
- ✅ Handles timeouts (kill tasks running too long)
- ✅ Persists state (survives Claude restarts)
- ✅ Notifications (know when tasks complete)

**Arguments AGAINST**:
- ❌ Adds significant complexity
- ❌ Duplicates some Task tool functionality
- ❌ Our use cases are typically < 5 parallel tasks (not 100)
- ❌ Claude Code might add this natively in future

### My Recommendation

**Start with lightweight approach**: Pattern enforcement only

```markdown
<!-- In skills that use background tasks -->

## Background Execution Best Practices

1. **Limit concurrency**: Launch max 3-5 tasks at once
2. **Track IDs**: Save task IDs for status checking
3. **Check completion**: Use TaskOutput before proceeding

ANTI-PATTERN:
```python
# DON'T spawn unlimited tasks
for i in range(100):
    Task(run_in_background=True)
```

PATTERN:
```python
# DO limit batch size
BATCH_SIZE = 3
for batch in chunks(tasks, BATCH_SIZE):
    for task in batch:
        Task(run_in_background=True)
    # Wait for batch to complete
```
```

**If needed later**: Add background manager
- Only if we see users spawning too many tasks
- Only if we need persistent state across restarts
- Only if notifications become critical

**Don't adopt yet** - wait to see if it's actually needed.

---

## Summary Table

| Feature | Our Status | Their Approach | Adopt? | Priority |
|---------|------------|---------------|--------|----------|
| **1. Boulder State** | SPEC/PLAN files (manual continuation) | State file (auto-continuation) | ✅ Yes | High |
| **2. Ralph Loop** | Instruction-based | Hook-enforced with state | ✅ Yes (add Stop hook) | High |
| **3. Rules Injector** | 3 specific hooks (marimo, jupytext, markdown) | General glob-based injector | ✅ Yes | Medium |
| **4. Context Injector** | Relies on CLAUDE.md | Auto-finds README.md, AGENTS.md | ✅ Yes | Low |
| **5. Background Manager** | Direct Task tool usage | Queue + concurrency + state | ⏸️ Not yet | Low |

## Implementation Order

1. **Stop hook for ralph-loop enforcement** (High priority, low effort)
   - Add hooks/scripts/ralph-loop/enforce-loop.py
   - Register Stop hook in hooks.json
   - Searches transcript for completion promise
   - Blocks stop if promise not found

2. **Boulder state for plan persistence** (High priority, medium effort)
   - Create .sisyphus/boulder.json state file
   - Hook on session start to check for active plans
   - Auto-inject continuation prompt
   - Track progress via checkbox counting

3. **General rules injector** (Medium priority, medium effort)
   - Support .claude/rules/*.md with YAML frontmatter
   - Glob pattern matching
   - Session-based deduplication
   - Keep existing specific hooks (marimo, jupytext)

4. **README/AGENTS context injector** (Low priority, low effort)
   - Find README.md in project root
   - Find AGENTS.md if exists
   - Find directory README when accessing files
   - Inject into context

5. **Background manager** (Not yet, high effort)
   - Wait to see if actually needed
   - Start with pattern enforcement in skills
   - Add manager only if users spawn too many tasks
