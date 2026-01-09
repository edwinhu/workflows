# PLAN: Boulder State + Enhanced Hooks Implementation

**Date**: 2026-01-09
**Based on**: `.claude/SPEC.md`

## Implementation Strategy

**Approach**: Incremental implementation in 4 phases, each independently testable.

**Rationale**:
- Each phase builds on previous work
- Can test and validate before moving to next phase
- Minimizes risk of breaking existing functionality
- User can use partial features while development continues

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Session                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────────┐
         │        Hook System (hooks.json)        │
         └────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
  ┌──────────┐         ┌──────────┐        ┌──────────┐
  │SessionStart│        │PostToolUse│       │   Stop   │
  └──────────┘         └──────────┘        └──────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌───────────────┐   ┌──────────────┐    ┌──────────────┐
│ session-start.py│  │rules-injector.py│   │enforce-loop.py│
│ inject-context.py│  │                │    │              │
└───────────────┘   └──────────────┘    └──────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌────────┐          ┌────────┐          ┌────────┐
    │Boulder │          │ Rules  │          │ Ralph  │
    │ State  │          │Matching│          │ Loop   │
    └────────┘          └────────┘          └────────┘
         │                    │                    │
         ▼                    ▼                    ▼
~/.claude/.boulder.json  .claude/rules/*.md   Transcript
```

## Phase 1: Boulder State (Core)

**Duration**: 1-2 hours
**Risk**: Low
**Dependencies**: None

### Files to Create

#### 1.1 `common/hooks/scripts/boulder.py`

**Purpose**: Core boulder state management utilities

**Functions**:
```python
def get_boulder_path(project_root: Path) -> Path:
    """Return $PROJECT/.claude/.boulder.json path"""

def read_boulder_state(project_root: Path) -> dict | None:
    """Read project's boulder.json, return None if missing/invalid"""

def write_boulder_state(project_root: Path, state: dict) -> bool:
    """Write project's boulder.json atomically"""

def create_boulder_state(
    plan_path: str,
    project_root: str,
    plan_name: str
) -> dict:
    """Create new boulder state dictionary"""

def append_session_id(project_root: Path, session_id: str) -> bool:
    """Add session ID to project's boulder.session_ids"""

def count_plan_checkboxes(plan_path: str) -> tuple[int, int]:
    """Return (total, completed) checkbox counts"""

def update_boulder_progress(project_root: Path, plan_path: str) -> bool:
    """Recount checkboxes, update project's boulder progress"""

def clear_boulder_state(project_root: Path) -> bool:
    """Delete project's boulder.json"""

def is_plan_complete(plan_path: str) -> bool:
    """Check if all checkboxes are checked"""
```

**Implementation Notes**:
- Use `pathlib.Path` for all file operations
- Atomic writes: write to temp file, then rename
- Graceful error handling: log but don't crash
- Type hints for all functions
- **Per-project design**: Boulder lives at `$PROJECT/.claude/.boulder.json`, not global
- Each project can have its own active plan without conflicts

#### 1.2 Modify `hooks/scripts/common/session-start.py`

**Current behavior**: Session initialization logging

**Add**: Boulder state detection and continuation message

```python
#!/usr/bin/env python3
"""
SessionStart hook: Session initialization + boulder state detection
"""

import sys
import json
from pathlib import Path

# Add common utilities
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'common' / 'hooks' / 'scripts'))
from boulder import (
    read_boulder_state,
    append_session_id,
    update_boulder_progress,
    is_plan_complete,
    clear_boulder_state
)

def main():
    hook_input = json.load(sys.stdin)
    session_id = hook_input.get('sessionId', 'unknown')

    # Detect project root
    project_root = Path.cwd()
    while project_root != project_root.parent:
        if (project_root / '.git').exists() or (project_root / '.claude').exists():
            break
        project_root = project_root.parent

    # Check for active boulder in this project
    boulder = read_boulder_state(project_root)
    if not boulder:
        sys.exit(0)  # No active plan

    active_plan = boulder.get('active_plan')
    if not active_plan or not Path(active_plan).exists():
        # Plan file deleted
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "message": """
[BOULDER STATE WARNING]

Boulder state references missing plan: {active_plan}

Clear boulder state with: /boulder-clear
"""
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Update session ID
    append_session_id(project_root, session_id)

    # Update progress
    update_boulder_progress(project_root, active_plan)

    # Check if complete
    if is_plan_complete(active_plan):
        clear_boulder_state(project_root)
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "message": f"""
[BOULDER COMPLETE]

Plan '{boulder['plan_name']}' is complete! All tasks checked off.
Boulder state has been cleared.
"""
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Inject continuation message
    progress = boulder.get('progress', {})
    total = progress.get('total', 0)
    completed = progress.get('completed', 0)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "message": f"""
[BOULDER STATE DETECTED]

Active plan: {boulder['plan_name']}
Progress: {completed}/{total} tasks complete
Plan location: {Path(active_plan).relative_to(boulder['project_root'])}

Continuing from where you left off.
"""
        }
    }

    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
```

#### 1.3 Modify `skills/dev-design/SKILL.md`

**Current**: Writes `.claude/PLAN.md`

**Add**: Create boulder state after writing PLAN.md

```markdown
<!-- In dev-design skill, after writing PLAN.md -->

## After Writing PLAN.md

Once PLAN.md is written:

1. **Create boulder state** to track progress across sessions:

```python
from pathlib import Path
import sys
sys.path.insert(0, str(Path.home() / '.claude' / 'plugins' / 'workflows' / 'common' / 'hooks' / 'scripts'))
from boulder import create_boulder_state, write_boulder_state

plan_path = Path.cwd() / '.claude' / 'PLAN.md'
project_root = Path.cwd()
plan_name = "feature-name"  # Extract from user request or SPEC.md

state = create_boulder_state(
    plan_path=str(plan_path.absolute()),
    project_root=str(project_root.absolute()),
    plan_name=plan_name
)

write_boulder_state(project_root, state)
```

This enables automatic continuation on next session.
```

**Alternative (simpler)**: Add boulder creation to session-start hook
- Check if PLAN.md exists without boulder
- Auto-create boulder state
- User doesn't need to think about it

**Recommendation**: Use SessionStart auto-creation (simpler for user)

### Testing Phase 1

**Manual tests**:
```bash
# Test 1: Auto-create boulder
cd /tmp/test-project
mkdir -p .claude
cat > .claude/PLAN.md << 'EOF'
# Test Plan

- [ ] Task 1
- [ ] Task 2
- [x] Task 3
EOF

# Start Claude session → Should create .claude/.boulder.json

# Test 2: Continuation message
# Exit Claude, restart → Should show "1/3 tasks complete"

# Test 3: Completion
# Mark all tasks [x], restart → Boulder cleared

# Test 4: Missing plan
rm .claude/PLAN.md
# Restart → Warning about missing plan
```

## Phase 2: Ralph Loop Stop Hook

**Duration**: 1 hour
**Risk**: Low
**Dependencies**: Phase 1 complete (for transcript utilities)

### Files to Create

#### 2.1 `common/hooks/scripts/transcript.py`

**Purpose**: Transcript parsing utilities

```python
from pathlib import Path
import re

def find_transcript_file(session_id: str) -> Path | None:
    """Find transcript file for session ID"""
    claude_dir = Path.home() / '.claude'
    possible_paths = [
        claude_dir / 'sessions' / session_id / 'transcript.md',
        claude_dir / 'sessions' / session_id / 'messages.json',
        claude_dir / 'transcripts' / f'{session_id}.md'
    ]
    for path in possible_paths:
        if path.exists():
            return path
    return None

def read_transcript(session_id: str) -> str:
    """Read transcript content"""
    path = find_transcript_file(session_id)
    if not path:
        return ""
    try:
        return path.read_text(encoding='utf-8')
    except Exception:
        return ""

def find_last_skill_invocation(
    transcript: str,
    skill_pattern: str
) -> str | None:
    """Find last /skill invocation in transcript"""
    # Match: /skill-name:sub-skill "prompt" --arg value
    pattern = rf'/{skill_pattern}[^\n]*'
    matches = list(re.finditer(pattern, transcript))
    if matches:
        return matches[-1].group(0)
    return None

def extract_arg_value(command: str, arg_name: str) -> str | None:
    """Extract --arg-name value from command string"""
    # Match: --arg-name "value" or --arg-name value
    pattern = rf'--{arg_name}\s+(?:"([^"]*)"|(\S+))'
    match = re.search(pattern, command)
    if match:
        return match.group(1) or match.group(2)
    return None

def search_promise_tag(transcript: str, promise_token: str) -> bool:
    """Search for <promise>TOKEN</promise> in transcript"""
    # Escape special regex chars in token
    escaped = re.escape(promise_token)
    pattern = rf'<promise>\s*{escaped}\s*</promise>'
    return bool(re.search(pattern, transcript, re.IGNORECASE))
```

#### 2.2 `hooks/scripts/ralph-loop/enforce-loop.py`

**Purpose**: Stop hook that enforces ralph-loop completion

```python
#!/usr/bin/env python3
"""
Stop hook: Enforce ralph-loop completion promise
"""

import sys
import json
from pathlib import Path

# Add common utilities
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'common' / 'hooks' / 'scripts'))
from transcript import (
    read_transcript,
    find_last_skill_invocation,
    extract_arg_value,
    search_promise_tag
)

def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    session_id = hook_input.get('sessionId', '')
    if not session_id:
        sys.exit(0)

    # Read transcript
    transcript = read_transcript(session_id)
    if not transcript:
        sys.exit(0)

    # Check if we're in a ralph loop
    ralph_invocation = find_last_skill_invocation(
        transcript,
        r'ralph-wiggum:ralph-loop'
    )

    if not ralph_invocation:
        # Not in ralph loop, allow stop
        sys.exit(0)

    # Extract completion promise
    promise_token = extract_arg_value(ralph_invocation, 'completion-promise')
    if not promise_token:
        # No promise specified, allow stop (malformed invocation)
        sys.exit(0)

    # Search for promise in transcript
    promise_found = search_promise_tag(transcript, promise_token)

    if promise_found:
        # Promise found! Allow stop, inject completion message
        result = {
            "hookSpecificOutput": {
                "hookEventName": "Stop",
                "message": f"""
[RALPH LOOP COMPLETE]

Completion promise detected: <promise>{promise_token}</promise>
Ralph loop has ended.
"""
            }
        }
        print(json.dumps(result))
        sys.exit(0)

    # Promise NOT found - block stop
    result = {
        "continue": False,
        "reason": f"""
[RALPH LOOP ENFORCEMENT]

The completion promise was not output. The loop must continue.

Expected promise: <promise>{promise_token}</promise>

Continue working on the task. Output the promise only when the task is TRULY complete.
"""
    }

    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
```

#### 2.3 Modify `hooks/hooks.json`

**Add**: Stop hook registration

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/ralph-loop/enforce-loop.py"
          },
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/common/cleanup-session.py"
          }
        ]
      }
    ]
  }
}
```

**Note**: Ralph enforcement runs BEFORE cleanup-session

### Testing Phase 2

**Manual tests**:
```bash
# Test 1: Block stop without promise
/ralph-wiggum:ralph-loop "Test task" --max-iterations 5 --completion-promise "TEST_DONE"
# Try to stop without outputting promise → Should be blocked

# Test 2: Allow stop with promise
<promise>TEST_DONE</promise>
# Try to stop → Should be allowed

# Test 3: Promise in code block (should not count)
```python
# This should not trigger completion
print("<promise>TEST_DONE</promise>")
```
# Try to stop → Should be blocked (promise in code block)

# Test 4: Not in ralph loop
# Normal session, try to stop → Should allow (no blocking)
```

## Phase 3: General Rules Injector

**Duration**: 2 hours
**Risk**: Medium (glob matching complexity)
**Dependencies**: Phases 1-2 complete

### Files to Create

#### 3.1 `common/hooks/scripts/rules_parser.py`

**Purpose**: YAML frontmatter parsing

```python
import re
from pathlib import Path

def parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    Parse YAML frontmatter from markdown.

    Returns: (metadata_dict, body_content)
    """
    # Match: ---\n...yaml...\n---\n
    pattern = r'^---\s*\n(.*?)\n---\s*\n(.*)$'
    match = re.match(pattern, content, re.DOTALL)

    if not match:
        return {}, content

    yaml_content = match.group(1)
    body = match.group(2)

    # Simple YAML parser (avoid pyyaml dependency)
    metadata = {}
    for line in yaml_content.split('\n'):
        if ':' not in line:
            continue
        key, value = line.split(':', 1)
        key = key.strip()
        value = value.strip()

        # Handle lists: - item
        if value.startswith('-'):
            if key not in metadata:
                metadata[key] = []
            # Collect all list items
            continue

        # Handle quoted strings
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1]

        # Handle numbers
        elif value.isdigit():
            value = int(value)

        metadata[key] = value

    # Parse lists (applies_to, tags)
    if 'applies_to' in metadata:
        # Re-parse to get list items
        metadata['applies_to'] = []
        in_applies_to = False
        for line in yaml_content.split('\n'):
            if line.strip().startswith('applies_to:'):
                in_applies_to = True
                continue
            if in_applies_to:
                if line.strip().startswith('-'):
                    item = line.strip()[1:].strip()
                    # Remove quotes
                    if item.startswith('"') and item.endswith('"'):
                        item = item[1:-1]
                    metadata['applies_to'].append(item)
                elif line.strip() and not line.startswith(' '):
                    break

    return metadata, body
```

#### 3.2 `common/hooks/scripts/rules_matcher.py`

**Purpose**: Glob pattern matching and file discovery

```python
from pathlib import Path
import fnmatch
import hashlib

def find_rule_files(project_root: Path) -> list[Path]:
    """Find all rule files in priority order"""
    rules = []

    # 1. .github/copilot-instructions.md (always applied)
    github_instructions = project_root / '.github' / 'copilot-instructions.md'
    if github_instructions.exists():
        rules.append(github_instructions)

    # 2. .claude/rules/*.md (project-level)
    claude_rules = project_root / '.claude' / 'rules'
    if claude_rules.exists():
        rules.extend(sorted(claude_rules.glob('*.md')))

    # 3. ~/.claude/rules/*.md (user-level)
    user_rules = Path.home() / '.claude' / 'rules'
    if user_rules.exists():
        rules.extend(sorted(user_rules.glob('*.md')))

    return rules

def matches_glob_pattern(file_path: str, pattern: str) -> bool:
    """Check if file path matches glob pattern"""
    # Use fnmatch for glob matching
    # Convert to relative path for matching
    return fnmatch.fnmatch(file_path, pattern)

def file_content_hash(file_path: Path) -> str:
    """Generate hash of file content for deduplication"""
    try:
        content = file_path.read_bytes()
        return hashlib.sha256(content).hexdigest()[:16]
    except Exception:
        return ""

def should_inject_rule(
    file_path: str,
    metadata: dict,
    injected_hashes: set[str],
    file_hash: str
) -> tuple[bool, str]:
    """
    Check if rule should be injected.

    Returns: (should_inject, reason)
    """
    # Check if already injected this session
    if file_hash in injected_hashes:
        return False, "already_injected"

    # copilot-instructions always applies
    if 'applies_to' not in metadata:
        return True, "always_applies"

    # Check glob patterns
    applies_to = metadata.get('applies_to', [])
    if not isinstance(applies_to, list):
        applies_to = [applies_to]

    for pattern in applies_to:
        if matches_glob_pattern(file_path, pattern):
            return True, f"matches_{pattern}"

    return False, "no_match"
```

#### 3.3 `hooks/scripts/rules/rules-injector.py`

**Purpose**: PostToolUse hook for rule injection

```python
#!/usr/bin/env python3
"""
PostToolUse hook: Inject matching rule files
"""

import sys
import json
from pathlib import Path

# Add common utilities
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / 'common' / 'hooks' / 'scripts'))
from rules_parser import parse_frontmatter
from rules_matcher import (
    find_rule_files,
    file_content_hash,
    should_inject_rule
)

# Session cache directory
CACHE_DIR = Path.home() / '.claude' / '.sisyphus' / 'rules-injector'

def load_session_cache(session_id: str) -> set[str]:
    """Load injected file hashes for this session"""
    cache_file = CACHE_DIR / f'session-{session_id}.json'
    if not cache_file.exists():
        return set()

    try:
        data = json.loads(cache_file.read_text())
        return set(data.get('injected_hashes', []))
    except Exception:
        return set()

def save_session_cache(session_id: str, hashes: set[str]):
    """Save injected file hashes"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f'session-{session_id}.json'

    data = {'injected_hashes': list(hashes)}
    cache_file.write_text(json.dumps(data, indent=2))

def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})
    session_id = hook_input.get('sessionId', 'unknown')

    # Only trigger on Read or Edit
    if tool_name not in ('Read', 'Edit'):
        sys.exit(0)

    file_path = tool_input.get('file_path', '')
    if not file_path:
        sys.exit(0)

    # Get project root (directory of file)
    project_root = Path(file_path).parent
    while project_root != project_root.parent:
        if (project_root / '.git').exists() or (project_root / '.claude').exists():
            break
        project_root = project_root.parent

    # Find rule files
    rule_files = find_rule_files(project_root)
    if not rule_files:
        sys.exit(0)

    # Load session cache
    injected_hashes = load_session_cache(session_id)

    # Check each rule file
    messages = []
    for rule_file in rule_files:
        file_hash = file_content_hash(rule_file)
        content = rule_file.read_text(encoding='utf-8')
        metadata, body = parse_frontmatter(content)

        should_inject, reason = should_inject_rule(
            file_path,
            metadata,
            injected_hashes,
            file_hash
        )

        if should_inject:
            messages.append(f"""
# Rule from {rule_file.name}

{body}
""")
            injected_hashes.add(file_hash)

    if not messages:
        sys.exit(0)

    # Save updated cache
    save_session_cache(session_id, injected_hashes)

    # Inject message
    combined = "\n---\n".join(messages)
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "message": f"""
<system-reminder>
The following rules apply to this file:

{combined}
</system-reminder>
"""
        }
    }

    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()
```

#### 3.4 Modify `hooks/hooks.json`

**Add**: PostToolUse hook for rules

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/rules/rules-injector.py"
          },
          // ... existing hooks
        ]
      }
    ]
  }
}
```

### Testing Phase 3

**Manual tests**:
```bash
# Test 1: Create rule file
mkdir -p .claude/rules
cat > .claude/rules/python.md << 'EOF'
---
applies_to:
  - "**/*.py"
