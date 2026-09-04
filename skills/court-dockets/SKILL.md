---
name: court-dockets
description: This skill should be used when the user asks to "get the complaint PDFs", "harvest court documents", "pull the docket", "download the opinions", "get filings from Lex Machina", "Docket Alarm", "Bloomberg Law docket", "Delaware Chancery filings", "who filed this case", or needs court filings, docket entries or written decisions out of a commercial legal database.
---

# Court dockets: retrieving filings from Lex Machina, Docket Alarm and Bloomberg Law

Three commercial platforms, one job: turn a list of cases into a directory of PDFs plus a manifest
you can defend. Verified end to end on 1,597 Delaware Chancery cases, 2026-08-30/31 — ~4,000
documents retrieved across all three.

**Auth is the user's live browser session on CDP 9222.** None of these needs a password. Read the
cookie with `scripts/lm_cookie.py`; never log in, and never touch stored credentials unless the
user explicitly says to.

Full endpoint chains, request/response shapes and per-vendor quirks:
`${CLAUDE_SKILL_DIR}/references/endpoints.md` — read it before writing any fetch code.

## The scripts are the interface

Do not hand-roll a harvester. These are working, resumable and manifest-writing:

| script | does |
|---|---|
| `scripts/lm_cookie.py` | reads the live session cookie for any host over CDP |
| `scripts/harvest_complaints.py` | Lex Machina: docket-search → tag-257 complaint → signed PDF |
| `scripts/da_grab.py` | Docket Alarm: serial, boring, survives hanging documents |
| `scripts/fetch_opinion_pdfs.py` | opinion/decision PDFs from a plan parquet |

Copy them into the project and adapt. Rewriting from the reference doc reproduces bugs that took
hours to find.

<EXTREMELY-IMPORTANT>
## The Iron Law of Identification vs Retrieval

**A document that is IDENTIFIED is not a document that is RETRIEVED. Never mark a substitute `ok`.**

Every vendor names the complaint far more often than it serves the file. Measured on the same
1,597 cases: Lex identified 99.6% and served 81.0%; Docket Alarm identified 96.4% and served
81.7%. A fallback that takes "the first document that has a file" silently returns a Rule 5.1
certification, a cover letter or a verification page — and reports success.

Conflating the two overstates coverage by 15-20 points. That is not a rounding error: it is a
fabricated denominator under every downstream rate, and shipping it is more harmful than
returning nothing, because nobody downstream can see it happened.
</EXTREMELY-IMPORTANT>

<EXTREMELY-IMPORTANT>
## The Iron Law of Absence

**Never record a document as unavailable because YOUR SELECTION RULE failed. Enumerate the docket
entries and look for a later substantive version before concluding it is not public.**

This is the mirror of the law above. That one catches substitutes passed off as complaints; this
one catches real complaints recorded as absent — and it is the more expensive failure, because a
substitute is visible in the data while an absence looks like a fact about the world.

**Delaware Chancery files the complaint confidentially, then files a redacted PUBLIC VERSION days
later as a SEPARATE docket entry** (Ct. Ch. R. 5.1). Every vendor rule that stops at the first
complaint-tagged entry sees no document and reports failure. The public version sits **typically
around entry 10-15, measured as deep as entry 91**, on dockets running to 277 entries.

Measured 2026-08-31/09-01 on two independent Delaware populations:

| population | "unavailable" cases | had a public version | rate |
|---|---:|---:|---:|
| DGCL 220 complaints | 253 | 229 | **90.5%** |
| fiduciary-duty follow-on suits | 80 | 73 | **91.2%** |

Recovering them moved coverage **82.2% -> 95.3%** and added **195 confirmed cases** to a study
population. The pre-recovery write-up asserted "~18% of complaints are not publicly retrievable —
a finding about practice, not a collection defect." That sentence was wrong in both halves.

**The correct statement is "~18% are filed confidentially, and ~90% of those are publicly
available as a redacted version elsewhere on the same docket." Genuine unavailability is ~4%.**

### Two defects that bite while recovering them

- **Match the public version to a COMPLAINT, not to any document mentioning one.** `Public Version
  of Answer to Verified Complaint` and `Motion to Extend Deadline to File Public Version of the
  Verified Complaint` both contain "public version" and "complaint". Requiring only those two terms
  returned the wrong document on **10.6% (23/218) and 10.0% (7/73)** of cases across two
  populations — a stable rate, so expect it. Exclude `answer|affirmative defense|motion|letter|
  certificat|opposition|brief|reply|response|stipulation|notice|transcript|order`.
- **A resume guard keyed on filename alone silently preserves a known-bad file.** After fixing the
  regex, the re-fetch skipped every corrected case as `already_present`, because the wrong document
  from the first pass sat on disk under the same name. Quarantine before re-fetching.

**Redaction does not degrade extraction.** Measured on the recovered set: `misconduct_category`,
`plaintiff_law_firm` and `requester_type` all came back at **0% missing**, identical to the
unredacted baseline. Captions, parties, statutory citations, prayer for relief and signature
blocks survive; body allegations may be blacked out. Carry a `source` flag and check the
`not_stated` rate before using them for content coding.
</EXTREMELY-IMPORTANT>

