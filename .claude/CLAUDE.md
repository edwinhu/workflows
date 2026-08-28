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
| Skill content (top-level) | `${CLAUDE_SKILL_DIR}/../..` | `!`cat ${CLAUDE_SKILL_DIR}/../../references/file.md`` |
| Hook command | `${CLAUDE_PLUGIN_ROOT}` | `bun ${CLAUDE_PLUGIN_ROOT}/hooks/lint-check.ts` |
| Internal skill (Read-loaded) | `${CLAUDE_PLUGIN_ROOT}` convention | Claude infers from context |

**`${CLAUDE_PLUGIN_ROOT}` does NOT work in skill content — use `${CLAUDE_SKILL_DIR}` instead.**

**Key insights:**
- If the skill description contains process summary, Claude follows the short description instead of reading the detailed flowchart. Keep descriptions trigger-only.
- Enforcement works best when the consequence targets the drive that motivated the shortcut (e.g., "skipping steps is anti-helpful" not just "don't skip steps").

## State Files

**IRON LAW: NO NEW STATE FILE WITHOUT AUDITING THE EXISTING ONES FIRST — AND THE AUDIT MEANS
`ls .planning/.state/` AND A GREP, NOT YOUR MEMORY OF THIS SECTION.**

State files metastasize because each one is individually justified and nobody ever counts the total.
Every addition arrives as "+1", measured against a baseline the author never checked. Adding one
without the audit is not a small convenience — it is how the next person inherits a directory nobody
can explain, and reasoning about a lifecycle spread over nine files is strictly harder than the
feature was worth.

### The canonical inventory — three files, and each boundary is load-bearing

| file | holds | why it cannot merge |
|---|---|---|
| `.claude-workflows.json` (repo root, **committed**) | the governance opt-in | committed and permanent; everything else is gitignored and ephemeral. Merging means committing episode state |
| `.planning/.state/review.json` | immutable approval identity | one sanctioned conversation-level Write behind nine conditions (`implementer-identity-gate.ts:419-456`), and a parse failure means `blocked`, which costs the user Bash. Mutable state must never share that failure domain |
| `.planning/.state/episode.json` | ALL mutable episode state | — |

Anything session-scoped and high-frequency belongs in `gettempdir()`, not the project. The dispatch
observation records live there, and they stay **one file per record on purpose**: the pre/post hooks
bracket every dispatch, so a single shared JSON would mean read-modify-write races in the one place
that must not lose data. Splitting for concurrency is not sprawl.

### `.planning/*.md` is governed by the same law — and is where the growth actually went

The inventory above disciplined `.state/`, and `.state/` held. The sprawl moved next door, into the
markdown surface nobody counts. A workflow's `.planning/` is **one cursor, one receipt-selected
generated plan, one human review** — `ACTIVE_WORKFLOW.md`, `<generated-slug>.md`, `HUMAN_REVIEW.md`
(plus `AUTOMATED_REVIEW.md` on an audit-only run). Everything else is a phase's scratch that outlived
its phase: fold it into the plan or the review surface, not a new noun.

Dated variants are the worst form. `REVIEW-tasklist-2026-07-29.md` beside `REVIEW.md` is not a second
document, it is a second *reader* — and nothing records which one the gate read.

### Rules

1. **New state goes in `episode.json`.** Not a new file, and *never* a new per-workflow file.
2. **Derive before you record.** If existing state already encodes it, read it. `review.json.status`
   is the sole authority for approval status and `episode.json` never restates it — two files
   disagreeing about whether a plan is approved is a bug generator, and the tiebreak rule is the bug.
3. **A new file requires retiring one**, or a written reason in `docs/DESIGN-*.md` for why the
   boundary is load-bearing rather than convenient.
4. **Do not "consolidate" `review.json`.** The pressure this section creates points the wrong way if
   you follow it blindly. See the table.
5. **The audit covers both halves.** `ls .planning/ .planning/.state/` — every entry counts, `.md`
   included. A rule enforced only over the directory someone thought to look in is a rule that
   relocates the problem rather than solving it.
6. **Retiring a file means sweeping its residue.** Deleting the writer leaves the artifacts behind,
   still readable, indistinguishable from live state to the next reader.

### Facts

- Audited 2026-08-03: a governed project could carry **8 state files across 3 classes**. The
  `<X>_CLARIFIED.json` sentinel family is **six filenames encoding one bit** — DS_, DEV_, WORK_,
  WRITING_, WORKSHOP_, WC_.
- That sentinel was **self-certified**: `skills/ds/SKILL.md:67` has the model `printf` its own
  `{"status":"clarified"}`, and `clarify-before-recon-guard.ts:44` carries a regex permitting exactly
  that Bash write. The proof that CLARIFY happened was the model asserting it happened. A
  `PostToolUse` on `AskUserQuestion` is direct evidence and needs no file at all.
- `.planning/.state/writing.json` was added as per-workflow episode state with **one consumer**
  (`hooks/writing-suggest-verify.ts:59`). One consumer is not a reason for a file.
- A proposal in that same session was reported as "+1 file" **three times** before anyone checked the
  baseline. The count was wrong every time because the sentinel family was never in it.
- Measured 2026-08-13, this repo: `.planning/.state/` holds **1** file and `.planning/` holds **20
  `.md` files** — four of them dated duplicates of a sibling. The discipline worked exactly as far as
  the directory it named.
- `.planning/DEV_CLARIFIED.json` is still on disk in this repo. The sentinel family was retired and
  its writers removed; nobody swept the files, so a retired mechanism still looks live to anyone
  reading the directory.

### Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Add `<workflow>.json` under `.planning/.state/` | That is exactly how `writing.json` happened | One file keyed by workflow, not one file per workflow |
| Add a per-workflow sentinel | Six filenames for one bit | Record it in `episode.json`, or observe the tool call directly |
| Write a state file the model itself populates and the gate then trusts | Self-certification is not evidence | Observe the tool call in a hook |
| Report a state addition as "+1" | The baseline is probably not what you think | Run `ls .planning/.state/` and grep the sentinel family, then state the real total |
| Merge anything into `review.json` | A mutable-state bug would cost the user Bash | Leave the receipt alone |
| Add `SPEC.md`, `LEARNINGS.md`, `WORK.md` or another phase-scratch noun | It outlives its phase and the next reader cannot tell it from live state | A section in the plan or the review surface |
| Save `REVIEW-<topic>-<date>.md` next to `REVIEW.md` | Two readers, no record of which one the gate read | Overwrite the one file; git holds the history |
| Count only `.planning/.state/` when auditing | That is the half that already held | `ls .planning/ .planning/.state/`, count both |

## Worktrees

**Work in a worktree, not the main checkout.** `~/.claude/skills/workflows` is a SYMLINK to this
repo, so every uncommitted edit here is live for every Claude session on the machine — a half-written
script is what the next session executes, and a test suite run from here exercises the tree other
sessions are using. `EnterWorktree` at the start of any session that will edit skills, scripts or
hooks; `/ship` merges it back and sweeps it.

The isolation is partial, and where it stops is load-bearing: paths the harness resolves —
`${CLAUDE_PLUGIN_ROOT}`, a skill `refs` entry, `~/.claude/skills/workflows/...` — still point at the
MAIN checkout. A worktree isolates the files you edit, not the ones a dispatched agent loads, so a
SKILL.md change is not in effect for agents until it lands on main.

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
