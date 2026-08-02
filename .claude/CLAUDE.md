# Claude Plugins Development

## Reference

- **obra/superpowers**: https://github.com/obra/superpowers - Behavioral enforcement patterns, skill-based workflows

## Enforcement Patterns Checklist

**When creating or updating skills, check against these patterns from superpowers:**

| Pattern | Description | Check |
|---------|-------------|-------|
| **Iron Laws** | "NO X WITHOUT Y FIRST" - absolute constraints, not guidelines | ☐ |
| **Fact Rows** | Incident-grounded declarative facts (numbers, thresholds, named incidents, tool quirks) with drive-consequence framing — supersedes excuse/reality Rationalization Tables (v5.36.0; litmus: delete any row a strong model could derive from the rule itself) | ☐ |
| **Red Flags + STOP** | Action-targeted interrupts: "About to X → STOP (consequence)" — never intention-targeted ("if you catch yourself thinking"); mechanically-checkable flags become hooks | ☐ |
| **Gate Functions** | IDENTIFY → RUN → READ → VERIFY → CLAIM (5-step verification) | ☐ |
| **Flowcharts as Spec** | Process diagrams as authoritative definition, not just documentation | ☐ |
| **Staged Review Loops** | Multiple review stages with re-review on issues | ☐ |
| **Delete & Restart** | "Write code before test? Delete it. No exceptions." | ☐ |
| **Skill Dependencies** | Cross-references that enforce workflow order | ☐ |
| **Drive-Aligned Framing** | Frame violation as failure of the drive that motivated it (helpfulness > competence > efficiency > approval > honesty) — embedded in Iron Laws and fact rows, not standalone "Your Drive" tables (deprecated) | ☐ |
| **Trigger-Only Descriptions** | Brief triggers in description, process details in body only | ☐ |
| **No Pause Between Tasks** | After completing task N, immediately start task N+1 | ☐ |

**Full reference:** `references/enforcement-checklist.md`

## Path Variables in Skills

**Skill content** (SKILL.md body): Only `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`, `$ARGUMENTS` are substituted.
**Hook commands**: `${CLAUDE_PLUGIN_ROOT}`, `$CLAUDE_PROJECT_DIR`, `${CLAUDE_PLUGIN_DATA}` are substituted.

| Context | Use | Example |
|---------|-----|---------|
| Skill content (top-level) | `${CLAUDE_SKILL_DIR}/../..` | `!`cat ${CLAUDE_SKILL_DIR}/../../references/X.md`` |
| Hook command | `${CLAUDE_PLUGIN_ROOT}` | `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/lint-check.py` |
| Internal skill (Read-loaded) | `${CLAUDE_PLUGIN_ROOT}` convention | Claude infers from context |

**`${CLAUDE_PLUGIN_ROOT}` does NOT work in skill content — use `${CLAUDE_SKILL_DIR}` instead.**

**Key insights:**
- If the skill description contains process summary, Claude follows the short description instead of reading the detailed flowchart. Keep descriptions trigger-only.
- Enforcement works best when the consequence targets the drive that motivated the shortcut (e.g., "skipping steps is anti-helpful" not just "don't skip steps").

## Required Skills

**Always use these wrapper skills (they invoke the built-ins internally):**

- `/workflows:plugin-creator` - For plugin creation/editing (wraps `plugin-dev:create-plugin`)
- `/workflows:skill-creator` - For skill creation/editing (wraps `skill-creator:skill-creator`)
- `/workflows:workflow-creator` - For workflow creation/editing/auditing
- `/plugin-dev:hook-development` - For creating or working with hooks

## Related Skills

- `plugin-dev:agent-creator` - Create autonomous agents for plugins
- `plugin-dev:plugin-validator` - Validate plugin structure and files
- `plugin-dev:skill-reviewer` - Review skill quality and best practices

## Version Bump Procedure

When bumping the version (format: `x.y.z` where z is patch, y is minor, x is major):

**NEVER hand-edit version fields. Run the script.**

```bash
scripts/bump-version.sh 5.106.0     # rewrite every version site
scripts/bump-version.sh --check     # verify they agree; exit 1 if not
```

The version is spelled in **six places across four files** — `plugin.json`, two fields in
`marketplace.json`, `capabilities.json`, and both `TARGET_VERSION` and the test title in
`tests/public-extension-contract.test.ts`. Four of the six are enforced by that contract
test, so a hand-bump that misses one turns the suite red; the test title is not enforced,
so it goes stale silently and lies. This section previously documented three of the six,
which is how the gap kept being rediscovered one bump at a time. The script is the spec —
if a version site is ever added, add it there and `--check` will keep everyone honest.

**Then ship it — and the tag is what ships:**

```bash
bun test tests/public-extension-contract.test.ts
git commit -am "chore: release vX.Y.Z"
git push origin main
git tag -a workflows--vX.Y.Z -m "workflows vX.Y.Z" && git push origin workflows--vX.Y.Z
```

**`claude plugin update` resolves releases from annotated `workflows--vX.Y.Z` git tags, NOT
from `marketplace.json`.** Push main without the tag and the release reaches nobody — every
installed plugin silently stays on the previous version, with no error to notice. This is
also why landing on `main` is safe and low-stakes while tagging is the deliberate act:
merging and shipping are separate by construction, not just by convention.

**Version increment guidelines:**
- **Patch (z)**: Bug fixes, documentation, minor improvements
- **Minor (y)**: New features, new skills/commands/hooks, backward-compatible changes
- **Major (x)**: Breaking changes, major restructuring
