# Detailed Explanation of Proposed Changes from oh-my-claude-sisyphus

**Date**: 2026-01-09
**Context**: Breaking down the 5 high-priority features we could adopt from oh-my-claude-sisyphus

---

## 1. Boulder State System

### What It Is
A **persistent state management system** that tracks active work plans across multiple Claude sessions.

Think of it like this: You create a plan in one session, close Claude, come back tomorrow, and Claude remembers exactly what plan you were working on and how far you got.

### The Problem It Solves

**Current state (workflows plugin)**:
```
Session 1: User asks Claude to implement feature X
          Claude creates todos, starts work
          User closes terminal
Session 2: User comes back next day
          Claude has NO MEMORY of the plan
          User has to re-explain everything
```

**With boulder state**:
```
Session 1: User asks Claude to implement feature X
          Claude creates plan at .sisyphus/plans/feature-x.md
          Creates boulder.json tracking active plan
          Starts work
Session 2: User comes back next day
          Claude reads boulder.json
          "I see you're working on feature-x.md (3/10 tasks done)"
          Continues from where it left off
```

### Technical Implementation

**File structure**:
```
.sisyphus/
├── boulder.json          # Active plan tracker
└── plans/
    ├── feature-x.md      # Your plan with checkboxes
    └── refactor-y.md     # Another plan
```

**boulder.json example**:
```json
{
  "active_plan": "/path/to/project/.sisyphus/plans/feature-x.md",
  "started_at": "2026-01-09T10:00:00Z",
  "session_ids": ["sess_123", "sess_456", "sess_789"],
  "plan_name": "feature-x",
  "metadata": {}
}
```

**Plan file (feature-x.md)**:
```markdown
# Feature X Implementation Plan

## Phase 1: Setup
- [x] Create project structure
- [x] Initialize database
- [ ] Set up API routes

## Phase 2: Core Logic
- [ ] Implement user authentication
- [ ] Create data models
- [ ] Write business logic

Progress: 2/6 tasks complete
```

### How It Works

1. **Plan Creation**: When you start a big task, Claude creates a plan markdown file
   ```typescript
   const state: BoulderState = {
     active_plan: '/project/.sisyphus/plans/my-plan.md',
     started_at: new Date().toISOString(),
     session_ids: ['current-session-id'],
     plan_name: 'my-plan'
   };
   writeBoulderState(directory, state);
   ```

2. **Progress Tracking**: The system counts checkboxes in the plan
   ```typescript
   const progress = getPlanProgress(planPath);
   // { total: 6, completed: 2, isComplete: false }
   ```

3. **Session Continuity**: When you start a new session:
   ```typescript
   const boulder = readBoulderState(directory);
   if (boulder) {
     console.log(`Active plan: ${boulder.plan_name}`);
     console.log(`Progress: ${progress.completed}/${progress.total}`);
     // Claude automatically knows to continue this plan
   }
   ```

4. **Plan Completion**: When all checkboxes are marked:
   ```typescript
   if (progress.isComplete) {
     clearBoulderState(directory);
     // Plan is archived, boulder.json deleted
   }
   ```

### Why We Should Adopt It

**Current problem**: If you ask Claude to "refactor the entire codebase", it might:
- Start work
- Get interrupted
- Lose all context when you restart

**With boulder state**:
- Claude creates a detailed plan with checkboxes
- Tracks progress in boulder.json
- Every new session, Claude says "I see you're on task 5/20, continuing..."
- Works across days/weeks for long projects

---

## 2. Rules Injector Hook

### What It Is
A **runtime hook** that automatically finds and injects relevant instruction files whenever Claude reads or edits code.

Think of it like autocomplete for instructions: When Claude looks at a Python file, it automatically gets injected with Python-specific rules. When it looks at a React component, it gets React rules.

### The Problem It Solves

**Current state (workflows plugin)**:
```
You have .github/copilot-instructions.md with:
  "Always use TypeScript strict mode"
  "Never use any types"

Claude edits a TypeScript file
Claude uses 'any' types (didn't see the instructions)
```

**With rules injector**:
```
You have .github/copilot-instructions.md
Claude reads any file
Hook automatically injects copilot-instructions.md
Claude sees: "Never use any types"
Claude follows the rules
```

### Technical Implementation

