---
name: replication-package
description: "ALWAYS use when code and data have to leave the machine as a self-contained archive for someone who did not write them — 'build the replication package', 'package this for counsel', 'send the workpapers', 'production archive for the opposing expert', 'replication archive', 'they want the code and data', 'put together what they asked for in the document request', 'make a workbook for the client', 'archive this analysis so someone else can check it'. Use proactively whenever an expert report, a submission or a document request implies handing over the underlying work, even when the user only says 'zip it up'. NEGATIVE ROUTING: building the analysis itself goes to `ds`; a Word deliverable goes to `law-review-docx` or `docx-typst`; a single spreadsheet with no archive around it is plain `xlsx`."
user-invocable: true
---

# Replication package

A production is read by a lawyer on Windows, not by you on Linux. Everything below
follows from that.

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

**6. Verify from the extracted copy.** Extract to a fresh temp dir, recheck every hash,
confirm no excluded pattern leaked (`.git`, `.pixi`, `__pycache__`, caches, raw corpora),
and re-run whatever regenerates the outputs. Paste real commands and real output.

## Contents

Include: source, the notebook or script that produces the deliverable, pinned environment
(`pixi.lock`, `requirements.txt`), the data the code loads, the workbook, the figure files,
the exhibit document, and method documentation.

**Strip the internal commentary from the shipped code.** Working comments explain decisions to
the next author — abandoned approaches, who coded what and how well, drift warnings, arguments
with a previous version. In a production they are deposition material about deliberation rather
than method. Remove them from the PACKAGED copy only; keep the comments a reader needs to
follow the computation, keep every markdown/document cell (that is the study), and keep the
repo untouched. Report what was removed so the user can see the cut.

Exclude, and say WHY each exclusion is recoverable: source corpora that are public
(give the retrieval script and the URL pattern), anything licensed that cannot be
redistributed, `.git/`, environments, caches, generated export artefacts.

## The workbook

When the recipient is a lawyer, a CSV dump is not enough — build an XLSX with the `xlsx`
skill: one tab per raw source, then computation tabs that reproduce the headline numbers
with LIVE Excel formulas (`COUNTIFS`, `SUMPRODUCT`) reading the raw tabs. A number the
reader can click into and see computed is auditable; a number typed into a cell is an
assertion. Zero formula errors, and the totals must equal what the code reports — check
each one against the pipeline's own output and report any that disagree.

## Rationalization table

| Excuse | Reality | Do instead |
|---|---|---|
| "parquet is the analysis format, they can convert it" | They cannot, and asking them to is the production's problem, not theirs | CSV + XLSX |
| "zip is universal" | It degrades every timestamp in a document production | `bsdtar --format 7zip` |
| "the hashes matched when I built it" | You verified the staging tree, not the archive anyone will open | recompute from the extracted copy |
| "the README says the figure comes from the pipeline" | A claim is not a provenance record | figure -> script -> input file -> row count |
| "the numbers are in the report already" | Copying prose into a manifest propagates whatever was wrong | read them off the data |
| "I'll drop the internal notes in, they show the work" | Working notes name people and rehearse abandoned reasoning | list them, let the user choose |
