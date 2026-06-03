---
name: workshop-revise
description: "This skill should be used when the user asks to 'revise workshop slides', 'fix presentation', 'update slides', 'change slide', 'fix notes', 'workshop feedback', or needs to modify existing workshop presentation slides or speaker notes."
hooks:
  PreToolUse:
    - matcher: "Read"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/image-read-guard.py"
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: >-
            GATE_ARTIFACT=.planning/SOURCES_VERIFIED.md
            GATE_STATUS=VERIFIED
            GATE_DESCRIPTION="Phase 1 sources gate"
            GATE_REMEDY="Return to Phase 1 (workshop skill) and complete source gathering before editing any files"
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/workshop-phase-gate-guard.py"
  PostToolUse:
    - matcher: "Edit"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/typst-convention-guard.py"
    - matcher: "Write"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/typst-convention-guard.py"
    - matcher: "Bash"
      hooks:
        - type: command
          command: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/overflow-check.py"
    - matcher: "*"
      hooks:
        - type: command
          command: >-
            COMPACT_THRESHOLD=40
            COMPACT_INTERVAL=20
            uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/suggest-compact.py
---

**Announce:** "I'm using workshop-revise to apply changes to the workshop presentation."

## Shared Typst Constraints

Load ALL Typst conventions before touching any files:

!`uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workshop-revise`

**You MUST have these constraints loaded before any edits. No claiming you "remember" them.**

## Midpoint Entry — Self-Contained Constraint Loading

This skill may run in a new session. Load ALL needed context before touching any files.

### Session Resume Detection

Check if `.planning/HANDOFF.md` exists:
1. **If found:** Read it, show status, ask: "Resume from the recorded revision state, or start fresh?"
2. **If not found:** Proceed to Step 1.

### Iteration topology & flow

```
[Step 1: Load Context] → [Step 2: Diagnose]
        → [Step 3: Apply edits  (+ workshop-verify /goal loop, max 3 turns, for content/structure)]
        → [Step 4: Verify (compile + widow + check-all.py)]
              ├─ pass → report to user
              └─ unresolved after 3 cycles → ESCALATE to user
```

| Step | Topology | Exit condition |
|------|----------|----------------|
| Step 3 (content/structure change) | `serial` edit → `parallel` review (workshop-verify under `/goal`, **max 3 turns**) | `overallPass=true` → Step 4; else escalate |
| Step 3 (formatting-only fast path) | `one-shot` edit | edit applied → Step 4 |
| Step 4 (verify) | `serial` (compile → widow → check-all.py) | all pass; else fix (max 3 cycles) then escalate |

**The flow diagram above IS the authoritative spec for step order and gating. If prose below conflicts with it, the diagram wins.**

**After completing each step, IMMEDIATELY proceed to the next step.** Do NOT ask "should I continue?" between steps 1–4. Pausing between steps is procrastination: you lose context, the user loses momentum, and the verification gate gets skipped. Pause only at the explicit checkpoints below.

### Checkpoint types

| Point | Type | Behavior |
|-------|------|----------|
| R4 structural change detected | decision | STOP — present to user, get approval before re-entering Phase 3 |
| Step 3 artifact-review gate (content/structure) | human-verify | Auto-advanceable (independent workshop-verify reviewer) |
| Step 4 revision verified | human-verify | Auto-advanceable; report to user at end |

### Context Monitoring

A revision can itself be multi-turn and context-intensive (especially a content/structure change driving a `/goal` loop). Before starting Step 3 edits or any `/goal` loop, check context availability:

| Level | Remaining Context | Action |
|-------|------------------|--------|
| Normal | >35% | Proceed normally |
| Warning | 25–35% | Complete the current edit, then write `.planning/HANDOFF.md` and pause |
| Critical | ≤25% | Write `.planning/HANDOFF.md` immediately — do not start a new edit or `/goal` loop |

`HANDOFF.md` template (same schema as the workshop entry skill):
```yaml
---
workflow: workshop-revise
status: context_exhaustion
last_updated: [timestamp]
---
## Current State
[Which step; what edit is in progress]
## Completed Work
- [Edits applied so far, files touched]
## Remaining Work
- [Edits left + verification not yet run]
## Decisions Made
[User decisions captured during this revision]
## Rejected Approaches
[Edits tried and reverted, with reasons — so the resume does not retry them]
## Blockers
[Any unresolved blocker the next session must address, or "none"]
## Next Action
[Specific enough to resume immediately]
```

