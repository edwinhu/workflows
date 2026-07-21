---
name: docx-render
description: "Use when rendering/converting an EXISTING .docx (or .pptx/.xlsx) to PDF or PNG — 'convert docx to pdf', 'docx to pdf', 'render this Word doc', 'word to pdf', 'export docx as pdf', 'make a pdf of this docx', 'pdf from the docx', 'render the document to PDF'. The faithful path (Word's engine, incl. from background/headless jobs) lives in scripts/doc_render.py. NOT for editing docx content (use the generic 'docx' skill) and NOT for building a docx from markdown (use 'law-review-docx')."
user-invocable: true
---

**Announce:** "I'm using docx-render to convert this document to PDF via doc_render."

# DOCX → PDF/PNG rendering

Office docs → PDF/PNG go through the shared converter `scripts/doc_render.py`
(`convert()`), which picks the best engine and applies the right fixes. **Do not
hand-roll `soffice`/`libreoffice` or lean on the generic `docx` skill's own
export** — those skip the Word-fidelity path and the x2t kerning/table fixes.

## Default to `--renderer word` (Iron Law)

**For any PDF a human will read — a deliverable, an email attachment, a reading-list
file, anything you hand to the user — pass `--renderer word`.** The bare/`auto`
command is NOT the safe default: `auto` deliberately EXCLUDES Word (the check is
`if avail["word"] and allow_word`, and `allow_word` defaults False) and silently
uses x2t/LibreOffice, which **reflow the layout** (real case: a 5-page doc shipped
as 7). Word works even from a background/headless job via cmux dispatch (below), so
there is no reason to skip it for a deliverable.

Reserve bare `auto` for **parallel pipeline builds** (e.g. many law-review renders
at once) where headless/parallel-safety matters more than line-exact fidelity and
the docs are pipeline-generated (x2t/soffice already grid-faithful there).

**On Linux, `--renderer word` cannot work** — it drives `Word.app` through
AppleEvents. Use **`--renderer word-remote`** instead: the same real Word engine
in a QEMU Windows guest, driven over SSH. See "Word in a Windows guest" below.

**Always verify the engine actually used** via the PDF Producer before handing off
(see table below) — `auto` can fall back, and `--renderer word` only *raises* if
Word is truly unavailable.

## Entry point

```bash
# CLI (faithful Word engine — DEFAULT for anything a human reads):
python3 ${CLAUDE_SKILL_DIR}/../../scripts/doc_render.py IN.docx OUT.pdf --renderer word
# auto engine (LibreOffice/x2t; NO Word) — ONLY for parallel pipeline builds:
python3 ${CLAUDE_SKILL_DIR}/../../scripts/doc_render.py IN.docx OUT.pdf
```
```python
import sys; sys.path.insert(0, "<plugin>/scripts")
from doc_render import convert
convert("in.docx", "out.pdf", renderer="word", allow_word=True)   # gold standard
convert("in.docx", "out.pdf")                                     # auto (headless)
```

**Agents without the `Skill` tool** (most workflow subagents): run the CLI above
directly — you don't need to invoke this skill, just call `doc_render.py`.

## Which engine, and why it matters

| Engine | Fidelity | Notes |
|--------|----------|-------|
| **Word** (`--renderer word`) | gold standard | native layout; **only engine that keeps an auto-wrapping table as a grid** in a *hand-authored* docx (LibreOffice collapses it to a stacked column). Recomputes Word fields (REF/NOTEREF/PAGEREF/TOC). **macOS only** — it drives `Word.app` over AppleEvents. |
| **word-remote** (`--renderer word-remote`) | gold standard | the same real Word engine, in a QEMU Windows guest over SSH. **The Word path on Linux**, where `--renderer word` cannot work at all. Also usable from macOS against a guest on that host. |
| **x2t** | good | OOXML-native; correct per-section footnote restart; doc_render injects GPOS/kern + EB-Garamond so it matches. |
| **LibreOffice** | good *except* | wrong for per-section/page footnote restart; collapses auto-wrapping tables not pre-broken upstream. |

`convert()` auto-falls-back Word → x2t/soffice. **Verify which ran** via the PDF
Producer: `macOS … Quartz PDFContext` = Word; `LibreOffice …` = LibreOffice.

## Word from a background/headless job (the non-obvious part)

