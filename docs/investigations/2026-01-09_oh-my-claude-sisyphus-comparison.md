# Oh-My-Claude-Sisyphus vs Workflows Implementation Comparison

**Date**: 2026-01-09
**Context**: Analyzing implementation differences between our oh-my-opencode patterns integration and the oh-my-claude-sisyphus fork

## Overview

Both projects port patterns from [oh-my-opencode](https://github.com/obra/oh-my-opencode) to Claude Code, but use fundamentally different architectural approaches:

- **oh-my-claude-sisyphus**: TypeScript runtime with shell hook bridge
- **workflows (our plugin)**: Python skill metadata with direct hooks integration

## Key Architectural Differences

### 1. Hooks System

#### oh-my-claude-sisyphus
```
Shell Hook (.sh) → TypeScript Bridge → Hook Logic (TypeScript)
                    ↓
              JSON stdin/stdout
```

- Shell hooks invoke `hook-bridge.mjs` with `--hook=<type>`
- TypeScript bridge processes JSON input/output
- Complex logic in TypeScript modules (keyword-detector, ralph-loop, etc.)
- Hooks generate shell scripts during installation

**Files**: `src/hooks/bridge.ts`, individual hook modules

#### workflows (our approach)
```
Python Hook (.py) → Direct Hook Logic (Python)
                    ↓
              System output or modifications
```

- Direct Python hook execution
- PostToolUse hooks for tool interception (jupytext, marimo)
- No bridge layer needed
- Hooks are Python scripts directly

**Files**: `hooks/scripts/*/`, `hooks/hooks.json`

### 2. Agent Organization

#### oh-my-claude-sisyphus
- **11 agents** as TypeScript modules: `src/agents/oracle.ts`, `librarian.ts`, etc.
- Agent definitions generate markdown agent files during installation
- Centralized agent registry in `definitions.ts`
- Agents installed to `~/.claude/agents/`

**Structure**:
```typescript
export const oracleAgent: AgentDefinition = {
  name: 'oracle',
  description: '...',
  model: 'opus',
  tools: ['Read', 'Grep', ...],
  prompt: `...`
};
```

#### workflows (our approach)
- **15+ skills** as markdown files in `skills/` directory
- Each skill is self-contained markdown with YAML frontmatter
- Skills are Claude Code plugin skills, not agents
- No installation step - skills exist in plugin directory

**Structure**:
```markdown
---
name: dev-debug
description: "Debug issues systematically"
category: workflow
cost: CHEAP
---

# Debug Skill

[Skill content...]
```

### 3. State Management

#### oh-my-claude-sisyphus: Boulder State
- Dedicated state management system: `src/features/boulder-state/`
- Tracks active work plans in `~/.claude/.sisyphus/boulder.json`
- Plan progress tracking, session association
- Prometheus plan storage in `~/.sisyphus/plans/`

**Features**:
- `BoulderState` type for active plan tracking
- Plan progress monitoring
- Session-based state management
- Notepad system for session notes

#### workflows (our approach)
- **No dedicated state management**
- Relies on Claude Code's native session state
- TodoWrite tool for task tracking
- No persistent plan storage

**Gap**: We don't have plan state persistence or cross-session task tracking

### 4. Skill/Command System

#### oh-my-claude-sisyphus
- **Builtin skills**: TypeScript templates in `src/features/builtin-skills/`
- **Slash commands**: Generated markdown in `~/.claude/commands/`
- Installation generates both agents and commands
- Skills as injected prompts, not Claude Code skills

**Commands**: `/sisyphus`, `/ultrawork`, `/ralph-loop`, `/prometheus`, etc.

#### workflows (our approach)
- **Plugin skills**: Native Claude Code skills in `skills/`
- Skills invoked via `/skill-name` from plugin
- No separate commands directory
- Skills are markdown files with frontmatter metadata

**Skills**: `/dev-explore`, `/ds-plan`, `/wrds`, `/lseg-data`, etc.

### 5. Context Injection

#### oh-my-claude-sisyphus
- Systematic context injector: `src/features/context-injector/`
- Collects context from:
  - `CLAUDE.md` (project/user config)
  - `AGENTS.md` (agent knowledge base)
  - README files via `directory-readme-injector` hook
- Context collector with metadata extraction
- Automatic injection on every session

**Files**: `src/features/context-injector/`, `src/hooks/directory-readme-injector/`

#### workflows (our approach)
- Environment context injection in specific skills
- Date/time/locale awareness added to: `wrds`, `lseg-data`, `gemini-batch`
- No systematic context collection
- Relies on Claude Code's CLAUDE.md support

**Gap**: We don't have systematic README or agent knowledge injection

### 6. Metadata System

#### oh-my-claude-sisyphus
- **Rules Injector Hook**: `src/hooks/rules-injector/`
- Parses YAML frontmatter from ANY file
- Glob-based rule matching
- Session-based deduplication
- Injects rules into prompts dynamically

**Features**:
- Parse YAML from tool results
- Match rules to current context
- Deduplicate injections per session
- Storage in `~/.claude/.sisyphus/rules-injector/`

#### workflows (our approach)
- **Skill Metadata Registry**: `common/metadata/skill-metadata.py`
- Parses YAML frontmatter from skills only
- Builds decision tables dynamically
- Used for delegation and cost classification

**Features**:
- `SkillMetadataRegistry` for skill indexing
- `build_trigger_table()`, `build_cost_table()`, `build_delegation_table()`
- Metadata used by parent skills to decide delegation

**Difference**: Their rules injector is a **runtime hook** that injects on every tool use. Our metadata system is a **build-time tool** for generating delegation tables.

### 7. Background Execution

#### oh-my-claude-sisyphus
- Dedicated background agent manager: `src/features/background-agent/`
- Task queue with concurrency control
- Status tracking (pending, running, completed)
- Background task notifications hook

**Features**:
```typescript
export class BackgroundManager {
  private tasks: Map<string, BackgroundTask>;
  private concurrency: ConcurrencyController;

  async submitTask(task: BackgroundTask): Promise<void>;
  async getTaskStatus(taskId: string): TaskStatus;
}
```

#### workflows (our approach)
- Uses Claude Code's native `run_in_background=true`
- Pattern enforcement in skills: `dev-explore`, `ds-plan`
- No task queue or concurrency management
- Relies on Task tool's background execution

**Pattern in skills**:
```markdown
## Background Execution

ALWAYS use run_in_background=true when launching exploration agents:

```python
Task(
    prompt="Explore X",
    subagent_type="Explore",
    run_in_background=true
)
```
```

### 8. Installation & Distribution

#### oh-my-claude-sisyphus
- **npm package**: `oh-my-claude-sisyphus`
- Installation script generates files in `~/.claude/`
- One-liner install: `curl ... | bash`
- Auto-update system with silent background checks

**Generated files**:
```
~/.claude/
├── agents/          # 11 agent .md files
├── commands/        # 11 command .md files
├── sisyphus/        # Runtime (hook-bridge.mjs, hooks/)
└── CLAUDE.md        # Global prompt
```

#### workflows (our approach)
- **Claude Code plugin**: Direct integration
- Plugin installed to `~/.claude/plugins/workflows/`
- No installation script needed
- Skills/hooks exist in plugin directory
- Version bumps via git commits

**Plugin structure**:
```
.claude-plugin/
├── plugin.json
├── marketplace.json
├── skills/
├── hooks/
└── common/
```

### 9. Failure Recovery

#### oh-my-claude-sisyphus
- **Ralph Loop**: Self-referential work loop in `src/hooks/ralph-loop/`
- State-based iteration tracking
- Completion promise detection
- Max iterations enforcement
- Active session tracking

**Features**:
- `ralph.json` state file
- `/ralph-loop <task>` command
- `/cancel-ralph` to abort
- Completion via `<promise>TOKEN</promise>`

#### workflows (our approach)
- **3-Failure Protocol**: Integrated in `dev-debug`, `dev-implement`
- No session state tracking
- Enforcement via skill instructions

**Pattern**:
```markdown
## Failure Recovery Protocol

After 3 failed attempts:
1. STOP all implementation
2. REVERT changes if safe
3. DOCUMENT what you tried
4. CONSULT oracle/metis agent
5. ASK user for guidance
```

**Difference**: Theirs is **runtime-enforced with state**. Ours is **instruction-based**.

### 10. Tool Restrictions

#### oh-my-claude-sisyphus
- AST tools: `src/tools/ast-tools.ts`
- LSP tools: `src/tools/lsp/` (11 LSP tools)
- Enhanced tool integrations

**LSP Tools**: `lsp_hover`, `lsp_goto_definition`, `lsp_find_references`, etc.

#### workflows (our approach)
- **Tool restriction patterns**: `common/helpers/tool-restrictions.md`
- Instructions for denying tools in Task delegation
- No custom tool implementations

**Pattern**:
```markdown
For read-only exploration:
tools_denied: ['Write', 'Edit', 'Bash']

For analysis-only:
tools_denied: ['Write', 'Edit', 'Task']
```

## Implementation Philosophy Differences

### oh-my-claude-sisyphus
- **Runtime orchestration**: TypeScript runtime with state management
- **Hook-driven**: Heavy use of lifecycle hooks for enforcement
- **Installation-based**: Generate files on user system
- **State-persistent**: Track tasks, plans, sessions across restarts
- **Agent-centric**: 11 specialized agents coordinated by hooks

### workflows (our approach)
- **Metadata-driven**: Build decision tables from skill metadata
- **Instruction-based**: Behavioral enforcement via detailed skill instructions
- **Plugin-native**: Self-contained Claude Code plugin
- **Stateless**: Rely on Claude Code's session management
- **Skill-centric**: 15+ skills with clear delegation patterns

## Strengths Comparison

### oh-my-claude-sisyphus Advantages
1. ✅ **Persistent state**: Boulder state, Ralph loop tracking, session recovery
2. ✅ **Runtime enforcement**: Hooks actively prevent bad behavior
3. ✅ **Background task management**: Dedicated manager with concurrency control
4. ✅ **Auto-update**: Silent background updates
5. ✅ **LSP integration**: 11 LSP tools for code intelligence
6. ✅ **Context injection**: Systematic README/AGENTS.md injection
7. ✅ **Rules injection**: Dynamic rule injection from YAML frontmatter

### workflows Advantages
1. ✅ **Simpler architecture**: No bridge layer, no installation scripts
2. ✅ **Native plugin**: Direct Claude Code integration
3. ✅ **Metadata system**: Dynamic delegation table generation
4. ✅ **Domain-specific skills**: WRDS, LSEG, Gemini Batch integrations
5. ✅ **Enforcement patterns**: Comprehensive documentation of patterns
6. ✅ **Cost classification**: FREE/CHEAP/EXPENSIVE agent routing
7. ✅ **Structured delegation**: 8-section delegation template

## What We Could Learn From Their Implementation

### High Priority
1. **Boulder State System** (`src/features/boulder-state/`)
   - Plan persistence across sessions
   - Progress tracking for multi-session tasks
   - Could integrate with TodoWrite tool

2. **Rules Injector Hook** (`src/hooks/rules-injector/`)
   - Runtime YAML frontmatter injection
   - Could enhance our metadata system
   - Session-based deduplication pattern

3. **Ralph Loop** (`src/hooks/ralph-loop/`)
   - State-based task continuation
   - Completion promise pattern
   - Could improve our 3-failure protocol

### Medium Priority
4. **Context Injector** (`src/features/context-injector/`)
   - Systematic README injection
   - AGENTS.md knowledge base
   - Could enhance skill awareness

5. **Background Task Manager** (`src/features/background-agent/`)
   - Concurrency control patterns
   - Task status tracking
   - Could formalize our background patterns

### Low Priority
6. **Auto-Update System** (`src/features/auto-update.ts`)
   - Silent update checks
   - Less critical for plugin distribution

7. **LSP Tools** (`src/tools/lsp/`)
   - Code intelligence integration
   - Nice-to-have for code-heavy workflows

## What They Could Learn From Our Implementation

### High Priority
1. **Skill Metadata System** (`common/metadata/skill-metadata.py`)
   - Dynamic delegation table generation
   - Extensible without editing orchestrators
   - Cost-based routing

2. **Domain Integration Patterns** (WRDS, LSEG, Gemini Batch)
   - Date awareness for API calls
   - External service integration patterns
   - Environment context injection

3. **Enforcement Pattern Documentation** (`common/OH-MY-OPENCODE-PATTERNS.md`)
   - Comprehensive pattern reference
   - Clear implementation examples
   - Migration guide from oh-my-opencode

### Medium Priority
4. **Structured Delegation Template** (`common/templates/delegation-template.md`)
   - 8-section task contract
   - Clear success criteria
   - Verification checklist

5. **Plugin Architecture**
   - Self-contained distribution
   - No installation scripts needed
   - Native Claude Code integration

## Recommendations

### For workflows (our plugin)
Consider adopting from sisyphus:
1. ✅ **Boulder state** for plan persistence
2. ✅ **Rules injector hook** for runtime YAML injection
3. ✅ **Ralph loop** state-based continuation
4. ⚠️ **Context injector** (may conflict with Claude Code's CLAUDE.md)
5. ⚠️ **Background manager** (may duplicate Claude Code's Task tool)

### For oh-my-claude-sisyphus
Consider adopting from workflows:
1. ✅ **Metadata-driven delegation tables**
2. ✅ **Cost classification system**
3. ✅ **Structured delegation template**
4. ✅ **Domain integration patterns** (date awareness, API context)

## Conclusion

**oh-my-claude-sisyphus**: A sophisticated **runtime orchestration system** with persistent state, lifecycle hooks, and active enforcement mechanisms. Best for users who want automated task continuation, session recovery, and hands-off orchestration.

**workflows**: A **metadata-driven skill library** with instruction-based enforcement and native plugin integration. Best for users who want domain-specific skills, simpler architecture, and flexible delegation patterns.

Both are valid approaches to porting oh-my-opencode patterns to Claude Code. The choice depends on:
- **State persistence needs**: Sisyphus wins
- **Architectural simplicity**: workflows wins
- **Runtime enforcement**: Sisyphus wins
- **Domain integrations**: workflows wins
- **Metadata extensibility**: workflows wins
- **Background task management**: Sisyphus wins

## Next Steps

For workflows plugin, highest-value additions from sisyphus:
1. Implement boulder state for plan persistence
2. Create rules injector hook for runtime YAML injection
3. Add ralph loop for state-based continuation
4. Document migration path for sisyphus users
