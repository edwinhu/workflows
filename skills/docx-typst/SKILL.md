---
name: docx-typst
description: "Use this skill to BUILD a Word document from a TYPST source file, and to bring a returned .docx back into the repo. Triggers: 'build the docx from the typ', 'typst to Word', 'send them a Word version of this paper', 'my coauthor sent back the docx', 'they returned the Word file with edits', 'reconcile their edits with my source', 'merge the docx changes back', 'what did they change in the Word file', 'pull the comments out of the docx', 'get their comments from the Google Doc', 'is this file canonical', 'the source and the docx have diverged'. NOT 'law-review-docx' or 'law-econ-docx' (those build a docx from MARKDOWN — different input format), NOT 'docx-repair' (which fixes OOXML damage from a cloud round trip), NOT 'docx-render' (which only converts an existing .docx to PDF)."
user-invocable: true
---

# DOCX ↔ Typst Bridge

Typst source is the thing the repo keeps. Word is the thing coauthors edit. This skill
moves a document across that boundary **in both directions** and reconciles what comes
back.

The load-bearing fact: `typ → docx → typ` reaches a **fixed point after one pass**. So
the pipe's output is itself valid Typst, the canonical form can be committed, and
reconciling a coauthor's returned file collapses from "read two documents side by side"
to `git merge-file`.

```
   main.typ ──typst compile──> PDF
      │
      │ #include
      ▼
   body.typ ──build.py──> paper.docx ──email──> coauthor edits in Word
      ▲                                                    │
      │                                                    │ sends back
      └──── reconcile.py <── merged body.typ <── returned.docx
                                                     │
                                                     └──comments.py──> comments.json
```

## Scripts

All under `${CLAUDE_SKILL_DIR}/scripts/`. Each is self-contained (`uv run` shebang,
stdlib + lxml) and prints `--help`.

| Script | Direction | Does |
|---|---|---|
| `build.py` | typ → docx | Convert with `--reference-doc` styles **and** stamp provenance, in one step |
| `canonicalize.py` | — | Put a body file on its fixed point; `--check` gates it; `--lint` guards the body/main split |
| `reconcile.py` | docx → typ | Resolve the ancestor, three-way merge a returned file against the repo source |
| `comments.py` | docx or Drive → JSON | Extract comments with their anchor text, resolved state, and threading |
| `provenance.py` | — | Read/write the stamp directly (build.py already applies it) |

## The `main.typ` / `body.typ` split

```
main.typ    #import / #let / #show / #set, then #include "body.typ"    ← typst compiles this
body.typ    pure markup: = headings, prose, #emph, #footnote           ← pandoc reads this
```

Both paths see the same prose and neither degrades the other. The split is not stylistic
tidiness — see the first fact row.

## Forward: build a Word file

```bash
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/build.py" body.typ \
    -o paper.docx \
    --reference-doc "${CLAUDE_SKILL_DIR}/../writing-legal/templates/law_review_template.docx"
```

Produces real `Heading1`/`Heading2`/`FirstParagraph` Word styles, and stamps
`SourceSHA256`, `SourcePath`, `SourceGitSHA`, `StampVersion` into `docProps/custom.xml`.

**Commit the canonical form before sending.** `canonicalize.py body.typ --in-place`, then
commit. Sending from an uncommitted or non-canonical source is what strands the
reconciliation later.

## Reverse: reconcile what comes back

```bash
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/reconcile.py" returned.docx --source body.typ
```

Writes `body.merged.typ` + `body.merged.typ.diff`, prints JSON, exits **1 on conflict**.
Ancestor resolution, in preference order:

1. **Tracked changes in the returned file** — `--track-changes=reject` reconstructs the
   pre-edit document, `accept` gives the edited one. One file yields both sides, so this
   works even for a file that was renamed or routed through a third party.
2. **`--base-docx sent.docx`** — the file that was actually sent, if it was kept.
3. **The provenance stamp** — `git cat-file` on the recorded blob sha.

If none resolves, the script **stops**. Pass `--base-docx` or `--base`.