**Rule file discovery** (automatic):
```
Project structure:
├── .github/
│   └── copilot-instructions.md    # Always applied
├── .claude/
│   └── rules/
│       ├── python.md               # Applied to *.py files
│       ├── react.md                # Applied to *.tsx files
│       └── api.md                  # Applied to src/api/**
└── src/
    ├── component.tsx
    └── api/
        └── users.py
```

**Rule file with frontmatter**:
```markdown
---
applies_to:
  - "**/*.tsx"
  - "**/*.jsx"
priority: 10
---

# React Component Rules

- Always use functional components
- Use hooks instead of class components
- Props must be typed with TypeScript interfaces
```

**How the hook works**:

1. **File Read Detection**:
   ```typescript
   // Claude runs: Read tool on "src/Button.tsx"
   // Hook intercepts PostToolUse event
   const filePath = "src/Button.tsx";
   ```

2. **Rule Discovery**:
   ```typescript
   const rules = findRuleFiles(projectRoot, homeDir, filePath);
   // Finds: .github/copilot-instructions.md
   //        .claude/rules/react.md (matches *.tsx)
   ```

3. **Frontmatter Parsing**:
   ```typescript
   const { metadata, body } = parseRuleFrontmatter(ruleContent);
   // metadata.applies_to = ["**/*.tsx", "**/*.jsx"]
   // Check if "src/Button.tsx" matches
   ```

4. **Injection**:
   ```markdown
   <system-reminder>
   The following rules apply to this file:

   ## React Component Rules
   - Always use functional components
   - Use hooks instead of class components
   - Props must be typed with TypeScript interfaces
   </system-reminder>

   [Original file content from Read tool...]
   ```

5. **Deduplication**:
   ```typescript
   // Track injected rules per session
   const cache = {
     contentHashes: new Set(),
     realPaths: new Set()
   };

   // Don't inject react.md twice in same session
   if (cache.realPaths.has('/project/.claude/rules/react.md')) {
     return; // Skip, already injected
   }
   ```

### Real-World Example

**Scenario**: You have a monorepo with different style guides

```
monorepo/
├── .claude/rules/
│   ├── backend-api.md
│   │   ---
│   │   applies_to: ["backend/**/*.py"]
│   │   ---
│   │   Use FastAPI with Pydantic models
│   │   All endpoints must have type hints
│   │
│   ├── frontend-ui.md
│   │   ---
│   │   applies_to: ["frontend/**/*.tsx"]
│   │   ---
│   │   Use Material-UI components
│   │   Follow atomic design patterns
│   │
│   └── database.md
│       ---
│       applies_to: ["**/migrations/*.sql", "**/models/*.py"]
│       ---
│       Never use CASCADE deletes
│       Always add indexes for foreign keys
```

**What happens**:
```python
# Claude reads backend/api/users.py
# Hook automatically injects:
#   - backend-api.md (matches backend/**/*.py)
#   - database.md (matches **/models/*.py)
#
# Claude sees both rules and follows them!
```

### Why We Should Adopt It

**Current state**: Our metadata system is **build-time only**
- We parse skill metadata to build delegation tables
- But those tables are static in skill files
- No runtime context awareness

**With rules injector**: **Runtime context awareness**
- Rules injected based on what file Claude is actually looking at
- Different rules for different parts of codebase
- Users can add rules without editing plugin files

**Concrete benefit**:
```
User adds: .claude/rules/api-standards.md
  applies_to: ["**/api/**/*.py"]
  "All APIs must use async/await"

Claude edits backend/api/auth.py
Hook injects api-standards.md
Claude automatically uses async/await

No plugin updates needed!
```

---

## 3. Ralph Loop

### What It Is
A **self-enforcing work loop** with state tracking that makes Claude continue working until a task is TRULY complete.

Think of it like a persistent alarm that keeps going off until you explicitly confirm the task is done, not just until Claude *thinks* it's done.

### The Problem It Solves

**Current state (3-failure protocol)**:
```markdown
## Failure Recovery Protocol

After 3 failed attempts:
1. STOP all implementation
2. REVERT changes
3. DOCUMENT what you tried
4. ASK user for guidance
```

**Problem**: This is just **instructions**. Claude might:
- Ignore the instructions
- Think it succeeded when it failed
- Stop too early
- Not actually count failures

