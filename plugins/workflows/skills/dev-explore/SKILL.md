---
name: dev-explore
description: This skill should be used when the user asks to "explore the codebase", "understand the architecture", "find similar features", or as Phase 2 of the /dev workflow. Launches explore agents to map codebase and returns key files list.
---

## Contents

- [The Iron Law of Exploration](#the-iron-law-of-exploration)
- [What Explore Does](#what-explore-does)
- [Process](#process)
- [Test Infrastructure Discovery](#test-infrastructure-discovery)
- [Key Files List Format](#key-files-list-format)
- [Red Flags](#red-flags---stop-if-youre-about-to)
- [Output](#output)

# Codebase Exploration

Map relevant code, trace execution paths, and return prioritized files for reading.
**Prerequisite:** `.claude/SPEC.md` must exist with draft requirements.

<EXTREMELY-IMPORTANT>
## The Iron Law of Exploration

**RETURN KEY FILES LIST. This is not negotiable.**

Every exploration MUST return:
1. Summary of findings
2. **5-10 key files** with line numbers and purpose
3. Patterns discovered

After agents return, **main chat MUST read all key files** before proceeding.

**If you catch yourself about to move on without reading the key files, STOP.**
</EXTREMELY-IMPORTANT>

## What Explore Does

| DO | DON'T |
|----|-------|
| Trace execution paths | Ask user questions (that's clarify) |
| Map architecture layers | Design approaches (that's design) |
| Find similar features | Write implementation tasks |
| Identify patterns and conventions | Make architecture decisions |
| Return key files list | Skip reading key files |

**Explore answers: WHERE is the code and HOW does it work**
**Design answers: WHAT approach to take** (separate skill)

## Process

### 1. Launch 2-3 Explore Agents in Parallel

Based on `.claude/SPEC.md`, spawn agents with different focuses:

```
# Launch in parallel (single message, multiple Task calls)

Task(subagent_type="Explore", prompt="""
Explore the codebase for [FEATURE AREA].

Focus: Find similar features to [SPEC REQUIREMENT]
- Trace execution paths from entry point to data storage
- Identify patterns used
- Return 5-10 key files with line numbers

Context from SPEC.md:
[paste relevant requirements]
""")

Task(subagent_type="Explore", prompt="""
Explore the codebase for [FEATURE AREA].

Focus: Map architecture and abstractions for [AREA]
- Identify abstraction layers
- Find cross-cutting concerns
- Return 5-10 key files with line numbers

Context from SPEC.md:
[paste relevant requirements]
""")
```

### 2. Consolidate Key Files

After all agents return, consolidate their key files lists:
- Remove duplicates
- Prioritize by relevance to requirements
- Create master list of 10-15 files

### 3. Read All Key Files

**CRITICAL: Main chat must read every file on the key files list.**

```
Read(file_path="src/auth/login.ts")
Read(file_path="src/services/session.ts")
...
```

This builds deep understanding before asking clarifying questions.

### 4. Document Findings

Write exploration summary (can be verbal or in `.claude/EXPLORATION.md`):
- Patterns discovered
- Architecture insights
- Dependencies identified
- Questions raised for clarify phase

## Code Search Tools

**Prefer semantic search over text search when exploring code.**

### ast-grep (sg) - Semantic Code Search

Use `sg` for precise code pattern matching using AST:

```bash
# Find function calls
sg -p 'foo($$$)' --lang python

# Find function definitions
sg -p 'def $FUNC($$$):' --lang python

# Find class definitions
sg -p 'class $NAME { $$$ }' --lang typescript

# Find struct usage (Go/Rust/C)
sg -p 'zathura_page_t' --lang c

# Find method calls on specific types
sg -p '$OBJ.render($$$)' --lang python
```

**When to use ast-grep vs grep:**

| Use ast-grep | Use grep |
|--------------|----------|
| Find function calls/definitions | Find text in comments/strings |
| Find class/struct usage | Find config values |
| Trace method invocations | Search non-code files |
| Refactor patterns | Quick keyword search |

### ripgrep-all (rga) - Search Everything

Use `rga` when you need to search inside:
- PDFs, Word docs, Excel, PowerPoint
- Zip/tar archives
- SQLite databases
- Images (OCR)

```bash
# Search inside PDFs
rga "pattern" docs/

# Search with context
rga -C 3 "error handling" .

# Limit to specific types
rga --type pdf "methodology" papers/
```

## Test Infrastructure Discovery

**CRITICAL: Always discover testing infrastructure during exploration.**

### Project Test Framework

```bash
# Find test directory and framework
ls -d tests/ test/ spec/ __tests__/ 2>/dev/null
cat meson.build 2>/dev/null | grep -i test
cat package.json 2>/dev/null | grep -E "(test|jest|mocha|vitest)"
cat pyproject.toml 2>/dev/null | grep -i pytest
cat Cargo.toml 2>/dev/null | grep -i "\[dev-dependencies\]"

# Find existing tests
find . -name "*test*" -type f | head -20
```

### Available Testing Tools

| Platform | Check | Tool |
|----------|-------|------|
| Unit tests | Build system | meson test, pytest, jest, cargo test |
| Web | MCP | Playwright (browser_snapshot, browser_click) |
| Desktop | System | ydotool, grim, dbus-send |
| Accessibility | System | pyatspi, accerciser |

```bash
# Desktop automation (Wayland)
which ydotool grim dbus-send 2>/dev/null

# Check for D-Bus interfaces (desktop apps)
dbus-send --session --print-reply --dest=org.freedesktop.DBus \
  /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -i appname
```

### Document in Exploration Output

Include in your findings:
- **Test framework:** meson test / pytest / jest / etc.
- **Test directory:** tests/ or test/ or __tests__/
- **Existing test patterns:** How tests are structured
- **Available automation:** Playwright MCP, ydotool, D-Bus interfaces
- **Visual testing:** Screenshots, accessibility tree

## Key Files List Format

Each agent MUST return files in this format:

```markdown
## Key Files to Read

| Priority | File:Line | Purpose |
|----------|-----------|---------|
| 1 | `src/auth/login.ts:45` | Entry point for auth flow |
| 2 | `src/services/session.ts:12` | Session management |
| 3 | `src/middleware/auth.ts:78` | Auth middleware |
| 4 | `src/types/user.ts:1` | User type definitions |
| 5 | `tests/auth/login.test.ts:1` | Existing test patterns |
```

## Red Flags - STOP If You're About To:

| Action | Why It's Wrong | Do Instead |
|--------|----------------|------------|
| Skip reading key files | You'll miss crucial context | Read every file on the list |
| Ask design questions | Exploration is about understanding | Save for clarify/design phases |
| Propose approaches | Too early for decisions | Just document what exists |
| Start implementing | Must understand first | Complete exploration fully |

## Output

Exploration complete when:
- 2-3 explore agents returned findings
- Key files list consolidated (10-15 files)
- **All key files read by main chat**
- Patterns and architecture documented
- **Test infrastructure documented**
- Questions for clarification identified

### Required Output Sections

1. **Key Files** - 10-15 files with line numbers
2. **Architecture** - Layers, patterns, conventions
3. **Test Infrastructure** - Framework, tools, patterns
4. **Questions** - For clarify phase

**Next step:** `/dev-clarify` for questions based on exploration findings
