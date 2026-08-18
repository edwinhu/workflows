---
name: docx-typst
description: "Use to BUILD a Word document from a TYPST source, CONVERT a Word manuscript into Typst, or bring a returned .docx back into the repo. Triggers: 'build the docx from the typ', 'typst to Word', 'send them a Word version of this paper', 'I have a Word manuscript, give me Typst', 'convert this docx to typst', 'move my paper off Word', 'start a Typst repo from this Word draft', 'my coauthor sent back the docx', 'they returned the Word file with edits', 'reconcile their edits with my source', 'merge the docx changes back', 'what did they change in the Word file', 'pull the comments out of the docx', 'get their comments from the Google Doc', 'is this file canonical', 'the source and the docx have diverged'. ALSO owns TYPST CITATION RENDERING: 'render Bluebook citations in Typst', 'supra note numbering', 'my supra notes point at the wrong footnote', 'footnote numbers do not renumber when I insert one', 'Id. and supra in typst', 'small-caps reporters in typst', 'hayagriva cannot do Bluebook', 'typst bibliography style for a law review'. NOT 'law-review-docx' or 'law-econ-docx' (docx from MARKDOWN), NOT 'docx-repair' (OOXML damage), NOT 'docx-render' (docx to PDF only)."
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
   existing.docx ──canonicalize.py --from-docx──> body.typ + media/   (bootstrap, once)
                                                     │
   main.typ ──typst compile──> PDF                   │
      │                                              │
      │ #include                                     ▼
      ▼
   body.typ ──build.py──> paper.docx ──email──> coauthor edits in Word
      ▲                                                    │
      │                                                    │ sends back
      └──── reconcile.py <── merged body.typ <── returned.docx
                                                     │
                                                     └──comments.py──> comments.json
```

## Scripts

All under `${CLAUDE_SKILL_DIR}/scripts/`. Each is self-contained and prints `--help`.

**Run them with `uv run --script`, not `uv run python3`.** Four of the five declare
`lxml` in a PEP 723 header, and `uv run python3 <path>` ignores that header and fails
with `ModuleNotFoundError: No module named 'lxml'`. `--script` (or executing the file
directly, since the shebang is `uv run`) reads the header and provisions the dependency.

| Script | Direction | Does |
|---|---|---|
| `build.py` | typ → docx | Convert with `--reference-doc` styles **and** stamp provenance, in one step |
| `canonicalize.py` | docx → typ | **Bootstrap** an existing Word manuscript (`--from-docx`); put a body file on its fixed point; `--check` gates it; `--lint` guards the body/main split |
| `reconcile.py` | docx → typ | Resolve the ancestor, three-way merge a returned file against the repo source |
| `comments.py` | docx or Drive → JSON | Extract comments with their anchor text, resolved state, and threading |
| `provenance.py` | — | Read/write the stamp directly (build.py already applies it) |
| `expand_citations.py` | typ → typ | Freeze every computed reference — `#cite(...)` **and** `@label` — into the literal body the docx path needs |
| `make_redline.py` | docx × docx → docx | Rebuild a coauthor's **untracked** edits as real tracked changes, against a baseline (stdlib + LibreOffice; no PEP 723 header) |

## The `main.typ` / `body.typ` split

```
main.typ    #import / #let / #show / #set, then #include "body.typ"    ← typst compiles this
body.typ    pure markup: = headings, prose, #emph, #footnote           ← pandoc reads this
```

Both paths see the same prose and neither degrades the other. The split is not stylistic
tidiness — see the first fact row in
`${CLAUDE_PLUGIN_ROOT}/skills/docx-typst/references/facts.md`.

## References — read the one the task needs