**With Ralph Loop**: **State-enforced continuation**
```
Iteration 1: Claude tries to fix bug
             Tests still failing
             State file: iteration=1/10
             Loop continues

Iteration 2: Claude tries different approach
             Tests still failing
             State file: iteration=2/10
             Loop continues

Iteration 3: Claude finally fixes bug
             Tests pass
             Claude outputs: <promise>TASK_COMPLETE</promise>
             Loop detects completion, stops
```

### Technical Implementation

**State file** (`.sisyphus/ralph-state.json`):
```json
{
  "active": true,
  "iteration": 3,
  "max_iterations": 10,
  "completion_promise": "TASK_COMPLETE_XYZ123",
  "started_at": "2026-01-09T14:00:00Z",
  "prompt": "Fix the authentication bug in login.py",
  "session_id": "sess_current"
}
```

**How it works**:

1. **Start Loop**:
   ```bash
   /ralph-loop Fix all TypeScript errors in the codebase
   ```

   Creates state:
   ```typescript
   const state: RalphLoopState = {
     active: true,
     iteration: 1,
     max_iterations: 10,
     completion_promise: "TASK_COMPLETE_8f3a9b",  // Random token
     started_at: new Date().toISOString(),
     prompt: "Fix all TypeScript errors in the codebase",
     session_id: "sess_123"
   };
   writeRalphState(directory, state);
   ```

2. **Claude Works**:
   ```
   Claude: "I found 15 TypeScript errors. Fixing them now..."
   [Edits files]
   Claude: "Done! All errors fixed."
   ```

3. **Hook Checks Completion**:
   ```typescript
   // When session goes idle (Stop event)
   const completed = detectCompletionPromise(
     sessionId,
     "TASK_COMPLETE_8f3a9b"
   );

   if (!completed) {
     // NO completion promise found in transcript!
     incrementRalphIteration(directory);
     // iteration: 2

     return {
       continue: true,
       message: `[RALPH LOOP - ITERATION 2/10]

       Your previous attempt did not output the completion promise.
       Continue working on the task.

       IMPORTANT:
       - Run 'npm run typecheck' to verify
       - When TRULY complete, output: <promise>TASK_COMPLETE_8f3a9b</promise>

       Original task: Fix all TypeScript errors in the codebase`
     };
   }
   ```

4. **Claude Tries Again**:
   ```
   Claude: "Let me verify with typecheck..."
   [Runs npm run typecheck]
   Output: "Found 3 errors"
   Claude: "There are still errors. Fixing them..."
   [Edits more files]
   [Runs typecheck again]
   Output: "No errors found"
   Claude: "All TypeScript errors are now fixed."
   <promise>TASK_COMPLETE_8f3a9b</promise>
   ```

5. **Hook Detects Completion**:
   ```typescript
   const completed = detectCompletionPromise(
     sessionId,
     "TASK_COMPLETE_8f3a9b"
   );
   // Returns: true (found <promise> tag in transcript)

   clearRalphState(directory);

   return {
     continue: true,
     message: `[RALPH LOOP COMPLETE] Task completed after 2 iteration(s).`
   };
   ```

### Real-World Example

**Scenario**: "Make all tests pass"

**Without Ralph Loop**:
```
You: Make all tests pass
Claude: "I fixed the failing tests"
You: npm test
Result: 3 tests still failing
You: There are still 3 failing tests
Claude: "Let me fix those"
... repeat 5 times ...
```

**With Ralph Loop**:
```
You: /ralph-loop Make all tests pass
Claude: [Iteration 1] Fixes some tests
        [Runs tests]
        Output: 5 failures
        [Doesn't output promise]
Hook: "Iteration 1 incomplete, continue..."
Claude: [Iteration 2] Fixes more tests
        [Runs tests]
        Output: 2 failures
        [Doesn't output promise]
Hook: "Iteration 2 incomplete, continue..."
Claude: [Iteration 3] Fixes remaining tests
        [Runs tests]
        Output: All tests pass! ✓
        <promise>TASK_COMPLETE_abc123</promise>
Hook: "Loop complete after 3 iterations"
```

### Why We Should Adopt It

**Our 3-failure protocol** is instruction-based:
- Claude might not count failures correctly
- No enforcement mechanism
- Easy to ignore

**Ralph Loop** is state-based:
- **Cannot** be ignored (hook enforces it)
- **Automatic** iteration counting
- **Objective** completion criteria (must output promise)
- **Prevents** premature stopping

