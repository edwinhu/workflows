---
name: docx-repair
description: "Use to REPAIR a .docx damaged by a Google Docs or Word Online round-trip — the package/XML wiring, the footnote markup, leftover content controls, and heading styling. Triggers: 'Word won't open the docx / says it's corrupt', 'Google Docs export broken', 'fix the customXML error', 'recover unreadable content', 'phantom blank page', 'repair this docx'; AND 'footnotes broken after Google Docs', 'supra notes wrong after coauthor edits', 'cross-references point to the wrong footnote', 'bio footnotes show numbers instead of symbols (*, †, ‡)', 'author note shows 1 2 3 not star dagger', 'footnote numbering starts at the wrong number', 'separator line missing', 'doubled footnote marks (**, ††)'; AND 'boxes around text after Google Docs', 'content controls / doubled boxes around paragraphs', 'remove the boxes Word draws around headings', 'heading text isn't styled as a heading', 'headings look different / inconsistent heading formatting', 'blank/empty heading lines'; AND 'clean up Google Docs XML cruft', 'strip redundant run formatting', 'de-bloat docx after Google Docs', 'remove rsid bloat / no-op shading / explicit black' — or converting hardcoded 'supra note N' cross-references to auto-updating NOTEREF fields. Any OOXML-level repair on a .docx edited in a cloud editor, even if the user never says 'OOXML'. NOT for building a docx from markdown (law-review-docx) or exporting to PDF (docx-render)."
user-invocable: false
---

# DOCX Repair (Google Docs / Word Online damage)

Cloud editors damage a `.docx` in **independent ways**. This skill is the front door for all of them; run only the track(s) you need.

| Damage class | Symptom | Fix |
|---|---|---|
| **A. Package / OOXML wiring** | Word pops "recover unreadable content?" or refuses to open; LibreOffice won't load; phantom blank page | `scripts/docx_repair.py` (plugin root) — [references/package-repair.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/package-repair.md) |
| **B. Footnote & cross-reference markup** | Bios show `1,2,3` not `*,†,‡`; numbering starts wrong; "supra note N" points to the wrong footnote; missing separator line | the footnote scripts — [references/footnote-procedure.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/footnote-procedure.md) |
| **C. Document content (boxes + headings + cruft)** | Visible **boxes** around freshly-edited text; heading-looking lines not styled as headings; same-style headings rendering differently; blank heading lines; bloated XML full of all-zero rsids, no-op shading, explicit `b=0`/`i=0`/`u=none`, redundant black color & default fonts | `fix_footnotes.py`'s document.xml passes — [references/content-cleanup.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/content-cleanup.md) |
| **D. Presentation hygiene** | A footnote renders blue/underlined in the PDF but looks normal in Word; a URL prints one address and navigates to another; heading gaps uneven page to page; tracking params (`?utm_source=…`) behind a clean-looking link | `docx_links.py`, `docx_spacers.py` — [references/presentation-hygiene.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/presentation-hygiene.md) |

They are decoupled: package repair fixes the **part wiring** (never touches content); footnote repair fixes the **footnote markup**; content cleanup strips Google-Docs leftover content controls and normalizes headings. A file can need any, all, or none. If you don't know which, run the package check first (it's a no-op on a clean package), then the footnote pass (it carries the content cleanup).

> Heads-up: `docx-render`'s Word path already composes `docx_repair.py` as a preflight, so a Google export "just renders" without a manual Track A. Run Track A manually when you need the *repaired file itself* (to hand back, edit, or footnote-fix), not just a PDF.

---

## Reference index — read the file for the track you are running

All procedural detail lives in `references/`. Read only what the job needs.

- [references/package-repair.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/package-repair.md)
  — **Track A.** The two concrete Google Docs export defects (case-mismatched
  `customXML`/`customXml` OPC part references; leftover `<w:evenAndOddHeaders/>`),
  and the CLI + Python API for `scripts/docx_repair.py` at plugin root.
  **Read when** Word calls the file corrupt, refuses to open it, or shows a
  phantom blank page — or before handing back a repaired file rather than a PDF.

