# Writing Plugin

Writing workflow with style guides and AI anti-pattern detection hooks.

## Skills

| Skill | Description |
|-------|-------------|
| `/writing` | General writing guidance using Strunk & White's Elements of Style |
| `/writing-econ` | Economics and finance writing using McCloskey's Economical Writing |
| `/writing-legal` | Academic legal writing using Volokh's Academic Legal Writing |
| `/writing-brainstorm` | Discover topics and gather sources from Readwise highlights |
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
│   ├── plugin.json           # Plugin manifest
│   └── .mcp.json             # MCP server config (Readwise)
├── skills/
│   ├── writing/
│   │   ├── SKILL.md          # Core writing skill
│   │   └── references/
│   │       └── elements-of-style.md  # Strunk & White
│   ├── writing-econ/
│   │   ├── SKILL.md          # Economics writing skill
│   │   └── references/
│   │       └── economical-writing-full.md  # McCloskey extended
│   ├── writing-legal/
│   │   ├── SKILL.md          # Legal writing skill
│   │   └── references/
│   │       └── volokh-distilled.md  # Volokh extended
│   ├── writing-brainstorm/
│   │   └── SKILL.md          # Topic discovery and source gathering
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

### General Writing

Invoke `/writing` when drafting or editing prose:
- Articles, blog posts, general writing
- Grammar, usage, and style guidance
- Clarity, conciseness, active voice

### Economics and Finance Writing

Invoke `/writing-econ` for economics and finance:
- Journal articles and working papers
- Finance analysis and market commentary
- Policy briefs and economic reports
- Discipline-specific vocabulary and style

### Academic Legal Writing

Invoke `/writing-legal` for law review articles:
- Law review articles and student notes
- Seminar papers and legal scholarship
- Structure: introduction, background, proof, conclusion
- Evidence handling and citation practices
- Argument construction and rhetoric

### Topic Brainstorming

Invoke `/writing-brainstorm` to discover topics or gather sources:
- **Discovery mode**: Find writing topics from your reading highlights
- **Gathering mode**: Pull references for a known topic
- Leverages Readwise MCP to search your highlights
- Domain-aware: suggests appropriate writing skill (econ/legal/general)

**Requires:** `READWISE_TOKEN` environment variable (get from https://readwise.io/access_token)

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