**When it's valuable**:
- Long, multi-step tasks
- Tasks with objective completion criteria (tests pass, build succeeds)
- When you want Claude to work autonomously until done

---

## 4. Context Injector

### What It Is
A **systematic context collection system** that automatically finds and injects relevant documentation (README files, AGENTS.md, etc.) into Claude's context when starting sessions or accessing files.

Think of it like having an assistant who reads all the relevant docs before helping you, every single time.

### The Problem It Solves

**Current state**:
```
Your project has:
  README.md with important architecture notes
  docs/AGENTS.md with agent knowledge base
  backend/README.md with API conventions

Claude starts working
Claude doesn't read any of these
Claude makes changes that violate conventions
```

**With context injector**:
```
Claude starts session
Injector finds: README.md, docs/AGENTS.md
Claude reads file in backend/
Injector finds: backend/README.md
Claude now has full context
Claude follows all conventions
```

### Technical Implementation

**Context collection**:
```typescript
interface ContextEntry {
  source: string;         // File path
  content: string;        // File content
  priority: number;       // Injection order
  metadata?: {
    type: 'readme' | 'agents' | 'rules';
    scopeLevel: 'project' | 'directory';
  };
}

class ContextCollector {
  private pending: Map<string, ContextEntry[]> = new Map();

  collect(sessionId: string, directory: string): void {
    const entries: ContextEntry[] = [];

    // Find project README
    const projectReadme = join(directory, 'README.md');
    if (existsSync(projectReadme)) {
      entries.push({
        source: projectReadme,
        content: readFileSync(projectReadme, 'utf-8'),
        priority: 10,
        metadata: { type: 'readme', scopeLevel: 'project' }
      });
    }

    // Find AGENTS.md (agent knowledge base)
    const agentsMd = join(directory, 'AGENTS.md');
    if (existsSync(agentsMd)) {
      entries.push({
        source: agentsMd,
        content: readFileSync(agentsMd, 'utf-8'),
        priority: 20,
        metadata: { type: 'agents', scopeLevel: 'project' }
      });
    }

    this.pending.set(sessionId, entries);
  }

  consume(sessionId: string): { merged: string; entries: ContextEntry[] } {
    const entries = this.pending.get(sessionId) || [];
    this.pending.delete(sessionId);

    // Sort by priority, merge into single string
    const sorted = entries.sort((a, b) => a.priority - b.priority);
    const merged = sorted.map(e =>
      `# Context from ${e.source}\n\n${e.content}`
    ).join('\n\n---\n\n');

    return { merged, entries };
  }
}
```

**Injection into prompt**:
```typescript
// When Claude starts or reads a file
const collector = new ContextCollector();
collector.collect(sessionId, workingDirectory);

// Later, when generating prompt
const { merged, entries } = collector.consume(sessionId);

const finalPrompt = `
<injected-context>
${merged}
</injected-context>

---

${userPrompt}
`;
```

### Real-World Example

**Project structure**:
```
my-app/
├── README.md
│   # My App
│
│   Uses microservices architecture
│   All services must use async/await
│
├── AGENTS.md
│   # Agent Knowledge Base
│
│   ## oracle
│   Use oracle for complex debugging
│
│   ## explore
│   Use explore for quick searches
│
└── backend/
    ├── README.md
    │   # Backend Service
    │
    │   FastAPI + PostgreSQL
    │   All endpoints must have Pydantic models
    │
    └── api/
        └── users.py
