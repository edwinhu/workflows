# Dev Plugin

Development workflow plugin for Claude Code with TDD enforcement.

## Overview

This plugin provides a structured development workflow with the following phases:

- **dev**: Main orchestration skill for full feature development
- **dev-brainstorm**: Socratic design exploration before implementation
- **dev-plan**: Codebase exploration and task breakdown
- **dev-implement**: TDD-based implementation with test-first approach
- **dev-debug**: Systematic debugging with root cause investigation
- **dev-review**: Code review combining spec compliance and quality checks
- **dev-verify**: Verification gate ensuring fresh evidence before completion

## Directory Structure

```
dev/
├── .claude-plugin/
│   └── plugin.json       # Plugin manifest
├── skills/
│   ├── dev/              # Main orchestration skill
│   ├── dev-brainstorm/   # Design exploration
│   ├── dev-plan/         # Planning and task breakdown
│   ├── dev-implement/    # TDD implementation
│   ├── dev-debug/        # Systematic debugging
│   ├── dev-review/       # Code review
│   └── dev-verify/       # Verification gate
└── hooks/
    └── scripts/          # Workflow validation hooks
```

## Usage

Invoke skills using slash commands:

- `/dev` - Full development workflow
- `/dev-brainstorm` - Start design exploration
- `/dev-plan` - Create implementation plan
- `/dev-implement` - Implement with TDD
- `/dev-debug` - Debug with systematic approach
- `/dev-review` - Review implementation
- `/dev-verify` - Verify before completion

## Principles

1. Main chat orchestrates, skills execute
2. Verify before claiming completion
3. TDD enforcement: write tests first, then implementation
4. Delegate immediately without prep work
