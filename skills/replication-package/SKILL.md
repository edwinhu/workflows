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

**3. MANIFEST.csv, one row per file**: relative path, bytes, sha256, modified (UTC, ISO 8601).
Recompute every hash against the EXTRACTED copy, not the staging tree.

The manifest is the only durable record of the dates, and it is a record, not a proof — it is
the producing party asserting dates about its own files. No archive format restores a file's
creation date — Linux has no syscall to set one, so an extracted file's birth time is the moment
the recipient unpacked it — and modification time survives only if it was never destroyed in the
first place. **Stage verbatim copies with `cp -p`.** A plain `cp` stamps every staged file with
the second the build ran, so the archive then asserts that the whole analysis was written in one
instant; the dates that mean something are when the pipeline wrote each file. Trimmed or
rewritten files are the exception — those really were modified at staging and should say so.

**4. A provenance table in the README.** One row per figure and per headline number: the
number -> the script or function that computes it -> the input file -> that file's row
count. Read the numbers off the data; never copy them out of prose.

**5. Scan before you archive — the tree AND the compiled deliverables.** Grep the staged tree
for API keys, tokens, `.env`, absolute home paths, and personal names of RAs and staff. Report
every hit with file and line and let the user decide — do not silently rewrite. Never ship
internal working notes (agent reports, scratch investigations) without the user naming them.

Grep does not reach inside a built artifact, so check each one on its own terms. Every surface
below has shipped somebody's username in a production:

- **PDF**: `pdfinfo` for the Info dict and the XMP packet — Author, Title, Producer, Keywords.
  Then `pdftotext` the whole thing and grep the text layer for `/home/`, `/Users/`,
  `C:\Users`, the username, the hostname, any `@` address, `localhost`. A transcript pasted
  from a real run is the usual carrier.
- **XLSX / DOCX / PPTX**: `unzip -p f docProps/core.xml` (`dc:creator`, `cp:lastModifiedBy`,
  `dc:title`) and `docProps/app.xml` (`Application`, `Company`, `Manager`). Also grep the whole
  zip for absolute paths — external links and print areas store them.
- **Images**: PNG `tEXt`/`iTXt`/`zTXt`/`eXIf` chunks, JPEG EXIF. Screenshot tools write the
  capturing app, and phone photos write GPS.
- **What the screenshot SHOWS**, which no tool reports: a URL bar, a profile avatar, a tab
  strip, a signed-in account name, a home directory in a title bar. Shoot the vendor's own
  documentation page rather than your signed-in console, and crop to the element that is the
  instruction.

**Strip every field except the creation and modification dates.** Keep those two because
changing them creates a discrepancy the other side can ask about, not because they prove
anything: any party can set any date with `touch -d` or an XML edit, so a self-asserted
timestamp is worth nothing as evidence of when work was done. Do not let a manifest or a
metadata field be described as proof the files were not back-dated — see **Timestamps are not
proof** below. Everything else goes. Generator strings (`openpyxl`, `python-docx`, `Typst 0.15.0`, an
`Application` naming the OS) are not needed by the recipient and are not worth arguing about;
drop them with the rest. Report a date that is obviously not real rather than preserving it:
`python-docx` stamps every file it writes 2013-12-23, so a docx built today carries a
creation date from before the analysis existed, and the fix belongs in the build (stamp the
real date when the file is written), not in the scrub. `scripts/scrub_metadata.py` does the
strip and the reporting for PDF, OOXML and PNG; run it with `--dry-run` first and show the user
what it found.

**Scrub inside the build, not after it.** Any generator step — `typst compile`, a docx writer,
a plot export — re-stamps its output every run, so a scrub done by hand is undone by the next
build. Put it after the last generation step and before the manifest, so the hashes cover the
scrubbed bytes.

**Timestamps are not proof.** Every date discussed above — file mtime, the manifest column,
`dcterms:created`, the PDF `CreationDate` — is set by the party producing the files and can be
set to anything. They establish internal consistency, which is worth having: a package whose
dates contradict each other invites a question, and one that agrees does not. They do not
establish when the work was done, and should never be characterised that way to the client or in
a declaration.

When temporal provenance actually matters, it has to come from a party with no stake:

- **What is already in the record.** A DKIM-signed email cryptographically binds its content and
  its date, and copies sit on the sender's, the recipient's and the relay's servers. It anchors
  only what actually ARRIVED, so confirm receipt before relying on it — archive attachments are
  routinely stripped downstream, and the sent copy does not show it. A hash
  stated in a filed document is dated by the filing. These are usually the strongest anchors
  available and they cost nothing — identify them rather than building something new.
- **An RFC 3161 timestamp** over the archive's sha256, from a public TSA. `openssl ts -query` on
  the hash, submit, keep the `.tsr` token beside the archive; `openssl ts -verify` checks it
  against the TSA's certificate. It proves the hash existed by that instant, which is the exact
  claim a metadata field cannot make. The hash goes to a third party — get the user's approval
  first, and never send the file itself.