priority: 10
---

# Python Standards

- Always use type hints
- Use dataclasses for data structures
EOF

# Read a Python file → Rule should be injected

# Test 2: Session deduplication
# Read same file again → Rule should NOT be re-injected

# Test 3: New session
# Exit Claude, restart, read file → Rule injected again (new session)

# Test 4: copilot-instructions.md
mkdir -p .github
cat > .github/copilot-instructions.md << 'EOF'
# Project Instructions

Use TypeScript strict mode
EOF

# Read any file → copilot-instructions injected (always applies)
```

## Phase 4: Context Injector

**Duration**: 1 hour
**Risk**: Low
**Dependencies**: Phases 1-3 complete

### Files to Create

#### 4.1 `common/hooks/scripts/context_collector.py`

**Purpose**: README discovery

```python
from pathlib import Path

MAX_README_LINES = 500
MAX_CONTEXT_CHARS = 50_000

def find_readme(project_root: Path) -> Path | None:
    """Find README.md in project root"""
    readme = project_root / 'README.md'
    return readme if readme.exists() else None

def find_agents_md(project_root: Path) -> Path | None:
    """Find AGENTS.md in project root"""
    agents = project_root / 'AGENTS.md'
    return agents if agents.exists() else None

def read_readme_truncated(readme_path: Path, max_lines: int) -> str:
    """Read first N lines of README"""
    try:
        lines = readme_path.read_text(encoding='utf-8').split('\n')
        if len(lines) <= max_lines:
            return '\n'.join(lines)

        truncated = '\n'.join(lines[:max_lines])
        truncated += f"\n\n[Truncated after {max_lines} lines]"
        return truncated
    except Exception:
        return ""

