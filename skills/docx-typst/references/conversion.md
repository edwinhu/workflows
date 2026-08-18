# Conversion pipeline: bootstrap, build, reconcile, comments

## Bootstrap: you already have a Word manuscript

The first thing most people need, and the only direction that starts from a document
this skill never produced. One command:

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/canonicalize.py" \
    --from-docx 'paper.docx' --output body.typ --media-dir media
```

`--media-dir` is **required for any document with figures** and the script refuses
without it — see the images fact row. Verified end to end on a 1.2M Word manuscript
(7 top-level headings, 67 footnotes, 26 tables, 7 figures): 1.3s, all 7 figures
recovered to `media/`, `--check` clean on the result.

Then write the `main.typ` that `body.typ` is included from, and gate the source:

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/canonicalize.py" body.typ --check   # exit 0
git add body.typ media/ && git commit -m "bootstrap from paper.docx"
```

**Two manual steps the conversion cannot make for you:**

- **Delete the recovered table of contents.** Word's TOC arrives as a run of
  `#link(<...>)` lines, and the ones pointing at Word bookmarks rather than headings
  reference labels that do not exist — 13 of them in that manuscript, and `typst
  compile` stops at the first. A Typst document generates its TOC with `#outline()` in
  `main.typ`, so the recovered block is redundant as well as broken. Removing it is not
  a loss and does not affect the docx round trip, which reads those links fine.
- **Move styling into `main.typ`.** The recovery emits pure markup by construction, but
  anything you add must respect the split below; `--lint` enforces it.

## Forward: build a Word file

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/build.py" body.typ \
    -o paper.docx \
    --reference-doc "${CLAUDE_PLUGIN_ROOT}/references/templates/law_review_template.docx"
```

Produces real `Heading1`/`Heading2`/`FirstParagraph` Word styles, and stamps
`SourceSHA256`, `SourcePath`, `SourceGitSHA`, `StampVersion` into `docProps/custom.xml`.

**Commit the canonical form before sending.** `canonicalize.py body.typ --in-place`, then
commit. Sending from an uncommitted or non-canonical source is what strands the
reconciliation later.

## Reverse: reconcile what comes back

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/reconcile.py" returned.docx --source body.typ \
    --media-dir media
```

Writes `body.merged.typ` + `body.merged.typ.diff`, prints JSON, exits **1 on conflict**.
Ancestor resolution, in preference order:

1. **Tracked changes in the returned file** — `--track-changes=reject` reconstructs the
   pre-edit document, `accept` gives the edited one. One file yields both sides, so this
   works even for a file that was renamed or routed through a third party.
2. **`--base-docx sent.docx`** — the file that was actually sent, if it was kept.
3. **The provenance stamp** — `git cat-file` on the recorded blob sha.

If none resolves, the script **stops**. Pass `--base-docx` or `--base`.

### When the coauthor edited with track changes OFF

`reconcile.py` merges into Typst. When the human wants to *review* the edits in
Word instead — one at a time, accept/reject — use `make_redline.py`.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/make_redline.py" \
    baseline.docx returned.docx outdir/ --label "Coauthor"
```

This is the common case, not an edge case: one real round carried **22 comments
against only 4 tracked revisions**. Rejecting every tracked change still left
~25 touched paragraphs. Word's review pane showed almost nothing, because the
prose was typed with recording off. The script accepts any real tracked changes
first (so the compare reflects the coauthor's final text), then compares against
the baseline to reconstitute every difference as a tracked change.

**It emits two files, and the second is the important one.** LibreOffice's
`CompareDocuments` **does not diff footnote-internal text**. On a footnote-heavy
document that is the dangerous failure, not a cosmetic one: the body redline
silently carries the *baseline's* footnotes, so every footnote edit reads as
"unchanged" — in one case hiding a coauthor's fix to a broken `ttps://` URL. So
footnotes are lifted into body paragraphs and compared separately, with baseline
footnotes relabelled to the revised file's numbering (otherwise a single
inserted footnote renumbers everything after it and buries ~12 real edits under
~128 spurious ones).

Three traps, all of which cost a debugging cycle:

- **Argument order is not what you'd guess.** LibreOffice treats the *loaded*
  document as current and the compared file as the older one, so the revised
  file must be the one opened. Backwards silently **inverts every insertion and
  deletion** — a coauthor's typo *fix* renders as them introducing the typo.
- `soffice` crashes partway through a full-article compare often enough to need
  a retry on a fresh process and profile; the script does this.
- A stale `.~lock.` file makes `loadComponentFromURL` return `None` rather than
  raise.

`supra note N` renumbering shows up as an edit in the footnote redline — those
are cached `NOTEREF` display strings, not edits. See `${CLAUDE_PLUGIN_ROOT}/skills/docx-typst/references/citations.md`.
## Comments

```bash
uv run --script "${CLAUDE_SKILL_DIR}/scripts/comments.py" --from-docx returned.docx
uv run --script "${CLAUDE_SKILL_DIR}/scripts/comments.py" --from-drive <fileId>
```

Both backends emit one schema — `{id, author, created, modified, text, quoted, resolved,
replies[]}` — so nothing downstream branches on where the document came from. Drive is
read-only here by design; there is no write path back.
