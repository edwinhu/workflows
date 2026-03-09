# Workflows Plugin Skill Audit Report

**Date:** 2026-03-05
**Scope:** 59 skills (32 user-invocable in `skills/`, 27 internal in `lib/skills/`)
**Plugin version:** 4.3.0

---

## Executive Summary

The plugin has a strong foundation with well-designed enforcement patterns (Iron Laws, Rationalization Tables, Red Flags) across most skills. However, several structural issues need attention:

- **4 CRITICAL skills** exceeding 2x the recommended line limit with no progressive disclosure
- **Massive content duplication** (fake-test tables repeated 5x across dev skills; reviewer prompts inlined instead of referenced)
- **Path inconsistencies** (`skills/` vs `lib/skills/`, `CLAUDE_SKILL_ROOT` vs `CLAUDE_PLUGIN_ROOT`)
- **Stale references and dev artifacts** left in production skills

### Ratings Summary

| Rating | Count | Skills |
|--------|-------|--------|
| CRITICAL | 2 | ds-review (1180 lines), dev-review (1007 lines) |
| NEEDS WORK | 15 | dev, ds-fix, writing, nlm, gemini-batch, visual-verify, dev-tools, ds-tools, continuous-learning, dev-explore, dev-design, dev-implement, dev-test-chrome, dev-test-electron, dev-test-playwright, ds-implement, writing-draft, writing-econ, writing-legal, using-skills |
| GOOD | 42 | All remaining skills |

---

## CRITICAL Issues (Fix Immediately)

### 1. ds-review: 1,180 lines -- needs aggressive decomposition
**File:** `lib/skills/ds-review/SKILL.md`

- Contains TWO complete review systems (parallel 3-reviewer + single-reviewer) with a duplicate Table of Contents at line 853
- Three reviewer prompts inlined (Methodology: 200+ lines, Reproducibility: 200+ lines, Code Quality: 200+ lines)
- No `references/` directory despite being the skill that needs it most
- Independent verification code duplicated between Reviewer 3 and single-reviewer path

**Fix:** Create `references/methodology-reviewer.md`, `references/reproducibility-reviewer.md`, `references/code-quality-reviewer.md`. Remove duplicate Contents section. Target: ~300 lines.

### 2. dev-review: 1,007 lines -- needs aggressive decomposition
**File:** `lib/skills/dev-review/SKILL.md`

- Three reviewer prompt templates (~170 lines each) inlined: Security, Performance, Tests
- Reconciliation protocol duplicates dev-implement's agent team reconciliation
- Single-reviewer and parallel-reviewer are two entirely different workflows in one file

**Fix:** Extract to `references/reviewer-security.md`, `references/reviewer-performance.md`, `references/reviewer-tests.md`. Target: ~350 lines.

### 3. ds-fix: Broken reference and dev artifact
**File:** `skills/ds-fix/SKILL.md` (529 lines)

- **Line 485:** Leftover integration note: "Integration Note: This section should be inserted in ds-fix.SKILL.md after the existing..." -- dev artifact in production
- **Line 99:** Broken reference to `${CLAUDE_PLUGIN_ROOT}/skills/notebook-debug/SKILL.md` -- file doesn't exist at that path
- Competing hypothesis section (lines 155-482, ~330 lines) should be in `references/`

**Fix:** Remove integration note, fix notebook-debug path, extract competing hypothesis section.

---

## HIGH Priority Issues

### 4. Fake-test enforcement duplication (5 skills)
The identical REAL/FAKE test tables appear in: dev-clarify, dev-explore, dev-design, dev-tdd, dev-implement.

**Fix:** Create `lib/references/real-test-enforcement.md` and replace inline copies with one-line pointers.

### 5. dev-implement: 740 lines
**File:** `lib/skills/dev-implement/SKILL.md`

- Agent Team section (lines 490-731) is 240 lines; spawn template alone is 123 lines
- Iron Law of Delegation duplicates dev-delegate content

**Fix:** Extract to `references/agent-team-protocol.md`. Target: ~400 lines.

### 6. dev-design: 540 lines
**File:** `lib/skills/dev-design/SKILL.md`

- PLAN.md template (lines 199-346) is ~150 lines inline
- Rationalization Prevention tables duplicate dev-tdd content

**Fix:** Move template to `references/plan-template.md`, remove duplicated test enforcement.

### 7. ds-implement: 684 lines
**File:** `lib/skills/ds-implement/SKILL.md`

- Agent Team parallel section (lines 330-656) should be a reference file
- WRDS path uses `skills/wrds/` instead of correct path

**Fix:** Extract parallel section, fix WRDS path.

### 8. gemini-batch: `brew install` violates project rules
**File:** `skills/gemini-batch/SKILL.md` (375 lines)

- Line 80: `brew install google-cloud-sdk` contradicts CLAUDE.md "Never use homebrew"
- Duplicate Iron Law and Rationalization Table sections

**Fix:** Replace brew instruction with nix-darwin, consolidate duplicate enforcement.

### 9. dev-tools / ds-tools trigger collision
**Files:** `skills/dev-tools/SKILL.md`, `skills/ds-tools/SKILL.md`

- Both respond to "what plugins are available" and "what MCP servers can I use"
- Claude cannot reliably choose between them