| Read | When |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/skills/docx-typst/references/conversion.md` | Any actual conversion: bootstrapping a Word manuscript into `body.typ`, building the `.docx`, reconciling a returned file, rebuilding untracked edits as a redline, extracting comments |
| `${CLAUDE_PLUGIN_ROOT}/skills/docx-typst/references/citations.md` | A manuscript whose numbers must maintain themselves — `supra note N`, `Section IV.B`, `Id.`; the `bluebook.typ` renderer, `bib_to_entries.py`, hand-authored short forms, the `entries` schema, the two-body-file split |
| `${CLAUDE_PLUGIN_ROOT}/skills/docx-typst/references/facts.md` | Before changing the conversion path, or when a build/round trip behaves in a way the commands do not explain — the pandoc and typst defects this skill normalizes around, and why each rule exists |
| `${CLAUDE_PLUGIN_ROOT}/skills/docx-typst/references/maintenance.md` | Changing this skill or its scripts: the test suite, the two tests that pin bugs, and what "verified" requires |

## Red Flags — STOP

| Action | Why wrong | Do instead |
|---|---|---|
| About to point pandoc at `main.typ` | Its `#show` rules destroy heading semantics in the docx | Point it at `body.typ` |
| About to pass `--allow-styling` to clear a lint error | Ships a headingless Word file | Move the directives into `main.typ` |
| About to hand-edit the returned `.docx` and call it reconciled | The repo source still diverges; the next build overwrites the edits | Run `reconcile.py` and merge into the source |
| About to resolve `<<<<<<<` markers by deleting one side wholesale | Discards a coauthor's edit unreviewed | Read both sides; ask the user when the prose choice is theirs |
| About to commit a merge without reading `.merged.typ.diff` | The merge is a claim about someone else's edits, unverified | Read the diff, then commit |
| About to send a `.docx` built from an uncommitted source | Fallback 3 needs a committed blob; the ancestor is unrecoverable | Canonicalize, commit, then build |
| About to run `--from-docx` without `--media-dir` because the error is in the way | Every figure is dropped and the output still looks complete | Name the sidecar directory; it is one argument |
| About to invoke a script with `uv run python3 <path>` | The PEP 723 header is ignored and the lxml scripts die on import | `uv run --script <path>` |
| About to hand-fix `Officers"` in a recovered file | The converter did it, not the source; hand-fixes are re-corrupted next pass | Re-recover with current `canonicalize.py`, which restores `’` |
| About to name a custom citation function in the body file | pandoc dies with `Identifier not found` and no docx is produced | `#show cite:` over the built-in `#cite(<Key>)` |
| About to put live `#cite` in the file `reconcile.py` merges into | It can never be canonical; the merge churns on every citation | Keep the symbolic form in `body-src.typ`, generate the literal one |
| About to write `#cite(<a>); #cite(<b>)` in a stacked footnote | typst groups them and the `;` vanishes from the PDF | `#cite(<a>)#[;] #cite(<b>)` |
| About to hand-edit the generated `cite-data.typ` to fix a short form | It is regenerated, and `--diff` will report your fix as a delta forever | Fix the `.bib` or the CSL, then regenerate and diff |
| About to patch hayagriva to get `supra note N` | It is statically linked into typst, and note numbers are a layout property a patch cannot reach | Render citations in typst with a `#show cite:` rule |
| About to `typst compile` a freshly recovered body and conclude the conversion failed | Word's TOC arrives as links to bookmarks that are not labels | Delete the recovered TOC block; `#outline()` in `main.typ` replaces it |

## Scope

Owns **typst → docx**, and **Bluebook citation rendering in typst** — the renderer lives
here rather than in `bluebook` because it is co-designed with `expand_citations.py`, which
reads the `<bb-out>` tag it emits, and that two-file split exists only because of the docx
round trip. `bluebook` owns the RULES; this skill owns making typst emit them.

`law-review-docx` and `law-econ-docx` own **markdown → docx**; different input format, no
overlap — a markdown manuscript gets Bluebook from pandoc-citeproc and the bundled CSL, and
needs nothing here. `docx-repair` fixes OOXML damage from a cloud round trip and composes
cleanly before `reconcile.py` when a returned file is also damaged.