- **Not git history.** Commit dates are environment variables and rewrite freely. A push receipt
  or a CI run on a host the user does not control is different, and is worth naming.

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
- **Every automated step is one command and the output it printed**, set as a terminal block:
  the command on a `>` prompt line, its real output below. A reader who has never used a terminal
  cannot tell from prose whether a file was created *for* them or *by* them — five of the thirteen
  comments on the first ADV runbook were some form of that question, and a pasted transcript
  answers all of them at once. Set it as text, never a screenshot: a picture of a terminal cannot
  be copied or searched, and it ships your prompt, hostname and theme.
- **Name the invariants under the transcript.** Byte sizes, timings, DPI and paths move between
  correct runs — a different font resolves, a library version bumps — so a transcript published
  bare manufactures failures the reader then reports. Say which counts are the ones to read and
  tell them to ignore the rest.
- **Transcripts are trimmed, and the trimming is disclosed.** Cut the timestamp and module prefix,
  shorten long lines, elide a repetitive stretch as `...`, and say in the document that you did.
  Wrap every line to the block's width by hand — a soft-wrapped log line breaks mid-column and
  reads as corruption. Where the only complete transcript is from an older vintage, label it as
  such and give the count a run today would print; where no clean one exists (a paid API call,
  a step that only ever ran broken), leave the command bare rather than inventing output.
- **Screenshots earn their place only where the LAYOUT is the instruction** — finding one link
  among fifty on a web page.
- **Front-load the short path.** Most readers only want to know the shipped data reproduces the
  figures — that is two commands. Say so on page one and put the multi-day rebuild behind it.
- **Disclose every dependency that costs money or gates access**, with what it costs, why the
  free route does not work, and what a reader without it can still do by hand.
- **State the known non-determinism** — model outputs, PDF writers that reorder internals —
  before the reader finds a hash mismatch and concludes the numbers are wrong.
- **Close with a symptom → cause table.** The counts that legitimately drift (a re-published
  source file, advisers deregistering) versus the ones that mean something broke.

Typst → PDF. It paginates for a Bates stamp, needs no toolchain beyond `typst`, and the `.typ`
source ships in the archive as readable plain text. `assets/term.typ` is the terminal block,
with the show-rule guard that keeps a document-level `raw` rule from drawing a second box inside
it. Not an executable-runbook app: the steps
that need explaining are the manual ones no block can run, and the deliverable cannot depend on
software the recipient must install.

## Rationalization table

| Excuse | Reality | Do instead |
|---|---|---|
| "parquet is the analysis format, they can convert it" | They cannot, and asking them to is the production's problem, not theirs | CSV + XLSX |
| "zip is universal" | Its DOS timestamps round to two seconds and carry no timezone; 7zip keeps mtime to sub-second. Neither restores a creation date — nothing on Linux can set one — so the created date that matters is the one INSIDE the document, not the file's | `bsdtar --format 7zip` |
| "the hashes matched when I built it" | You verified the staging tree, not the archive anyone will open | recompute from the extracted copy |
| "the README says the figure comes from the pipeline" | A claim is not a provenance record | figure -> script -> input file -> row count |
| "the numbers are in the report already" | Copying prose into a manifest propagates whatever was wrong | read them off the data |
| "I'll drop the internal notes in, they show the work" | Working notes name people and rehearse abandoned reasoning | list them, let the user choose |
| "the code is in the package, that IS the method" | Code they cannot feed inputs to documents nothing | runbook with the acquisition steps |
| "I'll write the collection steps as prose, screenshots are fussy" | Prose about a web page rots and cannot be followed one-handed | one screenshot per manual step |
| "an executable runbook app would be slicker" | It adds an install the recipient must trust, for steps that are manual anyway | Typst → PDF, source in the archive |
| "I grepped the staged tree and it was clean" | grep does not reach into a PDF's XMP, a docx's `docProps`, or a PNG's text chunks — and reads nothing at all off what a screenshot depicts | check every built artifact on its own terms |
| "the sent folder shows it attached, so they have it" | Mail filters on either end strip archive attachments silently, and the sender's copy looks identical whether or not it landed — a 7z can leave twice and arrive never | confirm receipt explicitly; transmit productions through counsel's file-transfer service, whose receipt is also a better anchor than email |
| "rebuild it on Windows so the archive carries a creation date" | 7-Zip does store one, but it would be the date the VM's filesystem stamped the copy, and it is still the producing party setting a field on its own machine | a third-party anchor: an RFC 3161 token over the hash, or the production channel's receipt |
| "I drew a black box over it, it's redacted" | The original image and text are still in the PDF | repaint the raster before it is embedded, then extract and check |
| "a screenshot of the terminal proves it ran" | It ships your prompt, hostname and theme, and cannot be copied from | set the transcript as text, name the invariant counts |
| "describing the output in prose is cleaner than a wall of log" | A reader who cannot see the screen cannot tell what the command did, and asks whether each file is created for them or by them | real transcript in a terminal block, invariants named beneath |
| "ship the whole repo, more is safer" | More is more surface, more questions, and more work you were never asked to produce | the import closure from the deliverable's entry points |
| "the README should explain what we left out" | Explaining an omission names the thing you removed | say nothing about work outside the deliverable |
| "the alternate figure is harmless, it's just rendered" | Re-running the pipeline then produces a file the production cannot account for | delete the code that builds it too |
