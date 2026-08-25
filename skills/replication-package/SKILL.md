---
name: replication-package
description: "ALWAYS use when code and data have to leave the machine as a self-contained archive for someone who did not write them — 'build the replication package', 'package this for counsel', 'send the workpapers', 'production archive for the opposing expert', 'replication archive', 'they want the code and data', 'put together what they asked for in the document request', 'make a workbook for the client', 'archive this analysis so someone else can check it', 'write the runbook', 'they need to be able to rerun the pipeline', 'document how the data was collected'. Use proactively whenever an expert report, a submission or a document request implies handing over the underlying work, even when the user only says 'zip it up'. NEGATIVE ROUTING: building the analysis itself goes to `ds`; a Word deliverable goes to `law-review-docx` or `docx-typst`; a single spreadsheet with no archive around it is plain `xlsx`."
user-invocable: true
---

# Replication package

A production is read by a lawyer on Windows, not by you on Linux. Everything below
follows from that.

## The four outputs

A production is not one artifact. Name all four at the start and say which are in scope; a
missing one is a gap the recipient discovers, not a simplification.

| Output | For | Skip only when |
|---|---|---|
| The archive | someone re-running the code | never |
| The workbook (XLSX) | a lawyer who will not run code | no tabular result |
| The runbook | someone rebuilding the inputs from source | every input ships in the archive |
| README + MANIFEST.csv | anyone verifying what arrived | never |

## Scope: only what the deliverable used

**A production is not a repository dump, and nothing extra is owed.** Ship the runbook, the
workbook, the notebook or script that IS the deliverable, and the data those read. Everything
else is out — not withheld, just not part of this work.

Compute the boundary, do not curate it. Walk the import graph from the deliverable's entry
points and ship that closure; the difference is usually large (one production went from 75
modules to 18, 274 MB of parquets to 10). A computed closure can be defended and recomputed; a
hand-picked one invites an argument about what was left out and why.

**Then purge the neighbours from what remains** — in EVERY file, not just the prose:

- Superseded exhibits, alternate versions, "rendered but not used" figures. If it is not in the
  draft it does not ship, and neither does the code that builds it — otherwise re-running the
  pipeline produces an artefact the production cannot explain.
- Shared config. A config serving two studies carries the other one's parameters; reduce it to
  the constants the shipped code reads, plus what those are defined from.
- Comments and docstrings that cross-reference the other work — including a kept function whose
  docstring justifies itself against a removed one. Grep the staged tree for the other study's
  vocabulary and read every hit.
- README passages explaining what was omitted and why. Explaining an omission names the thing.

Every sentence about work outside the deliverable is a question you have invited, on a record
where the answer costs time and the question was never asked.

## Iron rules

**1. Two representations, never three.** The recipient has Excel, not pandas — but the answer
is a WORKBOOK, not a CSV dump. Ship the data in the format the packaged code actually loads
(parquet is fine, and is what keeps the quickstart runnable), plus one XLSX workbook that
carries the analysis tables as tabs and recomputes every headline number from them. Do not
also ship CSV: a third copy of the same numbers is a third thing that can disagree, and the
workbook is the readable one. CSV only for a table with no workbook tab, and say why.

**2. 7z, never zip.** Zip stores mtime at two-second resolution with no timezone, so every
file's provenance is degraded on extraction — which is exactly what a production is supposed
to preserve. `p7zip` is usually not installed; `bsdtar` writes real 7-Zip and is:

```bash
bsdtar --format 7zip -cf pkg-YYYY-MM-DD.7z pkg-YYYY-MM-DD/   # one top-level folder
bsdtar -tvf pkg.7z | head                                    # verify listing
```

Round-trip a file with a known mtime and confirm it survives before shipping.

**3. MANIFEST.csv, one row per file**: relative path, bytes, sha256. Recompute every hash
against the EXTRACTED copy, not the staging tree.

**4. A provenance table in the README.** One row per figure and per headline number: the
number -> the script or function that computes it -> the input file -> that file's row
count. Read the numbers off the data; never copy them out of prose.

**5. Scan before you archive.** Grep the staged tree for API keys, tokens, `.env`, absolute
home paths, and personal names of RAs and staff. Report every hit with file and line and let
the user decide — do not silently rewrite. Never ship internal working notes (agent reports,
scratch investigations) without the user naming them.

**6. Redact by destroying pixels, never by covering them.** A box drawn over an image in the
document leaves the original embedded — `pdfimages -png out.pdf /tmp/x` extracts it intact, and a
box over text still reads out under `pdftotext`. Paint the raster before it enters the document
(`magick raw.png -fill '#fff' -draw 'rectangle x1,y1 x2,y2' out.png`), keep the raw capture outside
the package tree, and `-strip` the metadata. Solid fill only — pixelated text is recoverable over a
known font and charset, and blur is worse. **Prefer cropping to redacting**: a crop that excludes
the account data leaves no black bars and nothing for the reader to wonder about. Verify from the
artifact — extract every image and grep the text for the strings you removed.

**7. Verify from the extracted copy.** Extract to a fresh temp dir, recheck every hash,
confirm no excluded pattern leaked (`.git`, `.pixi`, `__pycache__`, `.ruff_cache`, caches, raw
corpora — a lint or test step run during staging creates these), re-run whatever regenerates the
outputs, and run the project's own linter over the staged code. Paste real commands and real
output.