## Comments

```bash
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/comments.py" --from-docx returned.docx
uv run python3 "${CLAUDE_SKILL_DIR}/scripts/comments.py" --from-drive <fileId>
```

Both backends emit one schema — `{id, author, created, modified, text, quoted, resolved,
replies[]}` — so nothing downstream branches on where the document came from. Drive is
read-only here by design; there is no write path back.

## Facts

- **Show rules in the file pandoc reads collapse `= Heading` into a bold paragraph.**
  Pandoc evaluates them before writing the docx, the build still succeeds, and the damage
  surfaces only when someone opens Word's navigation pane and finds it empty. `build.py`
  refuses a body carrying `#show`/`#set`/`#let`/`#import` for this reason. Reaching for
  `--allow-styling` to get past the error ships a headingless document to a coauthor —
  the opposite of the help that motivated skipping the split.

- **A returned `.docx` has no ancestor unless one was arranged in advance.** Merging two
  versions without a common base silently drops one side's edits, and the loss is
  invisible in the output. This is why build and stamp are one invocation with no
  `--no-stamp`: provenance a caller can forget is discovered months later, when the
  document comes back and the ancestor is gone.

- **Google Docs drops custom document properties on export.** A file that went through
  Drive comes back unstamped even though it was built stamped. Ask the coauthor to track
  changes, or keep the sent `.docx` for `--base-docx`. Word itself preserves the stamp.

- **The canonical form is defined as one full docx round trip, not `-f typst -t typst`.**
  The docx trip is the pipe a returned document actually passes through, so it is the
  only fixed point that matters. `--wrap=none` is part of the definition: at pandoc's
  default 72-column wrap a one-word edit reflows its whole paragraph, and the merge
  reports a dozen changed lines where one word changed.

- **The reference doc does not affect the canonical form** — it changes the docx's styles,
  not its structure. Canonical form is template-independent, so re-templating a document
  never churns the source.

- **Normalization on the first pass is cosmetic and stable**: `_x_`→`#emph[x]`,
  `*x*`→`#strong[x]`, straight→curly quotes, a `<label>` anchor after each heading. A
  first canonicalization of a hand-written file touches many lines; that diff is the
  format converging, not content changing, and it happens exactly once.

- **`reconcile.py` exits non-zero and leaves `<<<<<<<` markers when both sides edited the
  same passage.** Resolving those by picking a side is a judgment call about two people's
  prose; making it automatically would discard a coauthor's edit without anyone seeing it.

## Red Flags — STOP

| Action | Why wrong | Do instead |
|---|---|---|
| About to point pandoc at `main.typ` | Its `#show` rules destroy heading semantics in the docx | Point it at `body.typ` |
| About to pass `--allow-styling` to clear a lint error | Ships a headingless Word file | Move the directives into `main.typ` |
| About to hand-edit the returned `.docx` and call it reconciled | The repo source still diverges; the next build overwrites the edits | Run `reconcile.py` and merge into the source |
| About to resolve `<<<<<<<` markers by deleting one side wholesale | Discards a coauthor's edit unreviewed | Read both sides; ask the user when the prose choice is theirs |
| About to commit a merge without reading `.merged.typ.diff` | The merge is a claim about someone else's edits, unverified | Read the diff, then commit |
| About to send a `.docx` built from an uncommitted source | Fallback 3 needs a committed blob; the ancestor is unrecoverable | Canonicalize, commit, then build |

## Verifying a change to this skill

```bash
./scripts/check-tests.sh docx_typst
```

`tests/docx_typst_test.py` pins the four pandoc behaviors this skill rests on — the fixed
point, reference-doc styles, tracked-changes ancestry, and comment extraction. They are
properties of an external binary this repo does not pin, so they are asserted rather than
trusted.

## Scope

Owns **typst → docx**. `law-review-docx` and `law-econ-docx` own **markdown → docx**;
different input format, no overlap. `docx-repair` fixes OOXML damage from a cloud round
trip and composes cleanly before `reconcile.py` when a returned file is also damaged.
