---
name: westlaw
description: "Use when the user says 'get this case from Westlaw', 'export the case as Word', 'download the opinion', 'pull 87 F.3d 536', 'I need the Westlaw version', 'get me the real text of this case', or 'the OCR is garbled, get the publisher text'. NEGATIVE ROUTING: excerpting an opinion already in hand into a course reading is teaching:elide-case; free case law with no subscription is workflows:courtlistener. This skill only retrieves and exports from Westlaw."
---

# Westlaw: retrieve a case as publisher-keyed DOCX

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

Export an opinion from Westlaw Advantage as DOCX with star pagination, for use as the
authoritative source text when excerpting. Feeds `teaching:elide-case`, whose first Iron Law
requires authentic reporter text.

Everything below was measured 2026-09-09 in a live session against Westlaw Advantage, signed in as
a UVA law faculty account.

## Prerequisite

The user's own logged-in Chromium on CDP port 9222. Linux → `mcp__chrome-devtools__*`. **Load the
`browser-automation` skill first** — it owns port and prefix selection. This drives the user's real
session; there is no credential handling and nothing to store.

LexisNexis (Lexis+ with Protégé) publishes no MCP server as of 2026-09, and Thomson Reuters'
CoCounsel connector returns synthesized research reports with citation links, not verbatim case
text (and needs a CoCounsel package subscription) — neither replaces this browser route.

## Step 0 — session preflight

Confirm the browser session is still signed in before driving it; an expired login presents as a
missing selector or a stalled delivery queue several steps later. On any Westlaw tab, evaluate:

```js
const r = await fetch('/V1/Delivery/Details?timeZoneId=Eastern%20Standard%20Time',
                      {credentials:'same-origin', redirect:'follow'});
const ct = r.headers.get('content-type') || '';
const body = await r.text();
JSON.stringify({status:r.status, host:new URL(r.url).host, ct, ok:(()=>{try{JSON.parse(body);return true}catch{return false}})()});
```

**PASS only on:** `status` 200 AND `ct` contains `application/json` AND the body parses as JSON AND
`host` is `1.next.westlaw.com`. Measured on a signed-in session: 200, `application/json;
charset=utf-8`, body begins `{"PollingIntervalInMilliseconds":0,"DeliveryQueueItems":[{"F`. This is
the same endpoint Step 5 polls, so it tests the capability the run needs.

Anything else — non-200, non-JSON content type, unparseable body, another final host, or a thrown
fetch — is NOT SIGNED IN. **STOP and tell the user to sign in to Westlaw in his own browser and
re-run.** Never attempt a login, fill a credential field, or touch a saved password; this skill
handles no credentials and Step 0 is not the exception.

**There is no DOM fallback: the API probe is the only session check.** Measured on one live
signed-in session, same browser, same moment: on `/Document/…/View/FullText.html` (case viewer)
`#coid_website_signOffRegion` → 1 and `#co_signOffContainer` → 1; on `/Advantage/Home` both → 0,
while the API probe passed on that same page (200, `application/json; charset=utf-8`, parseable,
`redirected:false`) and its visible text read "… Client: HU EDWIN Help Profile Sign out …". Those
IDs therefore indicate **which page is loaded**, not whether the session is live, and using them
yields a false "not signed in" — the same false-negative class already noted for
`#coid_website_userMenu`, `#co_signOffLink`, `a[href*="SignOff"]`, `#coid_headerLinks` and
`.co_user` (all measured absent while signed in). The only signal present on both tabs was the
page's own visible text containing "Sign out"; it is not carried here, because user-visible copy
Thomson Reuters can reword is too weak to sit beside the probe and must never override it.

The signed-out response shape is UNVERIFIED (never observed, since testing it means signing the user
out) — hence the fail-closed condition above; observing it once would allow a more specific message.

## Step 1 — find the case

Citation search navigates **directly to the document**; there is no results page to parse. Type the
citation into the main search box and submit, or navigate:

```
https://1.next.westlaw.com/Document/<docGuid>/View/FullText.html?userEnteredCitation=87+F.3d+536
```

Westlaw resolves the cite to its own docGuid server-side. Confirm by reading `document.title`,
which carries the case name. Measured: `87 F.3d 536` landed on
`I18e36046930e11d9bc61beebb95be672` / "S.E.C. v. Life Partners, Inc.".

**The jurisdiction filter does not affect a citation lookup but DOES silently narrow a term
search.** A term search returning nothing when the case plainly exists is usually the filter, not
the corpus.

## Step 2 — delivery dialog and the client-ID gate

| element | is |
|---|---|
| `#deliveryLinkButton1` | opens "Download This Document" |
| `#deliveryWidgetButton1` | "Delivery Options" |
| `a.co_blobLink.Athens-Document-Caption-pdfbutton` | "Download original image (PDF)" — direct blob URL to the **reporter page scan**, no dialog, no client ID |

**Clicking Download raises a "Select a client ID" modal whose own container renders EMPTY** (only a
close button). Its real control lives elsewhere in the DOM as `#co_clientID_recent_0`, labelled
with the user's client ID. Searching only inside the dialog node finds nothing and looks like a
broken page. Click `#co_clientID_recent_0`; the download dialog appears behind it.