**8. Trimming breaks things; gate it.** Every removal is an edit to code that was working. An
unused import, an unsorted import block, a variable loaded only for the figure you deleted, a
comment rewrite whose regex ate the newline and welded a comment onto the statement below it —
all of these have happened. So the build ends with `ruff check` (or the project's linter) over
the staged copy and an `ast.parse` of every packaged `.py`, and it refuses to archive on
failure. Never rewrite a comment with a pattern that can consume its own line break.

## Contents

Include: the source closure, the notebook or script that produces the deliverable, pinned
environment (`pixi.lock`, `requirements.txt`), the data that code loads, the workbook, the
runbook, and the figures the deliverable actually uses. Nothing else — see **Scope** above.

**Strip the internal commentary from the shipped code.** Working comments explain decisions to
the next author — abandoned approaches, who coded what and how well, drift warnings, arguments
with a previous version. In a production they are deposition material about deliberation rather
than method. Remove them from the PACKAGED copy only; keep the comments a reader needs to
follow the computation, keep every markdown/document cell (that is the study), and keep the
repo untouched. Report what was removed so the user can see the cut.

Exclude, and say why each exclusion is recoverable, but ONLY for things a reader would
otherwise expect to find and need: source corpora that are public (give the retrieval script and
the URL pattern), and anything licensed that cannot be redistributed. `.git/`, environments,
caches and export artefacts are excluded silently — nobody expects them. Work belonging to a
different analysis is excluded silently too: an exclusion note there is an advertisement.

## The workbook

When the recipient is a lawyer, a CSV dump is not enough — build an XLSX with the `xlsx`
skill: one tab per raw source, then computation tabs that reproduce the headline numbers
with LIVE Excel formulas (`COUNTIFS`, `SUMPRODUCT`) reading the raw tabs. A number the
reader can click into and see computed is auditable; a number typed into a cell is an
assertion. Zero formula errors, and the totals must equal what the code reports — check
each one against the pipeline's own output and report any that disagree.

## The runbook

Required whenever an input is NOT in the archive — public corpora you told them to re-download,
anything licensed, anything an API produced. The archive proves the analysis; the runbook proves
the data collection, and without it "the code is public" is an assertion about work nobody can
repeat.

Write it for a competent computer user who does not program:

- **Every manual step is a screenshot.** Downloading from a government site, typing an
  identifier into a lookup, creating an API key and attaching billing. Prose describing a web
  page ages worse than a picture of it and is harder to follow while doing it.
- **Every automated step is one command plus its expected output.** Row counts, file counts,
  the last log line. A step whose success the reader cannot check is a step they cannot report
  failing.
- **Expected output is counts and names, not a transcript.** Byte sizes, timings, DPI and paths
  move between correct runs — a different font resolves, a library version bumps — so publishing
  them as "what correct looks like" manufactures failures the reader then reports. State the
  invariants: how many rows, how many files, the last line. If a transcript is genuinely worth
  showing, set it as text rather than a screenshot (a picture of text cannot be copied or searched)
  and strike the volatile columns. Screenshots earn their place only where the LAYOUT is the
  instruction — finding one link among fifty on a web page.
- **Front-load the short path.** Most readers only want to know the shipped data reproduces the
  figures — that is two commands. Say so on page one and put the multi-day rebuild behind it.
- **Disclose every dependency that costs money or gates access**, with what it costs, why the
  free route does not work, and what a reader without it can still do by hand.
- **State the known non-determinism** — model outputs, PDF writers that reorder internals —
  before the reader finds a hash mismatch and concludes the numbers are wrong.
- **Close with a symptom → cause table.** The counts that legitimately drift (a re-published
  source file, advisers deregistering) versus the ones that mean something broke.

Typst → PDF. It paginates for a Bates stamp, needs no toolchain beyond `typst`, and the `.typ`
source ships in the archive as readable plain text. Not an executable-runbook app: the steps
that need explaining are the manual ones no block can run, and the deliverable cannot depend on
software the recipient must install.

## Rationalization table

| Excuse | Reality | Do instead |
|---|---|---|
| "parquet is the analysis format, they can convert it" | They cannot, and asking them to is the production's problem, not theirs | CSV + XLSX |
| "zip is universal" | It degrades every timestamp in a document production | `bsdtar --format 7zip` |
| "the hashes matched when I built it" | You verified the staging tree, not the archive anyone will open | recompute from the extracted copy |
| "the README says the figure comes from the pipeline" | A claim is not a provenance record | figure -> script -> input file -> row count |
| "the numbers are in the report already" | Copying prose into a manifest propagates whatever was wrong | read them off the data |
| "I'll drop the internal notes in, they show the work" | Working notes name people and rehearse abandoned reasoning | list them, let the user choose |
| "the code is in the package, that IS the method" | Code they cannot feed inputs to documents nothing | runbook with the acquisition steps |
| "I'll write the collection steps as prose, screenshots are fussy" | Prose about a web page rots and cannot be followed one-handed | one screenshot per manual step |
| "an executable runbook app would be slicker" | It adds an install the recipient must trust, for steps that are manual anyway | Typst → PDF, source in the archive |
| "I drew a black box over it, it's redacted" | The original image and text are still in the PDF | repaint the raster before it is embedded, then extract and check |
| "a screenshot of the terminal proves it ran" | It ships your prompt, hostname and theme, cannot be copied from, and pins byte sizes that legitimately vary | state the invariant counts instead |
| "ship the whole repo, more is safer" | More is more surface, more questions, and more work you were never asked to produce | the import closure from the deliverable's entry points |
| "the README should explain what we left out" | Explaining an omission names the thing you removed | say nothing about work outside the deliverable |
| "the alternate figure is harmless, it's just rendered" | Re-running the pipeline then produces a file the production cannot account for | delete the code that builds it too |