A detached Claude job is in a non-console GUI session without Word's TCC grant, so
direct AppleEvents fail with -600. `doc_render` transparently **dispatches the
render into a cmux pane** (console session, TCC-granted) and falls back to
x2t/LibreOffice if that's unavailable. Prereqs + full root-cause:
`docs/investigations/2026-06-22_word-render-cmux-dispatch.md`. Disable with
`$DOC_RENDER_NO_CMUX=1`.

### Driving the Mac's Word from another machine over SSH — doesn't work

The cmux rescue above assumes you are **on** the Mac. Invoking `--renderer word`
over SSH from another host (e.g. a Linux box rendering on `mbp`) fails
differently and has **no fallback** — cmux dispatch fails too, because there is
no console session on the far end to dispatch into:

```
doc_render: word renderer failed: Word direct render failed
  ([Errno 1] Operation not permitted:
   ~/Library/Containers/com.microsoft.Word/Data/wordrender/<uuid>);
  cmux dispatch also failed (…same…)
```

Note this is a **filesystem** permission error on Word's app container, not the
AppleEvents `-600` of the local case — an SSH session is outside the TCC grant
entirely. `launchctl asuser $(id -u) …` does **not** rescue it (`Could not
switch to audit session: Operation not permitted` — needs root).

Fixes, in order of preference:

1. **Use `word-remote`** (next section) — a Windows guest is the supported
   remote path; driving the Mac's Word from off-box is not.
2. Run the render from a terminal **inside the Mac's GUI login session** (then
   the normal local path, incl. cmux dispatch, applies).
3. Grant Full Disk Access to `/usr/libexec/sshd-keygen-wrapper` in System
   Settings → Privacy & Security, after which headless SSH renders work.

**Do not** paper over this by falling back silently — an explicit
`--renderer word` deliberately raises rather than downgrading.

## Word in a Windows guest (`word-remote`) — the Linux path

`--renderer word` is macOS-only. `word-remote` runs the same Word engine in a
QEMU Win11 guest and drives it over SSH, so Linux gets gold-standard fidelity:

```bash
python3 scripts/doc_render.py IN.docx OUT.pdf --renderer word-remote
```

Provisioned by the `programs.wordRender` nix module — `word-render` and
`word-render-install-fonts` on PATH, transport at
`~/.local/share/word-render/word_render_remote.sh` (override with
`$WORD_RENDER_REMOTE`). Full setup: `~/nix/modules/shared/word-render/README.md`.

Selection rules:

- **Explicit** `--renderer word-remote` always runs it (and raises rather than
  falling back, like every explicit engine).
- **`auto` picks it only with `allow_word=True`**, and only when local Word is
  unavailable — i.e. it is the Linux stand-in for `renderer="word"`, preferred
  over the lower-fidelity engines rather than silently downgrading.
- **`auto` never reaches it in the fallback cascade.** Booting/using a VM is not
  something best-effort should do behind the caller's back.

Availability is a **file check on the transport script, not an SSH probe** — a
reachability test would cost a round-trip (and can hang on a suspended VM) on
every `convert()`. A down guest surfaces as a render error naming the fix.

**A fresh guest silently renders the wrong fonts.** Word substitutes
Cambria/Calibri for any font it can't resolve *and still exits 0*, so the render
"succeeds" with wrong typography. Run `word-render-install-fonts` once per
guest, then verify with `pdffonts` — never trust the exit code. (Stock
`lmodern` does not work: Word won't render CFF-flavoured OpenType, and it
matches families on name ID 1. The nix module ships a converted set.)

## Google Docs exports

A docx exported from Google Docs can carry OOXML package corruption (case-broken
`customXML` part paths) that makes Word pop a "recover unreadable content" modal
on open — fatal to a headless render. The Word path **auto-repairs** it via a
preflight (`scripts/docx_repair.py`); you'll see `Word preflight — repaired
Google-export package …` on stderr. Repair a docx standalone with
`python3 scripts/docx_repair.py in.docx [out.docx]`. Root cause:
`docs/investigations/2026-06-23_gdocs-customxml-case.md`.

## Related skills

Part of the **[document skill group](../../references/document-skills.md)**
(extract → create → repair → build → render → verify):
- **law-review-docx** — *builds* a .docx from markdown (template + pandoc), then renders.
- **docx** (generic) — *edits* docx content (tracked changes, comments, text).
- **docx-repair** — repairs a cloud-editor-damaged .docx (package/XML wiring + footnote markup).
- **xlsx** recalc / **pptx-render** — spreadsheet recalc / slide inspection.
