# Retrieval — getting authentic opinion text into `docs/`

## Route 1 — Westlaw, first and by default

**To get a case, invoke the `workflows:westlaw` skill.** It owns the export procedure and the
`.westlaw.docx` file-naming convention; that procedure is not restated here, because a copied
procedure is a second source of truth nothing diffs.

**The `.westlaw.docx` is the ONLY stored source, and its text is a projection read IN MEMORY.**
Write no `.txt` beside it. The twins that used to sit there discarded the docx's italic runs, and
on 2026-09-10 a 27-page casebook excerpt reached a compiled reader with every case name in roman
because the cut read the projection and the projection had thrown the typography away. Persisting
it is what made the loss invisible; `check-quotes.py` now takes the docx and projects it itself,
preserving italic runs as Typst emphasis.

Westlaw's `XMLMIND_DOCX` export is **publisher-keyed text**, not OCR: the characters are the
publisher's, star pagination is present, and there is nothing to adjudicate. Measured 2026-09-09:
the Ripple excerpt reported 69 unverified sentences against OCR-corpus text and **0** against the
Westlaw extraction; Mutual Benefits verified with 0 misses against both.

The user is credentialed. Use this route unless one of the two fallback conditions below holds.

## Route 2 — the free corpora, when Westlaw cannot serve

Two conditions, and only these two:

- **Westlaw does not cover the case** — an unreported district-court order, a docket entry, a
  filing. Take the **RECAP docket-entry route** (federal only).
- **No Westlaw credential is available** on this machine or in this session. Take the
  **CourtListener opinions corpus** by citation (federal and state), falling back to RECAP.

Route corpus questions through the `workflows:courtlistener` skill; do the fetch with
`scripts/fetch-opinion.sh`. Everything from here to the end of this file is the fallback path,
including the OCR-correction apparatus and the Gemini routing rule.

```bash
S="${CLAUDE_SKILL_DIR}/scripts"

# RECAP docket-entry route (federal only) — the reliable one
"$S/fetch-opinion.sh" --docket "1:20-cv-10832" --court nysd --entry 874 \
  --out docs/SEC-v-Ripple-874-opinion

# Opinions-corpus route by citation
"$S/fetch-opinion.sh" --citation "87 F.3d 536" \
  --out docs/SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996
```

**Naming** follows the files already in `docs/`:
`SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996` for a citation retrieval,
`SEC-v-Ripple-874-opinion` for a docket entry.

Both `.pdf` and `.txt` are saved: the `.txt` is what the elision reads, the `.pdf` is the
provenance record and the tiebreak on any doubtful character.

**THIS ROUTE CANNOT CARRY ITALICS, AND THAT IS A PROPERTY OF THE SOURCE, NOT OF THE TOOLING.** A
court PDF is positioned glyphs with no formatting layer, so `pdftotext` has no italic run to
report and no later step can recover one. A reading cut from a `.txt` therefore has its emphasis
verified by nothing, and `check.sh` prints a loud **ITALICS NOT CHECKED** line naming that reading
rather than passing silently. It is not a failure — Westlaw does not carry every case, and on
2026-09-10 an expired Westlaw session sent a retrieval down this path — but it is never to be read
as a clean verdict on the excerpt's typography.

**Gate:** both `docs/<name>.pdf` and `docs/<name>.txt` exist and are non-empty, and the
`.txt` contains the case caption. The script prints all three; paste its output.

## Which corpus

- **The opinions corpus is federal and state; RECAP is federal only.** Try opinions first;
  fall back to RECAP.

## The storage-bucket path — the one PDF URL that works

**The verified path to a RECAP PDF is `https://storage.courtlistener.com/<filepath_local>`**,
where `filepath_local` comes from a `type=r` search result's `recap_documents[].filepath_local`
(verified 2026-09-09; it is what `fetch-opinion.sh` uses). Nothing else in the API response is
a usable PDF URL: the opinions-corpus `download_url` points at `bulk.resource.org`, which no
longer resolves, and `/opinions/{id}/` is token-gated. When a fetch has to be done by hand,
that is the two-step: search `type=r` for the docket and entry, read `filepath_local`, join it
to the bucket host.

## A 404 is a corpus fact, not a case fact

**A citation lookup that 404s or returns nothing means "not in the opinion corpus", not
"the case does not exist."**

Verified 2026-09-09: `682 F. Supp. 3d 308` (Ripple) is absent from the opinions corpus, and
a bare search on that cite returns *Coinbase v. SEC* — a confident wrong answer. The answer
is the RECAP docket-entry route.