**Pushing through context exhaustion to "finish the revision" ships degraded edits the presenter debugs at the podium. Writing the handoff is the helpful move, not the slow one.**

### Step 1: Load Context

1. **Read `.planning/SOURCES.md`** — paper metadata (title, authors, affiliations)
2. **Read `.planning/OUTLINE.md`** — section structure and timing
3. **Constraints are already loaded** — the bang-invoked auto-loader at the top of this skill fires at skill-load time (no separate load needed). If you are resuming in a fresh session and skipped that, re-run it: `uv run python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workshop-revise`
4. **Read existing `slides.typ`** — current slide content
5. **Read existing `notes.typ`** — current speaker notes

### Delete & Restart Rule

**If you edited slides.typ or notes.typ WITHOUT first completing Step 1 (loading SOURCES.md, OUTLINE.md, and constraints), DELETE your edits and restart from Step 1.** Edits made without context produce inconsistencies that are harder to fix than to redo.

### Step 2: Diagnose

Determine what needs to change based on user's request:

```
User request
    ↓
├─ Content change ("add a slide about X", "remove section Y")
│  → Modify slides.typ AND notes.typ → Step 3 → Step 4
│
├─ Style/formatting fix ("fix bullet spacing", "text too small")
│  → Modify affected file only → Step 4
│
├─ Structure change ("move section 2 before section 1", "split into more parts")
│  → Update OUTLINE.md → Regenerate affected sections → Step 3 → Step 4
│  → For full regeneration: Read `${CLAUDE_SKILL_DIR}/../workshop/SKILL.md` Phase 3
│
└─ Metadata fix ("wrong affiliation", "update venue name")
    → Update SOURCES.md → Fix in both files → Step 4
```

### Step 3: Apply Changes

<EXTREMELY-IMPORTANT>
## Typst Conventions — Enforced on ALL Edits

These apply to EVERY edit, no matter how small:

1. **Blank lines between ALL bullet items** (top-level AND sub-bullets) — no exceptions
2. **Sub-bullets:** two-space indent + `- ` (NEVER `--` as marker)
3. **Heading hierarchy:** `=` section / `==` subsection / `===` slide title
4. **No cetz-plot** — use `#table()` with `inset: 10pt` minimum
5. **`qr: none` must remain in config-info**
6. **Slide titles must be complete sentences**
7. **No subtitle-body echo** — `===` title must not repeat as first body line
8. **Notes must be flowing prose, not bullet recaps**
9. **Images wrapped in `#align(center)`**
10. **Smart apostrophes:** use `\u{2019}s` after `)` or `]`
11. **No hardcoded calculations** — use Typst `calc` module
12. **`#callout[]` + 3+ `#pause`** on same slide = overflow risk → split
13. **CeTZ canvas:** minimum `length: 2em`, requires `// Storytelling:` comment
14. **Dollar signs escaped:** `\$` not `$`
15. **Case names italic:** `_Case v. Party_`; em-dash `---`; en-dash for ranges `--`

**Shipping a "quick fix" with broken formatting means the presenter discovers it at the podium. That's not a fix — it's a trap you set for them.**
</EXTREMELY-IMPORTANT>

### Rationalization Table — Revision Edits

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "It's just one slide, conventions don't matter" | One slide with wrong spacing is visible to the entire audience | Follow conventions on every edit |
| "I'll fix the spacing later" | Later never comes; conventions rot incrementally | Fix it now |
| "The user only asked about content, not formatting" | Shipping broken formatting is anti-helpful to the presenter | Fix content AND maintain formatting |
| "Notes don't need updating for this slide change" | Out-of-sync notes cause confusion at the podium | Update notes to match slide changes |
| "Sub-bullet spacing is cosmetic" | Tight sub-bullets are unreadable when projected | Add blank lines between sub-bullets |
| "Table inset 5pt saves space" | 5pt is illegible at 16:9 projection | Use 10pt minimum |
| "Only text changed — skip widow detection" | Widow positions shift with any content reflow | Re-run widow detection after every compile |
| "It's formatting-only — skip the workshop-verify loop" | Formatting edits cascade into spacing/overflow violations only the checker catches | Run the gate; the JS verdict decides |
| "User only asked about slides — notes can stay" | Out-of-sync notes confuse the presenter at the podium | Update notes to match the slide change |