**Fix:** Merge into one `tools` skill with dev/DS sections, or sharply differentiate descriptions.

### 10. writing: Scope confusion and duplication
**File:** `skills/writing/SKILL.md` (441 lines)

- Description says "full writing workflow" but body only handles brainstorming/source-gathering
- "ALL source searches go through librarian" Iron Law appears twice (lines 164-173 and 334-346)
- Line 386: Stale "Haiku sub-agents" reference

**Fix:** Align description with actual scope, deduplicate iron law, fix model reference.

---

## MEDIUM Priority Issues

### 11. Path inconsistencies across skills

| Issue | Affected Skills |
|-------|----------------|
| `skills/` vs `lib/skills/` for visual-verify | dev-implement, dev-ralph-loop |
| `skills/wrds/` missing `lib/` | ds-plan, ds-implement |
| `CLAUDE_SKILL_ROOT` vs `CLAUDE_PLUGIN_ROOT` | writing-legal (lines 46, 56-57) |
| `skills/writing/SKILL.md` -- intentional or stale? | writing-econ (line 17), writing-legal (line 17) |

### 12. Description quality issues

| Skill | Issue |
|-------|-------|
| dev-test-chrome | No trigger phrases, just a terse summary |
| dev-test-playwright | No trigger phrases, just a terse summary |
| continuous-learning | No trigger phrases; possibly unimplemented feature |
| data-context | Only 4 trigger phrases, not "pushy" enough |
| nlm | 255 lines of CLI reference dump in body; no enforcement for destructive ops |

### 13. Skills exceeding 500-line target (but not critical)

| Skill | Lines | Recommended extraction |
|-------|-------|----------------------|
| dev-explore | 488 | Code path examples to references/ |
| dev-test-electron | 747 | VS Code extension section + examples to references/ |
| dev-test-linux | 600 | D-Bus and AT-SPI sections to references/ |
| ds-plan | 536 | ETL strategy template to references/ |
| writing-draft | 413 | Parallel agent team section (~200 lines) to references/ |
| writing-review | 783 | Agent spawn prompt + review template to references/ |
| using-skills | 319 | Look-at enforcement + skill compliance to references/ |

### 14. Stale model references

| Skill | Line | Issue |
|-------|------|-------|
| dev-worktree | 25 | `Co-Authored-By: Claude Sonnet 4.5` hardcoded |
| readwise-chat | desc | `GPT-5.1` may go stale |
| look-at | 113-118 | `gemini-3-flash-preview` model names will change |
| writing | 386 | "Haiku sub-agents" stale terminology |

---

## LOW Priority Issues

### 15. Missing version fields
Most skills lack a `version` field in frontmatter. Where present, formats are inconsistent (`1.0` vs `1.0.0` vs `0.1.0`). Standardize to semver.

### 16. brew install references
- `gemini-batch` line 80: `brew install google-cloud-sdk`
- `dev-test-hammerspoon` line: `brew install --cask hammerspoon`

Both violate the nix-darwin policy.

### 17. Markup issues
- `dev-verify` line 166: Double `</EXTREMELY-IMPORTANT>` closing tag
- `writing-legal`: Numbered list skips from 1 to 3 (missing item 2)

### 18. Unlisted reference files
- `bluebook`: `references/audit-patterns.md` and `references/abbreviations.md` exist but aren't listed
- `lseg-data`: `references/fund-details.md` exists but isn't listed

---

## Recommended Fix Order

1. **ds-review** -- decompose from 1,180 to ~300 lines (CRITICAL)
2. **dev-review** -- decompose from 1,007 to ~350 lines (CRITICAL)
3. **ds-fix** -- remove dev artifact, fix broken reference, extract competing hypothesis (CRITICAL)
4. **Fake-test dedup** -- create shared reference, update 5 skills (HIGH)
5. **dev-implement** -- extract agent team section (HIGH)
6. **gemini-batch** -- fix brew install, consolidate duplicates (HIGH)
7. **dev-tools/ds-tools** -- merge or differentiate (HIGH)
8. **Path inconsistencies** -- audit and fix all `skills/` vs `lib/skills/` references (MEDIUM)
9. **Description improvements** -- dev-test-chrome, dev-test-playwright, continuous-learning, data-context, nlm (MEDIUM)
10. **Remaining length reductions** -- dev-design, ds-implement, writing-review, etc. (MEDIUM)

---

## Bright Spots

These skills exemplify best practices and can serve as templates:

- **marimo** (238 lines) -- Best-structured skill: dual Iron Laws, rationalization table, progressive disclosure with 4 references + 3 examples + 2 scripts
- **wrds** (314 lines) -- Excellent domain enforcement with dual Iron Laws and validation checklists
- **ds-verify** (275 lines) -- Clean, well-scoped with user acceptance interview pattern
- **readwise-prune** (79 lines) -- Lean with effective dry-run-first Iron Law
- **google-scholar** (240 lines) -- Outstanding "No Hallucinated Metadata" enforcement
- **bluebook** (289 lines) -- 3 Iron Laws, Gate Function, Delete-and-Restart all well-applied
- **writing-revise** (250 lines) -- "Critique Over Comfort" Iron Law with 10-entry rationalization table