Treating the 404 as a dead end is precisely what sends people back to a TM summary and into
the first Iron Law (`authenticity.md`).

## Token gating

**`/api/rest/v4/opinions/{id}/` is token-gated.** Unauthenticated it answers
`401 {"detail":"Authentication credentials were not provided."}`, and the search result's
`download_url` points at `bulk.resource.org`, which no longer resolves (verified
2026-09-09). The `search` endpoint itself needs no token.

So an opinions-corpus hit may be **findable and not fetchable**: set
`COURTLISTENER_TOKEN`, or use RECAP. The token page sits behind a human-verification
interstitial — the user clears it, not you.

## How to tell a clean source — a Route 2 step

**Scope: the fallback path.** A Westlaw source is the `.westlaw.docx` itself, projected to text in
memory by `workflows:westlaw`'s extractor, so its provenance is the publisher, the reproduction
check is re-running the projection, and there is nothing to adjudicate. Skip this section for a
Westlaw source.

Before cutting a single sentence from a corpus source, look at the `.txt` you just retrieved. Two cheap
measurements settle provenance:

```bash
F=docs/<name>.txt
grep -c '[^[:space:]]' "$F"                 # non-empty lines
awk 'length>0{print length}' "$F" | sort -n # eyeball the median line length
sed -n '50,70p' "$F"                        # read a real passage
```

- **A clean single-column source** has a stable median line length in the 70–90 range and
  reads as connected prose when you print twenty consecutive lines. The Mutual Benefits
  `.txt` in `docs/` is exactly this: ~375 non-empty lines (374 by `grep -c`), median line
  length 81.
- **Double-spacing is normal and is not damage.** Many retrieved `.txt` files put prose on
  alternating lines with blank lines between. That is a formatting property of the file, not
  a corruption — but it is the property that makes *line decimation* possible downstream.
  See `verification.md`.
- **OCR damage is the real hazard, and it survives every grep.** Look for impossible words
  and stray punctuation: `'rue` for `true`, `Junctions` for `Functions`, `and .the`. A grep
  against the `.txt` proves fidelity to the file, not to the reporter — and **the tell in
  *A scanned source is a Gemini job* below is what predicts when that gap matters.** An
  OCR-damaged `.txt` matches its own damage perfectly: `check-quotes.py` verified all three
  Life Partners errors as verbatim, because against that file they are.
- **Prefer the slip opinion (single column) when both are available.** If only a two-column
  source exists, `pdftotext` WITHOUT `-layout` often de-interleaves it — check the output
  before cutting.

**Never trust a corruption tell you have not grepped for in BOTH files** — the source and
the excerpt. Asserting a tell from the shape of the prose, without measuring it, is how a
false diagnosis gets written down as a fact and repeated. See `verification.md` for the
case where exactly that happened.

## When to run on Gemini — two reasons, and they are the whole list

**A scanned source, or a filter-tripping subject.** Both route the same way:
`farm.sh --tasks <file> --provider gemini`. Reason 1 arises only on Route 2; Reason 2 arises on
either route, since the filter reacts to the subject matter, not the source.

### Reason 1 — a Route 2 source that needs OCR is a Gemini job

Measured 2026-09-09 across the four retrieved sources in `docs/`:

| case | year | route | PDF? | OCR damage |
|---|---|---|---|---|
| SEC v. Ripple | 2023 | RECAP | yes | 0 |
| SEC v. Terraform | 2023 | RECAP | yes | 0 |
| SEC v. Mutual Benefits | 2005 | RECAP | yes | 0 |
| SEC v. Life Partners | 1996 | opinions corpus | NO | 3 |

The correlation is exact and the mechanism is simple. A case filed electronically on PACER
has a **born-digital PDF**: `pdftotext` reads the character codes the court's word processor
emitted and no OCR runs anywhere in the pipeline. A case predating electronic filing has no
such PDF; the opinions corpus hands back **text rather than a PDF**, and for those older
cases that text is a reporter-page scan OCR-d years ago upstream. The damage is baked in
before we touch it.

**THE TELL, so the next run predicts this instead of discovering it:** an opinions-corpus
retrieval that yields a `.txt` and **no** `.pdf`, whose text carries CourtListener's own
opinion-object separators — lines beginning `=== `, e.g.
`=== majority | GINSBURG, Circuit Judge: ===`. Those are not `pdftotext` output; they mark
corpus text. Classic OCR signatures confirm it: `is 'rue` for `is true`,
`Entrepreneurial Junctions` for `Functions`, `{per curiam)` for `(per curiam)`, `and .the`
for `and the`. All four are in the Life Partners `.txt` today and all four reached print in
`02-addendum`.

