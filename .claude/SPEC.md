# SPEC: Boulder State + Enhanced Hooks

**Date**: 2026-01-09
**Scope**: Add boulder state persistence, ralph-loop enforcement, rules injector, and context injector

## Objectives

Implement 4 features inspired by oh-my-claude-sisyphus:

1. **Boulder State**: Persistent plan tracking across sessions
2. **Ralph Loop Stop Hook**: Enforce completion promise verification
3. **General Rules Injector**: User-extensible instruction injection
4. **Context Injector**: Automatic README.md and AGENTS.md discovery

## Success Criteria

### 1. Boulder State

**File**: `~/.claude/.boulder.json` (global, single active plan)

**Structure**:
```json
{
  "active_plan": "/absolute/path/to/project/.claude/PLAN.md",
  "project_root": "/absolute/path/to/project",
  "plan_name": "feature-name",
  "started_at": "2026-01-09T10:00:00Z",
  "session_ids": ["sess_123", "sess_456"],
  "progress": {
    "total": 20,
    "completed": 5
  },
  "metadata": {}
}
```

**Creation Triggers**:
- [ ] `/dev-design` skill automatically creates boulder.json when writing PLAN.md
- [ ] `SessionStart` hook checks if PLAN.md exists without boulder.json, creates it

**Session Continuity**:
- [ ] `SessionStart` hook reads boulder.json
- [ ] If active_plan exists, inject continuation message:
  ```
  [BOULDER STATE DETECTED]

  Active plan: feature-name
  Progress: 5/20 tasks complete
  Plan location: .claude/PLAN.md

  Continuing from where you left off.
  ```

**Progress Tracking**:
- [ ] Count checkboxes in PLAN.md: `- [ ]` (unchecked), `- [x]` (checked)
- [ ] Update boulder.json progress on plan modification

**Completion**:
- [ ] When all checkboxes checked (progress.completed == progress.total), clear boulder.json
- [ ] User can manually clear: `/boulder-clear` command

**Edge Cases**:
- [ ] If PLAN.md deleted but boulder.json exists, warn and offer to clear
- [ ] If boulder.json points to different project, detect and update
- [ ] If user creates PLAN.md in different project, prompt to switch boulder

### 2. Ralph Loop Stop Hook

**File**: `hooks/scripts/ralph-loop/enforce-loop.py`

**Behavior**:
- [ ] Triggers on `Stop` event
- [ ] Checks if we're in an active ralph loop (search transcript for `/ralph-wiggum:ralph-loop`)
- [ ] If not in loop, allow stop (return continue: true)
- [ ] If in loop:
  - [ ] Extract `--completion-promise` argument from skill invocation
  - [ ] Search transcript for `<promise>TOKEN</promise>` tag
  - [ ] If found: Allow stop, inject completion message
  - [ ] If not found: Block stop, inject continuation message

**Transcript Parsing**:
- [ ] Find most recent `/ralph-wiggum:ralph-loop` invocation in transcript
- [ ] Parse arguments: `--completion-promise "TASK1_DONE"`
- [ ] Handle escaped quotes, spaces in token

**Messages**:

Success (promise found):
```
[RALPH LOOP COMPLETE]

Completion promise detected: <promise>TASK1_DONE</promise>
Ralph loop has ended.
```

Blocked (promise not found):
```
[RALPH LOOP ENFORCEMENT]

The completion promise was not output. The loop must continue.

Expected promise: <promise>TASK1_DONE</promise>

Continue working on the task. Output the promise only when the task is TRULY complete.
```

**Edge Cases**:
- [ ] Multiple nested ralph loops (check most recent)
- [ ] Promise in code block or comment (should NOT count as completion)
- [ ] Malformed promise tag

### 3. General Rules Injector

**Files**: `hooks/scripts/rules/rules-injector.py`

**Discovery Paths** (in order of priority):
1. `.github/copilot-instructions.md` (always applied, no frontmatter needed)
2. `.claude/rules/*.md` (project-level)
3. `~/.claude/rules/*.md` (user-level, global)