def collect_context_files(project_root: Path) -> list[tuple[str, str]]:
    """
    Collect context files to inject.

    Returns: [(filename, content), ...]
    """
    files = []

    # README.md (truncated)
    readme = find_readme(project_root)
    if readme:
        content = read_readme_truncated(readme, MAX_README_LINES)
        if content:
            files.append(('README.md', content))

    # AGENTS.md (full)
    agents = find_agents_md(project_root)
    if agents:
        try:
            content = agents.read_text(encoding='utf-8')
            files.append(('AGENTS.md', content))
        except Exception:
            pass

    # Limit total size
    total_chars = sum(len(content) for _, content in files)
    if total_chars > MAX_CONTEXT_CHARS:
        # Truncate README further
        if files and files[0][0] == 'README.md':
            readme_content = files[0][1]
            available = MAX_CONTEXT_CHARS - sum(len(c) for n, c in files[1:])
            if available > 0:
                truncated = readme_content[:available]
                truncated += "\n\n[Truncated due to size limit]"
                files[0] = ('README.md', truncated)

    return files
```

#### 4.2 Modify `hooks/scripts/common/session-start.py`

**Add**: Context injection after boulder check

```python
# ... existing boulder code ...

# Inject context (README.md, AGENTS.md)
from context_collector import collect_context_files

