# B. Footnote & cross-reference repair — canonical procedure

Fix footnote formatting damage and convert hardcoded supra-note references to NOTEREF field codes.

### Canonical Procedure — Google Docs round-trip

A law-review draft that round-trips through **Google Docs** every editing round (the OPV/Nadya case) comes back with both formatting damage AND stale cross-reference numbers. Run these **in this exact order** on the returned `.docx`. Use `$SKILL_DIR` for the absolute path to this skill's directory and keep the last-known-good draft as `OLD.docx`.

```bash
# 1. Accept tracked changes first (the coauthor's edits). Numbering and the
#    baseline remap both assume the FINAL accepted text. (Word: Review →
#    Accept All; or the document skill's accept-changes path.)

# 2. Repair footnote markup (separators, styles, bio custom marks, pStyles),
#    strip Google Docs content controls (the "boxes"), AND strip GDocs OOXML
#    cruft (hygiene pass, default-on). --normalize-headings restyles/cleans
#    heading paragraphs; --normalize-body-indent uniforms body indents (see §C).
uv run "$SKILL_DIR/scripts/fix_footnotes.py" returned.docx -o step2.docx \
  --normalize-headings --normalize-body-indent

# 3. Remap stale "supra note N" numbers against the known-good baseline, THEN
#    convert to NOTEREF fields. --baseline is what fixes the coauthor-shift.
uv run "$SKILL_DIR/scripts/create_crossrefs.py" \
  --docx step2.docx --output step3.docx --baseline OLD.docx

# 4. Render with WORD and eyeball it (LibreOffice numbers custom marks wrong).
uv run "$SKILL_DIR/../../scripts/doc_render.py" \
  step3.docx step3.pdf --renderer word --allow-word
```

**Verify in the render:** author bios show `*`, `†`, `‡` (not `1, 2, 3` and not doubled `**`, `††`); the first real footnote is `1`; a remapped reference (e.g. "Kahan & Rock, supra note 8") points to the correct footnote; no boxes around freshly-edited sections; same-level headings render identically. Then in Word, **Ctrl+A, F9** to refresh the NOTEREF display numbers.

### Procedure Facts (incident-grounded)

- **Step 3 must run AFTER step 2.** `create_crossrefs --baseline` counts footnote display numbers the way Word does — skipping the `customMarkFollows` bio marks. Until `fix_footnotes` converts the bios to custom marks, the bios are still numbered `1, 2, 3`, so the alignment is off by the bio count and every remapped number is wrong. Running step 3 first silently mis-targets the cross-references it was supposed to fix.
- **`--baseline` is not optional for the Google Docs case.** Google Docs flattens every NOTEREF field back to hardcoded "supra note N" text, frozen at the prior draft's numbering. After a coauthor inserts/deletes footnotes the offset is *non-uniform*, so `create_crossrefs` without `--baseline` bookmarks by current position and mis-targets ~90% of references — the exact failure this skill exists to prevent.
- **The remap's flagged list is a human cite-check queue, not noise.** `--baseline` prints `⚠ … could NOT be remapped` for references whose footnote content did not align one-to-one (inserts, deletes, densely-similar citation clusters). These are left unchanged on purpose — guessing a target you cannot prove is how a wrong citation ships. Surface the flagged list to the user for manual verification; do not suppress it.
- **Render with Word, never LibreOffice, to verify.** LibreOffice renders `customMarkFollows` numbering wrong (verified 2026-06-10), so bios that are actually correct can look broken — leading you to "fix" something that was right. `doc_render.py --renderer word` (or `x2t`) is ground truth.
- **Bio-mark superscript depends on the `FootnoteReference` *style*, which Google Docs can strip.** Bio ref runs carry `rStyle="FootnoteReference"` but no explicit `vertAlign`; they render superscript only if that style still defines it. A round-trip can strip the superscript out of the style while leaving the reference, so the marks drop to baseline (OPV, 2026-06-28: title-page `*`/`†`/`‡` baseline; regular footnote numbers were fine because they carry *explicit* `vertAlign`). So `_run_has_superscript` only trusts a bare `rStyle="FootnoteReference"` when `_footnote_ref_style_has_superscript(styles_xml)` confirms the style actually defines it; otherwise `fix_bio_superscript` adds explicit `vertAlign`. And `fix_bio_superscript` MUST run **after** `restore_bio_custom_marks` — restore rebuilds the ref runs and would discard a superscript added before it.
- **The `goog_rdk` "boxes" are an on-screen Word artifact — they do NOT export to PDF.** Word draws boundaries around nested content controls in its editor, but neither Word's nor x2t's PDF export renders them. So a "no boxes" PDF is NOT proof the controls were stripped — verify at the XML level (`unzip -p file.docx word/document.xml | grep -c goog_rdk` → `0`). `fix_footnotes.py` reports the strip count; trust that over the render.

### When footnote repair applies

Common footnote symptoms in `.docx` files round-tripped through Google Docs or Word Online:

- Missing footnote separator lines
- Stripped paragraph styles (pStyle) on footnote bodies
- Stripped style *definitions* (`FNStyleBest` etc.) — the pStyle reference points at an undefined style and Word silently falls back to Normal
- Author bio custom marks (`*`, `†`, `‡`) replaced with numbers, or rendered **doubled** (`**`, `††`) when Google Docs welded the literal mark onto adjacent text
- Footnote numbering starting at the wrong number (offset from `customMarkFollows` bio footnotes)
- "supra note N" cross-references pointing to the **wrong footnote** after a coauthor inserted/deleted footnotes (numbers frozen by a Google Docs NOTEREF flatten)
- TOC separator paragraphs that inflate to fill a whole page
- Hardcoded "supra note N" / "infra note N" references that need to become auto-updating NOTEREF fields

### Footnote scripts — quick start

Scripts are in this skill's `scripts/` directory. Use `$SKILL_DIR` below as a placeholder for the absolute path to this skill (the directory containing this SKILL.md). Each script carries PEP 723 inline metadata, so `uv run script.py` auto-installs `lxml` — no `--with lxml` needed.

For the full **Google Docs round-trip**, follow the [Canonical Procedure](#canonical-procedure--google-docs-round-trip) above (it chains these in the required order). Individual scripts:

```bash
# Dry run (show what would change)
uv run "$SKILL_DIR/scripts/fix_footnotes.py" path/to/file.docx --dry-run

# Fix cloud-editor footnote damage
uv run "$SKILL_DIR/scripts/fix_footnotes.py" path/to/file.docx -o fixed.docx

# Convert cross-references, remapping stale numbers against a known-good baseline
uv run "$SKILL_DIR/scripts/create_crossrefs.py" \
  --docx fixed.docx --baseline OLD.docx

# Refresh stale NOTEREF cross-ref numbers after a coauthor inserted/moved
# footnotes in Word (render-based, ground-truth; needs x2t or LibreOffice)
"$SKILL_DIR/scripts/refresh_noteref_caches.py" path/to/file.docx --verify
```

**Which script do I want?**
- Footnotes look broken after a **Google Docs / Word Online** round-trip (missing separators, wrong styles, bios numbered or doubled, mark/number mix-ups) → **`fix_footnotes.py`**.
- The doc still has **hardcoded** "supra note 42" **text** that should become auto-updating fields → **`create_crossrefs.py`** (add **`--baseline OLD.docx`** when the numbers went stale through a Google Docs round-trip).
- The doc **already uses NOTEREF fields** but a coauthor **inserted/moved/deleted footnotes in Word** and the cross-reference **numbers are now wrong** → **`refresh_noteref_caches.py`** (this is the common "Nadya emailed back tracked edits and the numbering is off" case).