- [references/footnote-procedure.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/footnote-procedure.md)
  — **Track B, the canonical procedure.** The exact four-step order for a Google
  Docs round-trip (accept changes → `fix_footnotes.py` → `create_crossrefs.py
  --baseline` → render with Word), what to verify in the render, the
  incident-grounded procedure facts (why step 3 must follow step 2, why
  `--baseline` is not optional, why LibreOffice lies), the list of symptoms
  footnote repair applies to, and the quick-start "which script do I want?"
  routing. **Read when** running any footnote repair — start here.

- [references/footnote-scripts.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/footnote-scripts.md)
  — **Track B, script detail.** Per-script behaviour and every flag for
  `fix_footnotes.py`, `create_crossrefs.py` (including how `--baseline` remaps
  stale numbers) and `refresh_noteref_caches.py` (why the naive approaches fail,
  its requirements and intentional scope), plus the footnote numbering-offset fix
  (`numRestart`). **Read when** you need a specific flag, or the exact semantics
  of one of the three scripts.

- [references/footnotes-reference.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/footnotes-reference.md)
  — **Track B, OOXML technical reference.** (1) Run-level editing gotchas (NBSP,
  cross-run matching, `xml:space`); (2) cloud editor damage patterns — what gets
  destroyed and why; (3) direct ZIP surgery patterns that bypass Document
  libraries; (4) the numbering-restart details and the critical rule that
  `numRestart` goes in `settings.xml` ONLY. **Read when** hand-editing footnote
  XML or debugging behaviour the scripts do not cover.

- [references/content-cleanup.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/content-cleanup.md)
  — **Track C.** The four content passes `fix_footnotes.py` carries: stripping
  `goog_rdk` content controls (the "boxes", default on), heading normalization
  (`--normalize-headings`), the OOXML hygiene / de-cruft rules (default on, with
  the exact strip/keep lists), body-indent normalization
  (`--normalize-body-indent`), and applying the template's body styles
  (`--restyle-body`), plus the content-cleanup incident facts. **Read when**
  boxes, inconsistent headings, stray indents or XML bloat are the complaint, or
  before passing any of those flags.

- [references/presentation-hygiene.md](${CLAUDE_PLUGIN_ROOT}/skills/docx-repair/references/presentation-hygiene.md)
  — **Track D.** `docx_links.py` (tracking-param stripping, SSRN canonicalization,
  footnote hyperlink unwrapping — and why display text and relationship `Target`
  must both be rewritten) and `docx_spacers.py` (manual spacer removal, why a
  text-empty paragraph may not be empty, the title-page collapse hazard), plus why
  both edit bytes rather than the ElementTree tree. **Read when** the PDF shows
  blue/underlined footnotes, a link that navigates elsewhere, or uneven heading
  gaps.

---

## Related (document skill group)

This skill owns the **REPAIR** stage — package wiring (Track A), footnote
markup (Track B), and document-content cleanup (Track C) — for a `.docx` damaged
by a cloud editor. Adjacent stages:

- **Build** a styled `.docx` from markdown → `law-review-docx` (its `build_docx.py`
  chains this skill's footnote repair + NOTEREF conversion after the pandoc build).
- **Render** to PDF/PNG → `docx-render` / `scripts/doc_render.py` (Word path composes
  Track A's `docx_repair.py` as a preflight automatically).
- **Footnote repair lives only here.** `fix_footnotes.py` is the single canonical
  Google-Docs / Word-Online footnote fixer; there is no second copy. (Bluebook's
  `create_crossrefs.py` + `audit_crossref_targets.py` remain a deliberate,
  actively-used *cross-reference* fork with their own retargeting strategy — a
  different concern, not a footnote-fix duplicate.)

See the full [document skill group](../../references/document-skills.md).