# Detect project root
cwd = Path.cwd()
project_root = cwd
while project_root != project_root.parent:
    if (project_root / '.git').exists() or (project_root / '.claude').exists():
        break
    project_root = project_root.parent

context_files = collect_context_files(project_root)

if context_files:
    sections = []
    for filename, content in context_files:
        sections.append(f"# {filename}\n\n{content}")

    combined = "\n\n---\n\n".join(sections)

    result = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "message": f"""
<system-reminder>
The following project documentation is available:

{combined}
</system-reminder>
"""
        }
    }

    print(json.dumps(result))

sys.exit(0)
```

### Testing Phase 4

**Manual tests**:
```bash
# Test 1: README injection
cat > README.md << 'EOF'
# My Project

This is a test project.
EOF

# Start session → README should be injected

# Test 2: AGENTS.md injection
cat > AGENTS.md << 'EOF'
# Agent Knowledge

## oracle
Use for debugging
EOF

# Start session → Both README and AGENTS.md injected

# Test 3: Very large README
# Create README with 1000 lines
# Start session → Should be truncated to 500 lines

# Test 4: Missing files
# No README or AGENTS.md
# Start session → No errors, silently skipped
```

## Integration Testing

**After all phases complete**:

### Test 1: Full /dev workflow with boulder
```bash
# 1. Create project with README
mkdir -p test-project/.claude
cd test-project
cat > README.md << 'EOF'
# Test Project
Uses TypeScript
EOF

