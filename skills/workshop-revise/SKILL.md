---
name: workshop-revise
description: "This skill should be used when the user asks to 'revise workshop slides', 'fix presentation', 'update slides', 'change slide', 'fix notes', 'workshop feedback', or needs to modify existing workshop presentation slides or speaker notes."
---

**Announce:** "I'm using workshop-revise to apply changes to the workshop presentation."

## Shared Typst Constraints

Load ALL Typst conventions before touching any files:

!`python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workshop-revise`

**You MUST have these constraints loaded before any edits. No claiming you "remember" them.**

## Midpoint Entry — Self-Contained Constraint Loading

This skill may run in a new session. Load ALL needed context before touching any files.

### Step 1: Load Context

1. **Read `.planning/SOURCES.md`** — paper metadata (title, authors, affiliations)
2. **Read `.planning/OUTLINE.md`** — section structure and timing
3. **Load constraints:** `python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workshop-revise`
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

### Artifact Review Gate (for content/structure changes)

For content changes or structural changes (NOT simple formatting fixes), dispatch an independent reviewer before verification:

```
Agent(prompt="""
You are an independent reviewer. Check edited sections against Typst workshop constraints.

Run: python3 ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.py workshop-revise

Review the changed sections in slides.typ and notes.typ.
Report violations:
| # | Severity | Constraint | Location | Issue |
""", subagent_type="general-purpose")
```

- If reviewer finds CRITICAL/HIGH issues → fix → re-dispatch (max 3 iterations)
- If approved → proceed to Step 4

### Step 4: Verify

1. **Compile both files:**
   ```bash
   cd [presentation directory] && typst compile slides.typ && typst compile notes.typ
   ```

2. **Run PDF widow detection** (mandatory after every compile):
   ```bash
   DETECT_WIDOWS=$(command ls -d ~/.claude/plugins/cache/tinymist-plugin/tinymist/*/skills/typst-widow-orphan/scripts/detect_widows.py 2>/dev/null | sort -V | tail -1) && python3 "$DETECT_WIDOWS" slides.pdf
   ```
   - Exit code 1 = widows found → fix → recompile → re-run
   - Exit code 0 = clean → proceed

3. **Check conventions:**
   ```bash
   # Missing blank lines between bullets
   rg -n '^\s*-.*\n\s*-' slides.typ notes.typ
   # Fake sub-bullets (-- as marker)
   rg -n '^\s+--\s' slides.typ notes.typ
   # qr: none present
   rg 'qr: none' slides.typ
   # No cetz-plot
   rg 'cetz-plot' slides.typ notes.typ
   # Uncentered images
   rg -n '#image\(' slides.typ | rg -v 'align\(center\)'
   # Table inset check
   rg -n 'inset:' slides.typ
   # Smart apostrophe issues
   rg -n "[)\]]'s" slides.typ notes.typ
   # CeTZ canvas without Storytelling comment
   rg -B3 'cetz.canvas' slides.typ | rg -v 'Storytelling'
   # Small cetz canvas length
   rg -n 'length:' slides.typ | rg -v '2em\|2.5em\|3em'
   # Unescaped dollar signs
   rg -n '[^\\]\$[0-9]' slides.typ notes.typ
   ```

4. **If compilation fails:** Fix and recompile (max 3 attempts).

5. **If convention violations persist after 3 fix-and-recheck cycles:** Escalate to user.

### Gate: Revision Verified

- [ ] slides.typ compiles without errors
- [ ] notes.typ compiles without errors
- [ ] PDF widow detection passes (0 widows)
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

**Report changes to user:**
```
Changes applied:
- [what was changed]
- slides.typ: [compiles ✓/✗]
- notes.typ: [compiles ✓/✗]
- Widow detection: [0 widows / N widows fixed]
```

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