**WHAT TO DO.** Do not accept OCR text as the source of record for a retained quotation. Try
Route 1 first — a Westlaw export of the same case ends the problem instead of correcting it, and
this whole scan-and-transcribe apparatus is unnecessary work where Westlaw has coverage. Where it
does not, obtain the **page images** (the reporter PDF or a scan) and farm the transcription to Gemini,
which is natively multimodal and reads the page image directly rather than relying on an OCR
engine's glyph-by-glyph guesses — precisely the failure that produced `'rue`.

**WHERE THE PAGE IMAGES ARE.** The Caselaw Access Project serves Harvard-scanned reporter
volumes as static files, no auth, at `static.case.law`. The per-case PDF path derives from
the citation:

```
https://static.case.law/<reporter>/<volume>/case-pdfs/<first-page>-<ordinal>.pdf
```

For 87 F.3d 536: `f3d/87/case-pdfs/0536-01.pdf` — page zero-padded to four digits, `-01` for
the first case beginning on that page. Companions: `<reporter>/<volume>/CasesMetadata.json`
lists every case in the volume with its `file_name`, which resolves the ordinal when several
cases share a starting page; `<reporter>/VolumesMetadata.json` lists volumes;
`<reporter>/<volume>/cases/<file_name>.json` is the case record.

**Switching text corpora fixes nothing.** Measured 2026-09-09: CAP's JSON text and
CourtListener's opinions-corpus text for 87 F.3d 536 carry byte-identical OCR damage —
`is rue`, `Junctions`, `{per curiam)`, one each, zero clean forms. Both descend from the same
Harvard scan (the case record says `provenance.source` Harvard, batch 2018). What CAP adds is
the **scan itself**, which is the input this route needs.

**Hand the PDF to Gemini directly.** Do not `pdftotext` it, do not pre-OCR it. Gemini reads
the document natively; whether the PDF carries a text layer is irrelevant, and if it does,
that layer holds the very errors being corrected.

**Worked result.** Run on this scan, Gemini returned all three corrected passages with
reporter page numbers (545, 546, 547) and a physical cause for each artifact: the `t` in
`true` lost its stem to poor ink transfer and read as an apostrophe; `f`+`u` in `functions`
bled together into a `J`; paper noise between `and` and `the` became a period.

**And the caution.** The reviewer had assumed `Junctions` corrected to `Functions`. The
reporter prints `Entrepreneurial functions, pre-purchase.` — lowercase, italicised. Repairing
from context would have swapped one wrong word for another, and it would have read perfectly.

**Also ask Gemini for the hazard list.** A transcription request should ask what else on
those pages would OCR badly, because the dangerous error is the one producing a real word — a
dropped negation, a wrong digit in a pincite — which a human read and `check-quotes.py` both
certify, since against the damaged file they are verbatim. On this scan that surfaced a severe
print defect in `promoters` at 547 rendering as `the l mot- / ers`.

**Never repair a suspected OCR error from context alone.** Correcting `'rue` to `true`
happens to be safe; the same reflex applied to a word the court actually wrote is fabrication
wearing a proofreader's hat. Correct only against the page image or the reporter, or leave it
and flag it.

### Reason 2 — content-filter failure and recovery

Sensitive-but-ordinary legal subject matter — terminal illness, sexual offences, violence,
self-harm, the ordinary facts of reported cases — can trip the provider content filter. Two
attempts at the viatical-settlement cases (Life Partners / Mutual Benefits) died on the
proxy's Claude path with `API Error: Output blocked by content filtering policy`; the same
task succeeded on `--provider gemini`. The subject matter is not the problem, the filter is;
do not narrow the excerpt to appease it.

**The failure leaves PARTIAL STATE.** Each death was mid-write: no finished artifact and a
half-edited `.typ` on disk. Recovery starts by reading what actually landed:

```bash
cd /home/eh/areas/secreg && git status && git diff -- addenda/
pdfinfo "output/addenda/<latest>.pdf" | grep Pages
```

Re-running the elision on top of a half-edited file is exactly how a four-row table ends up
over a two-reading body. Read first, then re-run the elision on a different provider — under
`workflows:farm-out`, that is a row with a different `provider`; the dispatch mechanics
belong to farm-out.