# 2. Run /dev-brainstorm → Creates SPEC.md

# 3. Run /dev-design → Creates PLAN.md + boulder.json

# 4. Exit Claude, restart
# → Should show: Boulder continuation + README injected

# 5. Run /dev-implement with ralph loops
# → Should enforce completion promises

# 6. Complete all tasks
# → Boulder should clear automatically
```

### Test 2: Rules + Boulder interaction
```bash
# 1. Create rule file
mkdir -p .claude/rules
cat > .claude/rules/typescript.md << 'EOF'
---
applies_to: ["**/*.ts"]
---
Use strict mode
EOF

# 2. Create PLAN.md with TypeScript tasks
# 3. Edit TypeScript file
# → Rule should be injected
# → Boulder should remain active
```

## File Summary

**New files** (13 total):
```
common/hooks/scripts/
├── boulder.py                    # Phase 1
├── transcript.py                 # Phase 2
├── rules_parser.py              # Phase 3
├── rules_matcher.py             # Phase 3
└── context_collector.py         # Phase 4

hooks/scripts/
├── ralph-loop/
│   └── enforce-loop.py          # Phase 2
└── rules/
    └── rules-injector.py        # Phase 3
```

**Modified files** (3 total):
```
hooks/scripts/common/
└── session-start.py             # Phases 1, 4