```

**What happens**:

1. **Session Start**:
   ```typescript
   // Context injector runs
   collector.collect(sessionId, '/my-app');

   // Finds and collects:
   // - /my-app/README.md (project architecture)
   // - /my-app/AGENTS.md (agent knowledge)
   ```

2. **Claude Reads backend/api/users.py**:
   ```typescript
   // Directory README injector hook runs
   // Finds: /my-app/backend/README.md
   // Adds to pending context
   ```

3. **Context is Injected**:
   ```markdown
   <injected-context>
   # Context from /my-app/README.md

   # My App
   Uses microservices architecture
   All services must use async/await

   ---

   # Context from /my-app/AGENTS.md

   ## oracle
   Use oracle for complex debugging

   ## explore
   Use explore for quick searches

   ---

   # Context from /my-app/backend/README.md

   # Backend Service
   FastAPI + PostgreSQL
   All endpoints must have Pydantic models
   </injected-context>

   ---

   [User prompt or file content...]
   ```

### Why We Should Adopt It

**Current state**: Relies on Claude Code's CLAUDE.md support
- Only reads `.claude/CLAUDE.md`
- Doesn't automatically find README files
- No directory-specific context
- No agent knowledge base injection

**With context injector**: Systematic context discovery
- **Automatic README detection** at project and directory levels
- **AGENTS.md support** for agent knowledge bases
- **Hierarchical context** (project → directory → file)
- **Deduplication** to avoid repeating same context

**When it's valuable**:
- Large projects with multiple READMEs
- When you have agent knowledge bases
- When different directories have different conventions
- To ensure Claude always has relevant context

**Note**: Might overlap with Claude Code's native CLAUDE.md support, so we'd need to integrate carefully.

---

## 5. Background Task Manager

### What It Is
A **task queue and concurrency control system** that tracks background agents, manages how many run simultaneously, and provides status updates.

Think of it like a job queue: You submit multiple tasks, the manager ensures only N run at once, and you can check status anytime.

### The Problem It Solves

**Current state**:
```python
# In dev-explore skill
Task(
    prompt="Search for all API endpoints",
    subagent_type="Explore",
    run_in_background=true
)

Task(
    prompt="Search for all database queries",
    subagent_type="Explore",
    run_in_background=true
)

# Problems:
# - No way to check if they're done
# - No concurrency limits (could spawn 100 agents)
# - No status tracking
# - No timeout handling
```

**With background task manager**:
```typescript
// Submit tasks to queue
manager.submitTask({
  id: "search-apis",
  prompt: "Search for all API endpoints",
  subagent: "Explore"
});

manager.submitTask({
  id: "search-db",
  prompt: "Search for all database queries",
  subagent: "Explore"
});

// Manager enforces:
// - Max 3 concurrent tasks
// - 30-minute timeout per task
// - Status tracking (pending → running → completed)
// - Notification on completion
```

### Technical Implementation

**Task queue and status**:
```typescript
interface BackgroundTask {
  id: string;                    // Unique task ID
  status: TaskStatus;            // pending | running | completed | failed
  prompt: string;                // Task description
  subagent: string;              // Which agent to use
  createdAt: Date;               // When submitted
  startedAt?: Date;              // When started running
  completedAt?: Date;            // When finished
  result?: string;               // Output
  error?: string;                // Error message if failed
  sessionId: string;             // Associated session
}

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
```

**Concurrency manager**:
```typescript
class ConcurrencyManager {
  private maxConcurrent: number = 3;  // Max 3 tasks running simultaneously
  private running: Set<string> = new Set();

  canStart(): boolean {
    return this.running.size < this.maxConcurrent;
  }

  acquire(taskId: string): boolean {
    if (!this.canStart()) return false;
    this.running.add(taskId);
    return true;
  }

  release(taskId: string): void {
    this.running.delete(taskId);
  }
}
```

**Background manager**:
```typescript
class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private concurrency: ConcurrencyManager;

  async submitTask(config: {
    prompt: string;
    subagent: string;
    sessionId: string;
  }): Promise<string> {
    const taskId = this.generateTaskId();

    const task: BackgroundTask = {
      id: taskId,
      status: 'pending',
      prompt: config.prompt,
      subagent: config.subagent,
      createdAt: new Date(),
      sessionId: config.sessionId
    };

    this.tasks.set(taskId, task);
    this.persistTask(task);  // Save to disk
    this.tryStartTasks();     // Try to start pending tasks

    return taskId;
  }

  private tryStartTasks(): void {
    const pending = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending');

    for (const task of pending) {
      if (this.concurrency.canStart()) {
        this.startTask(task);
      } else {
        break;  // Queue is full
      }
    }
  }

  private async startTask(task: BackgroundTask): Promise<void> {
    if (!this.concurrency.acquire(task.id)) return;

    task.status = 'running';
    task.startedAt = new Date();
    this.persistTask(task);

    try {
      // Launch actual Claude Code Task tool
      const result = await executeBackgroundAgent(task);

      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
    } finally {
      this.concurrency.release(task.id);
      this.persistTask(task);
      this.tryStartTasks();  // Start next pending task
    }
  }

  getStatus(taskId: string): BackgroundTask | null {
    return this.tasks.get(taskId) ?? null;
  }

  getAllTasks(sessionId: string): BackgroundTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.sessionId === sessionId);
  }
}
```

**Persistence**:
```typescript
// Tasks saved to: ~/.claude/.sisyphus/background-tasks/
//   bg_abc123.json
//   bg_def456.json

