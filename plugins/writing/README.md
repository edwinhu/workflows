# Writing Plugin

Writing workflow with Elements of Style and AI anti-pattern detection hooks.

## Skills

| Skill | Description |
|-------|-------------|
| `/writing` | General writing guidance using Strunk & White's Elements of Style |
| `/ai-anti-patterns` | Detect and revise AI writing indicators (12 pattern categories) |

## Hooks

| Event | Matcher | Action |
|-------|---------|--------|
| PostToolUse | Write\|Edit | Scan for AI anti-patterns and emit warnings |

The hook automatically checks all Write/Edit operations on non-code files and warns when AI patterns are detected, triggering immediate revision.

## Directory Structure

```
writing/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── skills/
│   ├── writing/
│   │   ├── SKILL.md          # Core writing skill
│   │   └── references/
│   │       └── elements-of-style.md  # Strunk & White
│   └── ai-anti-patterns/
│       ├── SKILL.md          # AI pattern detection skill
│       └── references/
│           ├── _index.md     # Overview
│           └── 01-11*.md     # Pattern sections
├── hooks/
│   ├── hooks.json            # Hook configuration
│   └── scripts/
│       └── ai-antipattern-check.py  # PostToolUse hook
└── README.md
```

## Usage

### Writing Assistance

Invoke `/writing` when drafting or editing prose:
- Articles, blog posts, general writing
- Grammar, usage, and style guidance
- Clarity, conciseness, active voice

### AI Pattern Detection

Invoke `/ai-anti-patterns` to check for:
- ChatGPT artifacts (turn0search0, oaicite)
- Prompt refusals ("As an AI language model")
- Puffery ("stands as", "plays a vital role")
- Promotional language ("groundbreaking", "cutting-edge")
- Structural patterns ("Despite challenges", rule of three)

The PostToolUse hook automatically checks Write/Edit output and warns on detection.

## Principles

1. **Omit needless words** - Every word must earn its place
2. **Use active voice** - Clearer, more direct
3. **Be concrete** - Specific details over vague abstractions
4. **Check AI patterns** - All AI-assisted writing must be reviewed
5. **Revise immediately** - Hooks trigger revision, not just detection

## Related Skills (via shared plugin)

| Skill | Description |
|-------|-------------|
| `/docx` | Word document creation, editing, tracked changes |
| `/pdf` | PDF extraction, creation, form filling |
| `/pptx` | Presentation creation and editing |
| `/xlsx` | Spreadsheet creation and analysis |

## Phase 2 (Planned)

- `/writing-legal` - Volokh's Academic Legal Writing
- `/writing-econ` - McCloskey's Economical Writing