hooks/
└── hooks.json                   # Phases 2, 3

skills/dev-design/
└── SKILL.md                     # Phase 1 (optional)
```

**User files** (created by system):
```
~/.claude/
├── .sisyphus/
│   └── rules-injector/
│       └── session-*.json       # Phase 3
└── rules/                       # User creates
    └── *.md

project/.claude/
├── .boulder.json                # Phase 1 (per-project)
└── rules/                       # User creates
    └── *.md
```

## Rollout Plan

1. **Phase 1 (Boulder)**: Implement, test, commit
2. **Phase 2 (Ralph Stop)**: Implement, test, commit
3. **Phase 3 (Rules)**: Implement, test, commit
4. **Phase 4 (Context)**: Implement, test, commit
5. **Integration Testing**: Full workflow validation
6. **Documentation**: Update README, skill docs
7. **Version Bump**: Update to v2.2.0

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Boulder conflicts with multiple projects | Medium | Use session_ids to track, warn on project switch |
| Ralph stop hook breaks normal sessions | High | Test thoroughly, allow stop if not in loop |
| Rules injector performance | Low | Limit to 10 rules max, cache session |
| Context injection too large | Medium | Hard limits: 500 lines README, 50k chars total |
| Hook errors crash Claude | High | All hooks: try/except, log errors, continue |

## Success Criteria

- [ ] Boulder state persists across sessions
- [ ] Boulder shows correct progress on session start
- [ ] Boulder clears when plan complete
- [ ] Ralph loop enforces completion promise
- [ ] Ralph loop allows stop with valid promise
- [ ] Rules injected based on glob patterns
- [ ] Rules deduplicated per session
- [ ] README.md auto-injected on session start
- [ ] AGENTS.md auto-injected if exists
- [ ] All hooks run in < 1 second combined
- [ ] Zero blocking errors in normal usage

## Out of Scope (Future Enhancements)

- Multiple concurrent boulders (global = single active plan)
- Boulder history/archive
- Ralph loop state files (using transcript instead)
- Directory-specific README injection (just project root for now)
- LSP tools integration
- Background task manager