**YAML Frontmatter Format**:
```yaml
---
applies_to:
  - "**/*.tsx"
  - "**/*.jsx"
priority: 10
tags: ["frontend", "react"]
---

# Rule Content

Your instructions here...
```

**Trigger**: `PostToolUse` on `Read` or `Edit` tools

**Matching Logic**:
- [ ] Get file path from tool input
- [ ] Find all rule files in discovery paths
- [ ] Parse YAML frontmatter from each rule
- [ ] Check if file path matches any `applies_to` glob pattern
- [ ] Sort by priority (higher = injected first)
- [ ] Deduplicate by file content hash (session-based cache)

**Injection**:
```markdown
<system-reminder>
The following rules apply to this file:

# Rule from .claude/rules/react.md

- Always use functional components
- Props must be typed
</system-reminder>
```

**Session Cache**: `~/.claude/.sisyphus/rules-injector/session-{ID}.json`
```json
{
  "injected_hashes": ["abc123", "def456"],
  "injected_paths": ["/project/.claude/rules/react.md"]
}
```

**Edge Cases**:
- [ ] Invalid YAML frontmatter (skip rule, log warning)
- [ ] Circular includes (max depth limit)
- [ ] Very large rule files (truncate at 10k chars)

### 4. Context Injector

**Files**: `hooks/scripts/context/inject-context.py`

**Trigger**: `SessionStart` hook

**Discovery Logic**:
- [ ] Find `README.md` in project root (if exists)
- [ ] Find `AGENTS.md` in project root (if exists)
- [ ] Find `.claude/CLAUDE.md` (already injected by Claude Code, skip)

**Injection Strategy**:
```markdown
<system-reminder>
The following project documentation is available:

# README.md

[First 500 lines of README.md...]

---

# AGENTS.md

[Full content of AGENTS.md...]

</system-reminder>
```

**Limits**:
- [ ] README.md: First 500 lines only (prevent context explosion)
- [ ] AGENTS.md: Full file (typically small)
- [ ] Total combined: Max 50k characters

**Session Cache**: Track injected files to avoid re-injection on resume

**Directory-Specific README** (future enhancement):
- [ ] When Claude reads file in `backend/api/users.py`
- [ ] Check if `backend/README.md` exists
- [ ] Inject on first file read in that directory (per session)

**Edge Cases**:
- [ ] Missing files (silently skip)
- [ ] Binary README (check encoding, skip if not UTF-8)
- [ ] Very large README (truncate with warning)

## Non-Functional Requirements

### File Organization
```
hooks/
├── hooks.json                  # Add new hooks
└── scripts/
    ├── common/
    │   ├── session-start.py    # MODIFY: Add boulder + context injection
    │   └── cleanup-session.py  # MODIFY: Update boulder sessions list
    ├── ralph-loop/
    │   └── enforce-loop.py     # NEW: Stop hook
    ├── rules/
    │   ├── rules-injector.py   # NEW: PostToolUse hook
    │   ├── matcher.py          # NEW: Glob matching utilities
    │   └── parser.py           # NEW: YAML frontmatter parser
    └── context/
        ├── inject-context.py   # NEW: SessionStart hook
        └── collector.py        # NEW: README discovery utilities

common/
└── hooks/
    └── scripts/
        ├── boulder.py          # NEW: Boulder state management
        ├── transcript.py       # NEW: Transcript parsing utilities
        └── markdown_validators.py  # EXISTING: Reuse for markdown parsing
```

### Data Storage
```
~/.claude/
├── .boulder.json               # NEW: Global active plan tracker
├── .sisyphus/
│   ├── rules-injector/
│   │   └── session-*.json      # NEW: Session injection cache
│   └── context-injector/
│       └── session-*.json      # NEW: Session context cache
└── rules/                      # NEW: User-global rule files
    ├── python.md
    └── typescript.md

project/.claude/
└── rules/                      # NEW: Project-specific rule files
    ├── api-standards.md
    └── testing.md
```