private persistTask(task: BackgroundTask): void {
  const path = `~/.claude/.sisyphus/background-tasks/${task.id}.json`;
  writeFileSync(path, JSON.stringify(task, null, 2));
}

// On startup, load all persisted tasks
private loadPersistedTasks(): void {
  const files = readdirSync('~/.claude/.sisyphus/background-tasks/');
  for (const file of files) {
    const task = JSON.parse(readFileSync(file, 'utf-8'));
    this.tasks.set(task.id, task);
  }
}
```

### Real-World Example

**Scenario**: Parallel codebase exploration

```typescript
// User: "Search for all the different patterns in the codebase"

const manager = new BackgroundManager();

// Submit 5 exploration tasks
const tasks = [
  "Find all React components",
  "Find all API endpoints",
  "Find all database queries",
  "Find all test files",
  "Find all configuration files"
];

for (const prompt of tasks) {
  const taskId = await manager.submitTask({
    prompt,
    subagent: "Explore",
    sessionId: "sess_123"
  });
  console.log(`Submitted: ${taskId}`);
}

// Status tracking
setInterval(() => {
  const allTasks = manager.getAllTasks("sess_123");
  const pending = allTasks.filter(t => t.status === 'pending').length;
  const running = allTasks.filter(t => t.status === 'running').length;
  const completed = allTasks.filter(t => t.status === 'completed').length;

  console.log(`Tasks: ${pending} pending, ${running} running, ${completed} completed`);
}, 5000);

// With concurrency limit = 3:
// Time 0s:  Task 1 (running), Task 2 (running), Task 3 (running), Task 4 (pending), Task 5 (pending)
// Time 10s: Task 1 (done), Task 2 (running), Task 3 (running), Task 4 (running), Task 5 (pending)
// Time 20s: Task 2 (done), Task 3 (done), Task 4 (running), Task 5 (running)
// Time 30s: All tasks completed
```

**Notification hook**:
```typescript
// When a background task completes
// background-notification hook injects message:

<system-reminder>
Background task completed: "Find all React components"
Status: completed
Duration: 12.3 seconds

Results available via TaskOutput tool.
</system-reminder>
```

### Why We Should Adopt It

**Current state**: Direct Task tool usage
```python
# We just call Task with run_in_background=true
Task(prompt="...", run_in_background=true)

# No tracking
# No concurrency control
# No status visibility
```

**With background task manager**:
- **Concurrency control**: Prevent spawning 100 agents simultaneously
- **Status tracking**: Know which tasks are running/done
- **Timeout handling**: Kill tasks that run too long
- **Notifications**: Get alerted when tasks complete
- **Persistence**: Tasks survive Claude restarts

**When it's valuable**:
- Running many parallel exploration tasks
- Long-running background operations
- Need to check task status mid-execution
- Want to prevent resource exhaustion

**Note**: This might partially duplicate Claude Code's native Task tool capabilities. We'd need to evaluate if the added complexity is worth it, or if we can just formalize patterns around the existing Task tool.

---

## Summary Comparison

| Feature | Current State | With Adoption | Complexity |
|---------|--------------|---------------|------------|
| **1. Boulder State** | No plan persistence | Plans survive sessions | Medium |
| **2. Rules Injector** | Build-time metadata only | Runtime context-aware injection | High |
| **3. Ralph Loop** | Instruction-based protocol | State-enforced continuation | Medium |
| **4. Context Injector** | Relies on CLAUDE.md | Systematic README/AGENTS.md discovery | Low |
| **5. Background Manager** | Direct Task tool usage | Queue + concurrency + status | High |

## Recommendations

### Adopt Soon
1. **Boulder State** - High value for multi-session tasks, medium complexity
2. **Ralph Loop** - Significantly better than instruction-based protocol

### Evaluate Carefully
3. **Rules Injector** - High value but might overlap with our metadata system
4. **Context Injector** - Might conflict with Claude Code's CLAUDE.md support

### Lower Priority
5. **Background Manager** - Adds complexity, may duplicate Task tool features

Each feature would require 2-5 days of implementation work to adapt to our plugin architecture.