### Deviation Rules (revision edits)

Unplanned issues surface mid-revision. Apply the same 4-rule system as the workshop generate phase, adapted to revision:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **R1: Bug** | Typst compile error, syntax error, broken import introduced by the edit | Fix → recompile → verify → track `[R1]` | Auto |
| **R2: Missing Critical** | Edit leaves notes out of sync, drops a `qr: none`, removes a required `#align(center)`, breaks bullet spacing | Add/restore → recompile → verify → track `[R2]` | Auto |
| **R3: Blocking** | Missing asset/template the edit depends on, font/package conflict surfaced by recompile | Fix blocker → verify proceeds → track `[R3]` | Auto |
| **R4: Structural** | The request implies reordering sections, changing proportions, or regenerating a whole part | STOP → present to user → on approval, re-enter workshop Phase 3 (which re-runs `workshop-verify`) → track `[R4]` | Ask user |

**Priority:** R4 (STOP) > R1-R3 (auto) > unsure = R4. After applying changes, report: **Total deviations:** N auto-fixed (R1: X, R2: Y, R3: Z).

### Artifact Review Gate (for content/structure changes — ultracode workflow)

For content or structural changes (NOT simple formatting fixes), the edited deck is reviewed by the **`workshop-verify` ultracode workflow** — the same per-slide fan-out + JS gate the workshop skill uses — scoped to the slides you touched:

1. **Compile** so `slides.pdf` reflects the edits: `cd [presentation directory] && typst compile slides.typ && typst compile notes.typ`
2. **Invoke selectively** (review only the changed slides; carry the rest forward):
   ```
   Workflow(name="workshop-verify", args={
     "projectDir": "[absolute project root]",
     "pluginRoot": "${CLAUDE_SKILL_DIR}/../..",
     "onlyChecks": [<IDs of the slides you edited, e.g. "S4", "S5">]
   })
   ```
   (Omit `onlyChecks` to review the whole deck after a large change.)
3. **Read the gate.** If `overallPass` is false → `/goal workshop-verify returns overallPass=true. Stop after 3 turns.`; each turn fix the reported `findings` (main chat owns fixing — the workflow is read-only), recompile, re-invoke selectively, end the turn. If true → proceed to Step 4.

**The workflow's reviewers are read-only by construction; the JS gate (`overallPass`) is authoritative.** Do not hand-wave the gate to true — fix a finding and let the next run recompute.

### Post-Subagent Enforcement

After `workshop-verify` returns, main chat stays on the verification side of this boundary:

| Verification (main chat CAN do) | Investigation (main chat CANNOT do) |
|----------------------------------|--------------------------------------|
| Read the workflow's `findings` / `scoreTable` | Re-read slides.typ/notes.typ to "double-check" the gate |
| Re-invoke the workflow (selectively, `onlyChecks`) | Override the JS gate ("the workflow was too strict") |
| Dispatch a fix subagent for reported `findings` | "Quick fix" an issue the workflow did not report |
| Proceed to Step 4 once `overallPass=true` | Declare the revision clean without a passing gate |

**The JS gate (`overallPass`) is authoritative.** If you disagree with a result, fix a finding and let the next run recompute — never hand-wave the gate to true.

#### Topic-Change Protocol (mid-`/goal` loop)

If the user interjects with an off-topic request while the `/goal workshop-verify` loop is active:

1. **Announce the pause:** "Pausing the workshop-verify loop (turn N) to handle your request."
2. **Handle** the request.
3. **Announce the resume:** "Resuming the workshop-verify loop from turn N" and re-fire the `/goal`.

Never silently abandon the loop. An off-topic message is not permission to stop verifying.

### Step 4: Verify

1. **Compile both files:**
   ```bash
   cd [presentation directory] && typst compile slides.typ && typst compile notes.typ
   ```

2. **Run PDF widow detection** (mandatory after every compile):
   ```bash
   DETECT_WIDOWS=$(command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1) && uv run python3 "$DETECT_WIDOWS" "[presentation directory]/slides.pdf"
   ```
   - Exit code 1 = widows found → fix → recompile → re-run
   - Exit code 0 = clean → proceed

3. **Two-leg verification:**

   **Leg 1 — Constraint checks (hard block):**
   ```bash
   cd [presentation directory] && uv run python3 ${CLAUDE_SKILL_DIR}/../../references/constraints/check-all.py .
   ```
   - If any constraint fails → fix the violation → re-run (max 3 attempts)
   - Hard block: ALL constraints must pass

   **Leg 2 — Convention review (judgment):** For conventions listed by check-all.py (`.md` without `.py`), manually verify against the changed sections.

