# Claude Plugins Development

## Reference

- **obra/superpowers**: https://github.com/obra/superpowers - Behavioral enforcement patterns, skill-based workflows

## Enforcement Patterns Checklist

**When creating or updating skills, check against these patterns from superpowers:**

| Pattern | Description | Check |
|---------|-------------|-------|
| **Iron Laws** | "NO X WITHOUT Y FIRST" - absolute constraints, not guidelines | ☐ |
| **Rationalization Tables** | Excuse → Reality tables that preempt Claude's defensive thinking | ☐ |
| **Red Flags + STOP** | "If you catch yourself thinking X, STOP" - mental pattern interrupts | ☐ |
| **Gate Functions** | IDENTIFY → RUN → READ → VERIFY → CLAIM (5-step verification) | ☐ |
| **Flowcharts as Spec** | Process diagrams as authoritative definition, not just documentation | ☐ |
| **Staged Review Loops** | Multiple review stages with re-review on issues | ☐ |
| **Delete & Restart** | "Write code before test? Delete it. No exceptions." | ☐ |
| **Skill Dependencies** | Cross-references that enforce workflow order | ☐ |
| **Honesty Framing** | "Claiming without verification is LYING" - stronger than "rationalizing" | ☐ |
| **Trigger-Only Descriptions** | Brief triggers in description, process details in body only | ☐ |
| **No Pause Between Tasks** | After completing task N, immediately start task N+1 | ☐ |

**Key insight from superpowers:** If the skill description contains process summary, Claude follows the short description instead of reading the detailed flowchart. Keep descriptions trigger-only.

## Required Skills

**Always use these skills when working on this project:**

- `/plugin-dev:create-plugin` - For plugin creation workflow
- `/plugin-dev:skill-development` - For creating or updating skills
- `/plugin-dev:hook-development` - For creating or working with hooks

## Related Skills

- `plugin-dev:agent-creator` - Create autonomous agents for plugins
- `plugin-dev:plugin-validator` - Validate plugin structure and files
- `plugin-dev:skill-reviewer` - Review skill quality and best practices

## Version Bump Procedure

When bumping the version (format: `x.y.z` where z is patch, y is minor, x is major):

**Required files to update (3 locations):**

1. **`.claude-plugin/plugin.json`** - Main plugin version
   ```json
   {
     "version": "2.1.3"
   }
   ```

2. **`.claude-plugin/marketplace.json`** - Marketplace metadata version
   ```json
   {
     "metadata": {
       "version": "2.1.3"
     }
   }
   ```

3. **`.claude-plugin/marketplace.json`** - Plugin entry version
   ```json
   {
     "plugins": [
       {
         "name": "workflows",
         "version": "2.1.3"
       }
     ]
   }
   ```

**Workflow:**

```bash
# 1. Update all 3 version locations (x.y.z → x.y.z+1)
# 2. Commit with descriptive message including version
git commit -m "feat: description of changes (vX.Y.Z)"
# 3. Push to remote
git push origin main
```

**Version increment guidelines:**
- **Patch (z)**: Bug fixes, documentation, minor improvements
- **Minor (y)**: New features, new skills/commands/hooks, backward-compatible changes
- **Major (x)**: Breaking changes, major restructuring
