# Naming Convention Analysis: dev-debug vs dev-edit

## Current State

**The Inconsistency:**
- Command `/dev-edit` → Skill `dev-debug` (MISMATCH)
- Command `/ds-edit` → Skill `ds-edit` (MATCH)

**File Structure:**
```
commands/dev-edit.md  → loads lib/skills/dev-debug/SKILL.md
commands/ds-edit.md   → loads lib/skills/ds-edit/SKILL.md
```

**Reference Count:**
- `dev-debug`: 9 references across 6 files
- `dev-edit`: 4 references across 4 files
- `ds-edit`: 9 references across 4 files

## Semantic Analysis

### What These Skills Actually Do

**dev-debug** (current name):
- Description: "systematic bug investigation and fixing with verification-driven methodology using ralph loops"
- Scope: "debug bugs, fix failing tests, investigate errors, course-correct mid-development"
- Content: 4-phase debug protocol (Investigate → Analyze → Hypothesize → Fix)
- Iron Law: "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST"

**ds-edit** (current name):
- Description: "Midpoint entry for data science workflow. Use when analysis needs course-correction"
- Scope: "wrong results, notebook errors, reviewer feedback, data changes"
- Content: Diagnose → Route to {debug protocol, re-analysis, revision, re-profiling, scope update}
- Iron Law: "DIAGNOSE BEFORE FIXING"

### Key Insight: Both Are "Edit" Skills

**Semantic scope comparison:**
1. Both are **midpoint re-entry** skills (not initial entry)
2. Both handle **multiple issue categories**, not just debugging:
   - dev-debug: bugs, failing tests, errors, **course-correction**
   - ds-edit: notebook errors, wrong results, **reviewer feedback**, data changes, scope changes
3. Both **route to different fix paths** based on diagnosis
4. "Debug" implies bugs only; **"Edit" covers the full scope**

**Evidence from PHILOSOPHY.md:**
```
/dev-edit    → diagnose → route to {debug, re-test, re-design, ...}
/ds-edit     → diagnose → route to {debug notebook, re-analyze, revise, re-profile, ...}
```

The philosophy doc uses "dev-edit" consistently and describes it as routing TO debug, not BEING debug.

## Recommendation: **Option A - Rename dev-debug → dev-edit**

### Rationale

1. **Semantic accuracy**: "Edit" accurately captures the broader scope (bugs + failing tests + reviewer feedback + course correction), while "debug" is too narrow
2. **Consistency**: Aligns with DS naming pattern (both workflows now have matching command/skill names)
3. **Philosophy alignment**: PHILOSOPHY.md already uses "dev-edit" terminology
4. **User clarity**: Command name matches skill name (no cognitive load from mismatch)
5. **Parallelism**: Dev and DS workflows have symmetric naming (both use "edit" for midpoint entry)

### Pros
- Command/skill names align for both workflows
- "Edit" is semantically broader and more accurate than "debug"
- Matches existing PHILOSOPHY.md documentation
- Symmetric with DS workflow (both use "edit")
- More intuitive for users (command name = skill name)

### Cons
- Breaking change for any plugins that reference `dev-debug` skill
- 9 references to update across 6 files
- Need to preserve git history for skill directory rename

### Breaking Changes

**Files requiring updates (6 total):**
1. `/lib/skills/dev-debug/` → rename directory to `/lib/skills/dev-edit/`
2. `/lib/skills/dev-debug/SKILL.md` → update `name: dev-debug` → `name: dev-edit`
3. `/README.md` → update `/dev-debug` reference to `/dev-edit`
4. `/lib/skills/dev-ralph-loop/SKILL.md` → update 2 references
5. `/lib/skills/dev-tdd/SKILL.md` → update 1 reference
6. `/scratch/writing-workflow-sketch.md` → update 1 reference (if still relevant)

**Commands:** No changes needed (`dev-edit.md` is already correct)

**External impact:** Low - most references are internal documentation. Main risk is if other plugins reference the `dev-debug` skill by name.

### Migration Plan

1. **Rename skill directory:**
   ```bash
   cd /Users/vwh7mb/projects/workflows/lib/skills
   git mv dev-debug dev-edit
   ```

2. **Update skill metadata:**
   - Edit `lib/skills/dev-edit/SKILL.md`: change `name: dev-debug` → `name: dev-edit`
   - Update announcement: "I'm using dev-edit for systematic debugging and course-correction"

3. **Update internal references (5 files):**
   - `README.md`: `/dev-debug` → `/dev-edit`
   - `lib/skills/dev-ralph-loop/SKILL.md`: `dev-debug` → `dev-edit` (2 occurrences)
   - `lib/skills/dev-tdd/SKILL.md`: `dev-debug` → `dev-edit`
   - `scratch/writing-workflow-sketch.md`: `dev-debug` → `dev-edit` (if file is still active)

4. **Verify no broken references:**
   ```bash
   rg "dev-debug" /Users/vwh7mb/projects/workflows --type md
   ```

5. **Version bump and commit:**
   - Update 3 version locations in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
   - This is a **minor version bump** (breaking change): x.y.z → x.(y+1).0
   - Commit: `refactor: rename dev-debug → dev-edit for semantic accuracy (vX.Y.Z)`

## Alternatives Considered

### Option B: Rename ds-edit → ds-debug
**Rejected because:**
- "Debug" is semantically too narrow (ds-edit handles reviewer feedback, scope changes, not just bugs)
- Command/skill mismatch persists
- No alignment with PHILOSOPHY.md

### Option C: Keep current naming
**Rejected because:**
- Command/skill mismatch is confusing for users and developers
- No clear rationale for the inconsistency
- PHILOSOPHY.md already uses "dev-edit" terminology

## Conclusion

Rename `dev-debug` → `dev-edit` to achieve:
- Semantic accuracy ("edit" covers full scope)
- Command/skill alignment
- Workflow symmetry (dev and DS both use "edit")
- Philosophy consistency