The client ID is billing/matter attribution — for a law faculty account, typically the user's own
name. **Never select one the user has not named.** Attribution is theirs, not yours.

## Step 3 — format and layout

| element | set to |
|---|---|
| `#co_delivery_format_fulltext` | `<select>` → option "Microsoft Word (.docx)", value `XMLMIND_DOCX` |
| `#coid_chkDdcLayoutUseDualColumnsForCases` | UNCHECK |
| `#coid_chkDdcLayoutIncludeHeadnotes` | UNCHECK — West headnotes are editorial, not the court's words |
| `#coid_chkDdcLayoutInlineKeyCiteFlags` | UNCHECK — KeyCite markup pollutes verbatim matching |
| `#coid_chkDdcLayoutOriginalImageLink` | CHECK — embeds a pointer to the page scan |
| `#co_delivery_FullText` | radio, already checked = full text |
| `#co_delivery_StarPageRanges` | star pagination |

**DOCX, not PDF, and the reason is not preference.** A DOCX carries text in document order, so
there is no layout to misread. A PDF is positioned glyphs: extracting it means re-deriving reading
order — the exact failure that corrupted a two-column reporter page into
`The investors here relied on MBC to / are instructed to apply by Howey`, fused text no court wrote,
which read plausibly and reached print. Choosing PDF re-selects that bug.

RTF is the fallback if DOCX parsing misbehaves: plain text, diffable, lossier on structure. Legacy
`.doc` (OLE) and WordPerfect have no upside; Excel (CSV) is list export only.

## Step 4 — submit

```
#co_deliveryDownloadButton    input[type=button].co_primaryBtn.co_delivery_submitButton
```

**This button is NOT inside the dialog node.** Enumerating the dialog's children yields only tabs,
checkboxes and Cancel, and the only element labelled "Download" there is `#deliveryLinkButton1` —
the toolbar button that OPENED the dialog. Clicking that re-opens instead of submitting. Search the
document, not the dialog.

## Step 5 — the delivery is a QUEUED JOB

Measured request sequence after submit:

```
POST /V2/Delivery/InitiateDelivery
POST /V2/Delivery/CompleteDeliveryInitialization
GET  /V1/Delivery/Status/{transactionId}        (polled)
GET  /V1/Delivery/Details?timeZoneId=...        -> the queue record
```

`/V1/Delivery/Details` returns JSON: `FileName`, `FileSize`, `DeliveryFormat`, `ProgressStatus`,
`TransactionId`, `DeliveryId`, `ExpireDate`, `DownloadCount`. Wait for `ProgressStatus`
`"Completed"` and `ErrorDescription` `"Success"`.

**No request in that sequence returns the .docx body.** The file sits in Westlaw's delivery queue
until retrieved, expires at midnight the same day, and `DownloadCount` stays 0 until then.

**DO NOT GUESS THE RETRIEVAL ENDPOINT.** Six plausible URLs built from `DeliveryId` and
`TransactionId` — `/V1/Delivery/Download/{id}`, `/GetDocument/`, `/Retrieve/`, `/V2/...`,
query-string forms — ALL returned 404. The retrieval trigger is JS-bound with **no href** in the
DOM: the queue item is `li#0_qitem > a.co_deliveryQueue_item`, `href="javascript:void(0);"`. Open
the queue with `#dq_msgbar_button` and click that anchor. Guessing endpoints wastes calls and
teaches nothing; reading the UI found it immediately.

The click triggers a normal browser download into the user's Downloads directory. Move it from
there; nothing in the page hands you bytes.

## Step 6 — project the text (in memory; do NOT write a `.txt`)

**Westlaw's `XMLMIND_DOCX` uses a FLAT OPC layout, and it breaks standard tooling.** The parts sit
at the package **root** — `document.xml`, `footnotes.xml`, `header1.xml` — not under `word/`. It is
a valid zip and Word opens it, but python-docx and most libraries hardcode `word/document.xml` and
raise on open. Measured: 13 parts, no `word/` prefix anywhere.

**The docx is the only artifact this skill stores.** `scripts/westlaw-docx-text.py` is a
**projection**, not an export step: consumers import `project(path)` and read the text in memory.
A `.txt` written beside the docx is a second copy of the same opinion that nothing diffs — and the
one this skill used to write **discarded the docx's italic runs**, so a case name the court set in
italics reached a 27-page compiled casebook excerpt in roman, because the cut read only the
projection. Persisting the projection is what made that undetectable.

```bash
# For eyeballing only. -o writes a file, which is not how a consumer reads this.
scripts/westlaw-docx-text.py <in.docx>
```

Reads `document.xml` from the zip root (falling back to `word/document.xml` so a normal docx also
works, and saying which layout it found), walks `<w:r>` runs inside each `<w:p>`, **wraps every run
carrying `<w:i/>` in Typst emphasis (`_..._`)**, unescapes entities, drops empties, and reports
paragraph count, character count, emphasis spans and star-page markers to stderr. Emphasis is on by
default; `--no-emphasis` reproduces the old flat read for diffing and is not a source to cut from.
Measured:

| export | docx | paragraphs | chars | markers |
|---|---|---|---|---|
| SEC v. Life Partners, 87 F.3d 536 | 50,078 B | 138 | 90,972 | 42 |
| SEC v. Ripple, 682 F. Supp. 3d 308 | 49,381 B | 202 | 76,239 | 22 |
| SEC v. Mutual Benefits, 408 F.3d 737 | 22,314 B | 78 | 27,130 | 8 |

All three are flat OPC, 13 parts. **Those counts are the `--no-emphasis` read** — the default
emphasis read is longer by two characters per span, so a character count that does not match this
table is the emphasis marks, not damage. Measured 2026-09-10 on Tornetta v. Musk (253,642 B, 2,467
paragraphs, 234 markers): 369,296 chars flat, 371,130 with emphasis, **917 spans** — including 19
`_Weinberger_` and one `_MFW_`, every one of which the persisted `.txt` had discarded.

## Naming and layout of a retrieved case

Per case, in the consumer's `docs/`:

```
<Case-slug>.westlaw.docx   the export, byte-for-byte as Westlaw delivered it — the ONLY artifact
```

Slug is party-v-party, volume, reporter, court, year:
`SEC-v-Ripple-682-FSupp3d-308-SDNY-2023`.

**One file per case. Write no `.txt` twin.** The projection is regenerable at any time from the
docx, which is what makes storing it pointless and losing its italics to it possible. A Westlaw
source needs no corrections ledger either: the reproduction check is re-running the projection.

## Star pagination

Markers appear inline, mid-sentence, immediately before the first word of the new reporter page.
A case reported in two reporters carries **two interleaved series, and the parallel one takes a
DOUBLE asterisk** — measured in Life Partners, 21 `*537`-style markers for 87 F.3d alternating with
21 `**304`-style markers for 318 U.S.App.D.C.:

```
the direction of its former president and current chairman *538 **304 Brian Pardo, arranges these
```

Strip with `\*\*?\d+`; a `\*\d+` pattern matches inside `**304` and leaves a stray asterisk, and
counts the two series as one (which is why the extractor reports 42, not 21 + 21).

Both uses are real. A consumer matching quoted text against the extraction must strip markers
first. A consumer that wants to PRINT star pages has them available and should not strip.

## Coverage

Westlaw is the best available source, **not ground truth** — it is one publisher's keying of the
reporter page, not the page itself. This does not eliminate the need to eyeball retained passages
against a page image where one exists (Step 2's original-image PDF is that image).

## Why publisher text, stated once

The free corpora are not independent. CourtListener's opinion text and the Caselaw Access Project's
JSON for 87 F.3d 536 carry **byte-identical OCR damage** (`is 'rue`, `Junctions`, `{per curiam)`),
because both descend from the same Harvard scan. Two OCR engines — CAP's and a blinded tesseract at
400dpi — both failed on the damaged `t` in `true`. The Westlaw DOCX resolved all three passages
correctly, including `Entrepreneurial functions` (lowercase, which a context-based guess got wrong
as `Functions`). Publisher-keyed text is not a marginal improvement over OCR here; it is the
difference between a reading and a reconstruction.

Record provenance as `westlaw-docx`. Westlaw with star pagination is what legal academics actually
cite — a legitimate source of record, not a stand-in for the bound volume.

## Red flags — STOP

| About to | Do instead |
|---|---|
| Debug a missing selector or a stalled delivery queue | Run Step 0 first — an expired session presents as a broken page |
| Export as PDF because it "looks like the reporter" | DOCX — PDF re-introduces layout extraction, the bug that fused two columns into text no court wrote. Use the original-image PDF only as the SCAN record |
| Guess a delivery retrieval URL from `DeliveryId` | Read the UI — six guessed endpoints all 404'd; the trigger is a JS-bound queue item |
| Open the export with python-docx | Flat OPC — read `document.xml` from the zip ROOT |
| Write a `.westlaw.txt` beside the docx | The projection is in memory. A stored twin drops the court's italics and nothing diffs it back |
| Reach for the CourtListener/RECAP route while Westlaw covers the case | That route yields a court PDF with **no formatting layer**, so italics cannot be recovered from it at all. It stays, for cases Westlaw lacks and for an expired session, and a consumer on it must say italics went unchecked |
| Pick a client ID to get past the modal | That is billing attribution; ask the user |
| Look for the submit button inside the dialog | It is outside; the in-dialog "Download" re-opens the dialog |
| Leave headnotes or KeyCite flags in the export | West editorial matter is not the court's words and breaks verbatim matching |

## Related

- `teaching:elide-case` — excerpting the retrieved opinion into a course reading
- `courtlistener` — free case law when no subscription text is required
- `browser-automation` — owns the CDP port and tool prefix
- `lexis` — deliberate stub; Lexis retrieval is not implemented, and it routes back here