4. **If compilation fails:** Fix and recompile (max 3 attempts).

5. **If convention violations persist after 3 fix-and-recheck cycles:** Escalate to user.

### Gate: Revision Verified

- [ ] slides.typ compiles without errors
- [ ] notes.typ compiles without errors
- [ ] PDF widow detection passes (0 widows)
- [ ] Overflow detection passes (no slides spill to next page)
- [ ] All diagrams pass visual-verify (score >= 9.5) — if diagrams were created/modified
- [ ] Source fidelity verified (claims traceable to paper) — if content was added/changed
- [ ] `qr: none` present in config-info
- [ ] No cetz-plot imports
- [ ] No bullet spacing violations (top-level or sub-bullet)
- [ ] No fake sub-bullets (`--` as marker)
- [ ] No subtitle-body echoes
- [ ] No smart apostrophe issues (`)'s` / `]'s`)
- [ ] Tables have `inset: 10pt` minimum
- [ ] Images centered with `#align(center)`
- [ ] No hardcoded calculations (use `calc` module)
- [ ] CeTZ canvas has `length: 2em` minimum + `// Storytelling:` comment (if used)
- [ ] Dollar signs escaped (`\$`)
- [ ] Notes are teleprompter-style prose (1-2 sentences per bullet, no fragments)
- [ ] Notes sections match slide sections
- [ ] Section transitions present (verbal bridges between topics)
- [ ] Label-bullet spacing correct (blank line after `*Label:*` before bullets)
- [ ] Verbatim quotes preserved from source (no paraphrasing)

**Report changes to user:**
```
Changes applied:
- [what was changed]
- slides.typ: [compiles ✓/✗]
- notes.typ: [compiles ✓/✗]
- Widow detection: [0 widows / N widows fixed]
- Overflow detection: [clean / N slides fixed]
- Visual-verify: [N diagrams verified / N/A]
- Source fidelity: [verified / N claims flagged]
```

### Record the revision (state + review pattern)

The midpoint leaves a durable record so a later session can see what changed and so recurring preferences accumulate:

1. **Append a revision record to `.planning/LEARNINGS.md`** (create it if absent):
   ```markdown
   ## Revision — [date]
   - Request: [what the user asked to change]
   - Files touched: [slides.typ / notes.typ / SOURCES.md / OUTLINE.md]
   - Deviations: [R1: X, R2: Y, R3: Z]
   - Gate: [overallPass / formatting-only fast path]
   - Reviewed by: [how the user inspected the result — observe, don't infer]
   ```
2. **Observe → record → offer:** if the **same** kind of revision request recurs 3+ times across sessions (e.g. "shrink the results table" every time), offer to encode it as a default — but only after the pattern proves itself. Do NOT pre-build automation for a one-off.

### Red Flags — STOP If You Catch Yourself:

- **Editing files without completing Step 1** → STOP. Load context first. If you already edited, DELETE edits and restart.
- **Editing slides.typ without checking notes.typ for corresponding changes** → STOP. Keep them in sync.
- **Skipping compilation after edits** → STOP. Always verify.
- **Skipping widow detection after compile** → STOP. PDF is ground truth.
- **Removing `qr: none` or changing the theme import** → STOP. Those are load-bearing.
- **Adding cetz-plot for "better visualization"** → STOP. Use tables.
- **Writing sub-bullets with `--` marker** → STOP. Use two-space indent + `- `.
- **Writing consecutive bullets without blank lines** → STOP. Add blank lines.
- **Typing `)'s` or `]'s`** → STOP. Use `\u{2019}s`.
- **Writing `cetz.canvas(length: 1cm, ...)` or smaller** → STOP. Use `2em` minimum.
- **Writing `cetz.canvas` without `// Storytelling:` comment** → STOP. Add it.
- **Writing `$100` without escaping** → STOP. Use `\$100`.
- **Adding `#callout[]` to a slide with 3+ `#pause`** → STOP. Split the slide.

## Skill Dependencies

For structural changes requiring full regeneration, read and re-enter the workshop skill:
Read `${CLAUDE_SKILL_DIR}/../workshop/SKILL.md` Phase 3 for regeneration.