### Performance
- [ ] Boulder progress check: < 100ms (checkbox counting)
- [ ] Rules matching: < 200ms (glob pattern matching)
- [ ] Context injection: < 500ms (README parsing)
- [ ] Total session start overhead: < 1 second

### Error Handling
- [ ] All hooks: Non-blocking (errors logged, continue operation)
- [ ] Invalid JSON: Log warning, use defaults
- [ ] Missing files: Silent skip
- [ ] Malformed frontmatter: Skip rule, log warning

## Testing Requirements

### Manual Testing Scenarios

**Boulder State**:
1. Create PLAN.md via /dev-design → boulder.json created
2. Close Claude, reopen → continuation message shown
3. Complete all tasks in PLAN.md → boulder.json cleared
4. Delete PLAN.md while boulder active → warning shown

**Ralph Loop Stop Hook**:
1. Start ralph loop without promise → stop blocked
2. Output promise → stop allowed
3. Promise in code block → not detected (correctly)
4. Multiple nested loops → most recent checked

**Rules Injector**:
1. Create `.claude/rules/python.md` with `applies_to: ["**/*.py"]`
2. Read Python file → rule injected
3. Read same file again → not re-injected (cached)
4. New session → rule injected again

**Context Injector**:
1. Project with README.md → injected on session start
2. Project with AGENTS.md → injected on session start
3. Very large README (1000+ lines) → truncated to 500 lines
4. Missing README → no error, silently skipped

### Integration Testing

**Boulder + /dev workflow**:
- [ ] /dev-brainstorm → SPEC.md created, no boulder
- [ ] /dev-design → PLAN.md created, boulder.json created
- [ ] /dev-implement → boulder state remains active
- [ ] /dev-review completes → boulder.json cleared

**Ralph Loop + /dev-implement**:
- [ ] /dev-implement starts ralph loops per task
- [ ] Stop hook enforces completion promise
- [ ] Task completes → promise output → next task starts

**Rules + Boulder**:
- [ ] Boulder references PLAN.md
- [ ] Rules injector sees PLAN.md edits
- [ ] Both hooks work together without conflicts

## Migration & Compatibility

### Backwards Compatibility
- [ ] Existing projects without boulder.json: Work normally, auto-create on next /dev-design
- [ ] Existing PLAN.md files: Compatible, boulder just adds state tracking
- [ ] Existing ralph-loop skill: Works same, just adds enforcement

### User Communication
- [ ] When boulder.json created: Log message "Boulder state tracking enabled for this plan"
- [ ] When boulder continuation detected: Clear message showing progress
- [ ] When rules injected: Include source file in message
- [ ] When context injected: List which files were discovered

## Out of Scope

- ❌ Background task manager (wait for user need)
- ❌ Multiple active boulders (global = one active plan only)
- ❌ Boulder history/archive (future enhancement)
- ❌ Ralph loop state files (use transcript parsing instead)
- ❌ LSP tools integration (different feature)
- ❌ Recursive directory README discovery (just project root + current dir)

## Open Questions

None - all clarified via user answers.

## Dependencies

**Python packages** (already available):
- `json`, `pathlib`, `glob`, `fnmatch` (stdlib)
- `yaml` (for frontmatter parsing - need to add to dependencies)

**New dependencies to add**:
- `pyyaml` or `python-frontmatter` package

**Reuse from existing hooks**:
- `common/hooks/scripts/markdown_validators.py` for markdown parsing
- Session ID extraction from hook input
- File path utilities

## Success Metrics

After implementation:
- [ ] User can work on multi-day projects with automatic continuation
- [ ] Ralph loops cannot be exited without completion promise
- [ ] Users can add `.claude/rules/*.md` without editing plugin
- [ ] Project README is automatically available in context
- [ ] All hooks run in < 1 second combined
- [ ] Zero blocking errors (all failures gracefully handled)