## Vendor facts

- **Lex Machina lists the complaint with an empty `files[]` on ~18.7% of cases** (298/1,597) —
  which means it was filed confidentially, NOT that it is unavailable; see the Iron Law of
  Absence above. The
  document id and title are present; only the file is withheld. That is `file_withheld`, a
  recoverable fact worth recording — not "not found", and not a reason to substitute another
  document.
- **Docket Alarm returns HTTP 500 with a ~40 KB HTML body when it does not hold the file.** It is
  reproducible on a fresh cookie and never recovers, so retrying it is pure waste; at a ~15%
  failure rate the retry backoff was the dominant cost of a run until it was removed.
- **Some Docket Alarm documents never respond at all.** One hanging request plus a 300 s timeout
  plus an ordered `ThreadPoolExecutor.map` is indistinguishable from a deadlocked process. Use a
  45-90 s timeout.
- **Bloomberg's `accessToken` is HttpOnly with an ~8 minute TTL**, refreshed by the page's own SPA
  on a timer — not by your requests. The tab must stay open; a cookie snapshot into any external
  store authenticates for minutes, not hours.
- **Bloomberg's CSV export silently truncates at 1,000 rows** — no warning in the file or the UI.
  Always cross-check an export against the API's own `remote_count` and date-slice below the cap.
- **Docket Alarm's search endpoint is bot-protected: HTTP 400 outside the browser**, 200 via
  same-origin `fetch()` in a logged-in tab. Per-docket pages are fine outside. Do not fight it.
- **~18% of Delaware Chancery §220 complaints are unavailable from all three vendors**, and they
  fail on the *same* cases — adding two vendors to the best single one bought 17 cases out of
  1,597. If coverage stalls near 82%, that is the record, not your pipeline.

## Finding decisions in a docket

- **The docket line names the DOCUMENT, not the holding.** Entries read `Memorandum Opinion`; the
  grant/deny is inside the PDF. Only ~15/152 opinion entries mention an outcome word at all.
- **Chancery disposes of cases through a Magistrate's Final Report**, then an order implementing
  it: `Granted ([Proposed] Order Implementing the Court's Post-Trial Bench Ruling)`. Searching only
  for `Memorandum Opinion` / `Letter Decision` **missed 34% of cases with a decision** (169 found
  vs 257 that exist). Always include: `final report`, `master's report`, `post-trial ruling`,
  `bench ruling`, `opinion and order`, `final order and judgment`.
- **Never search for opinions only within cases you already classified as having one.** That is
  circular and it hides exactly the misclassifications you are trying to find. Scan the whole
  population.

## Red Flags — STOP If You Catch Yourself:

| About to | Why wrong | Do instead |
|---|---|---|
| About to record a complaint as unavailable because the first entry has no file | The Rule 5.1 public version sits further down the docket ~90% of the time | Enumerate the entries and search for a later substantive version |
| Matching a public version on "public version" + "complaint" | Also matches answers, motions and briefs ABOUT the complaint — 10% wrong-document rate on two populations | Exclude answer/motion/brief/letter/certificate terms |
| Re-fetching after a selection fix without clearing the old files | A filename-keyed resume guard reports `already_present` and keeps the known-bad document | Quarantine, then re-fetch |
| Report "session expired" because the cookie read came back empty | An empty cookie *name* (`['']`) is a parsing failure, not an absent session. Picking the first CDP page target returns nothing when that tab is `blob:`/`chrome://` — this cost hours and triggered a needless credential hunt | Use `scripts/lm_cookie.py`, which selects a page on the requested host; verify by fetching one document |
| Pin the session cookie into a `Cookie:` header | It goes stale mid-run when the vendor rotates it, and the resulting 401s look exactly like rate limiting | Put cookies in the `requests` cookie jar; re-read from the browser on a 401 |
| Retry a Docket Alarm HTTP 500 | Reproducible "document not held"; the backoff dominates the run | Record it and move on |
| Take `documents[0]` when no title matches the entry text | That is how a sealing motion becomes a "complaint" | Mark `is_substitute`, never `ok` |
| Run `pdftotext`/`pdfinfo` inside the download loop | A long timeout on one malformed PDF stalls a worker and looks like a hang | Compute page/text metrics in a post-pass |
| `kill $!` after `setsid`, or `pkill -f` a pattern matching your own shell | Kills the wrong PID and leaves crawlers running — three concurrent copies hit one vendor this way | `ps -eo pid,cmd \| awk '/[d]a_grab/'` then kill the real pid |
| Trust a vendor's case-type tag as ground truth | Tags put a judicial letter, a §225 petition and a notary page in a books-and-records population | Screen from the document text |
| Conclude coverage is complete without checking the whole population | Every widening of the net raised the count: 6.5% → 10.7% → 16.1% written decisions | Scan all cases, all document-type spellings |
