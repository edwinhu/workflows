# Retrieving filed court documents: Lex Machina, Docket Alarm, Bloomberg Law

Verified against DE Court of Chancery on 2026-08-30 by tracing each product's own UI traffic.
Every endpoint below was exercised; the measured rates are from full or sampled runs on the same
1,597-case population, not estimates. Traces live in the project this was extracted from (de_220); the endpoint facts below are self-contained.

**Auth model for all three: the user's live logged-in browser session on CDP port 9222.** None of
these needs a password. Read cookies with `scripts/lm_cookie.py::get_cookie(url, port=9222)` (shipped with this skill)
(CDP `Network.getCookies`, which also returns HttpOnly cookies).

---

## Summary

| | Lex Machina | Docket Alarm | Bloomberg Law |
|---|---|---|---|
| Key you need | internal case id | **the C.A. number** | internal docket id |
| Requests per complaint | 2 (paged) | 2 (1 if ids cached) | 2 |
| Document URL | signed GCS, **expires 1 h** | durable, unsigned | durable, unsigned |
| Coverage starts | 2012-10 | ~2007 | **2003** |
| Complaint identified | 99.6% | 96.4% | ~99% |
| Complaint **file served** | **81.0%** | ~85% | ~90% |
| Works outside the browser? | yes (cookie) | yes (cookie), **except search** | **no — see below** |

No product serves the complaint file for every case. All three identify it far more often than
they serve it. Treat "identified" and "retrievable" as separate columns or you will overstate
coverage by 15-20 points.

---

## 1. Lex Machina

```
GET /state-court/cases/{case_id}/docket-search           # JSON, paged: n= (<=200), start=
GET /state-court/documents/{document_id}/pdf?document_file_id={file_id}
      -> 302 -> https://storage.googleapis.com/lmi-state-pdfs/{file_id}.pdf?Expires=...&Signature=...
```

- `case_id` is the `id` field in the case-search capture. The case page is
  `/state-court/cases/{state}/{court}/{case_id}`, but the docket endpoint drops the court segment.
- Document ids live in `result[].**_augmented**.documents[]`, a sibling of `_source` — this is why
  scanning `_source` for document ids finds nothing.
- **Two different ids.** `documents[].id` (9 digits) is the document; `documents[].files[].id`
  (8 digits) is the file, and the GCS object is named by the FILE id. You need both.
- Selection: the earliest docket entry carrying **document tag id 257 `Complaint`** on
  `_source.tags[]`. Validated 25/25. Do **not** use "first docket entry" — measured wrong in 2/25
  (a summons and an amended information sheet sort first).
- **The signed URL expires in one hour and is re-minted per request.** Store the ids, never the URL.
- `docket-search` is cacheable (`cache-control: max-age=3600`); caching it locally makes restarts
  nearly free.

**The dominant failure mode:** Lex frequently lists the complaint with an **empty `files[]`** while
ancillary papers on the same entry do have files. That is *complaint identified, file withheld* —
not "not found". Measured **298/1,597 (18.7%)**. A naive "first document with a file" fallback then
silently returns a Rule 5.1 certification, a letter, or a verification page and looks successful.

## 2. Docket Alarm

```
GET /cases/Delaware_State_Court_of_Chancery/{da_number}/     # 302 -> slugged page
      page embeds:  var docket_report = JSON.parse('...');
                    var docket_has_paid_documents = false;
GET {resolved_url}/docs/{doc_id}.pdf?download=true            # durable, unsigned
```

- **`da_number` is the plain C.A. number**: `YYYY-NNNN` from 2017 on, bare digits before that
  (`8014-VCL` -> `8014`). No id mapping needed — this is Docket Alarm's big advantage.
- `docket_report[]` gives per-document `de_doc_type` (a coded type, e.g.
  `Complaint - Inspect Books/Records`), `contents`, `date`, `pages`, `link`.
- Check `docket_has_paid_documents` before fetching; it was `false` on all 1,597 here, but it is
  the per-document cost flag.
- **The `/api/v1/` REST API is a separate paid entitlement.** `login/` returns
  `"The API is not enabled on your account."` on a normal subscription.
- **The search endpoint is bot-protected: HTTP 400 outside the browser**, 200 via same-origin
  `fetch()` in a logged-in tab. Per-docket pages are fine outside. There is no document-type facet,
  so document search cannot be filtered to complaints (`doctype:` -> 400, `type:` -> ignored).
- Bulk "Download All" only operates on *document* search results and returns
  "no documents to download" for a docket search.

**Two failure modes.** HTTP 500 with a ~40 KB HTML body means the file is not held; it is
reproducible and never recovers, so **do not retry it**. Separately, **some documents never respond
at all** — use a short timeout (45 s), never 300 s.

## 3. Bloomberg Law

```
POST /product/blaw/api/v1/search/criteria     # 201; top-level `id` is the criteria_id
GET  /results/csv/view/{criteria_id}          # 41-column CSV, SILENTLY CAPPED AT 1000 ROWS
GET  /product/blaw/api/v1/document/docket/entries/content/{docket_id}
GET  /product/blaw/document/{subDocumentId}/download        # -> application/pdf
```

Search body (`page_size:100` pages past the UI's "1000+"; `remote_count` is the true total):

```json
{"criteria":{"facets":{"content_kind":["2"]},"term":"\"Books AND Records\"",
  "sources":["105.100933"],"content_type":"Court Dockets",
  "model":"features_docket_search_v3","page":1,"page_size":100,
  "inferred_filters":{},"bucket":false,"docket_entry_filing_type":["complaint"],
  "viewable_attachments":[" "]},"user_activity":"select_filters"}
```
Headers: JSON content-type/accept, `X-Requested-With: XMLHttpRequest`, and
`X-CSRF-Token` = url-decoded `CSRF-TOKEN` cookie.

- **Two silent caps, both verified.** The CSV truncates at 1,000 data rows. Separately, paging one
  criteria past result 10,000 returns **201 with the `documents` component simply absent** — no
  error. The rule is on the last index: `page*page_size <= 10000` (100x100 ok, 101x99 ok,
  101x100 absent, 334x30 absent); smaller pages do not help. A search with 0 hits omits the same
  component, so disambiguate by position — at `page=1` an absent component means zero hits.
  Anything over 10,000 hits must be date-sliced. All 25,874 Del. Ch. dockets (2003-2026) were
  collected this way: `docs/investigations/2026-08-31_bl-chancery-full-metadata.md`.
- **22 of the 41 CSV columns are empty for Del. Ch.** — including Nature Of Suit, Case Outcome,
  Case Settlement, Case Length In Days, Demand, Damages, Attorney Fees and every side-specific
  attorney/firm column. `Attorney` (a combined roster, not split by side), `Plaintiff/Defendant
  Party`, `Potential Class Action`, `Case Type Group` and `Judge` are the fields that do carry data.
- **Two ids.** Search items carry only the **docket** id. The `entries/content` call maps it to
  `entries[].subDocumentId`, which is what `/download` takes. It also returns
  `histories[].calendar.type` (coded doc type), `entries[].index` / `extId` (the real docket entry
  number) and `factsSummary` (a generated case summary the others don't have).
- Selection: **lowest `index` among entries whose `calendar.type` is a complaint type**, excluding
  `Verification|Amended|Supplemental|Notice|Certificate|Exhibit|Motion`. The entry number is what
  stops an amended complaint outranking the original. Hand-checked 0/30 wrong, twice, on disjoint
  samples. A naive "first entry whose type contains 'complaint'" measured **4/6 — 33% wrong**.
- `/download` needs **no search token** — session cookie only — and the bytes are the genuine
  e-filed document (md5-identical to Docket Alarm's copy of the same filing).
- `document/{id}/body` returns `{"body":null,"document_format":"PDF"}`: **full text is not served.**
  The text in search snippets is index text, not a retrievable body.

**Session caveat.** BL's `accessToken` cookie is **HttpOnly with an ~8-minute TTL**, refreshed by
the SPA via `gk-api.bloomberglaw.com/auth/v1/tokenRefresh`. A cookie snapshot (e.g. into `crumb`)
therefore authenticates for minutes, not hours. Opening BL in a new tab lands on a login page. All
BL work must run as same-origin `fetch()` **inside the already-open tab** via CDP `Runtime.evaluate`.

---

## Lessons that cost real time

1. **Identification != retrieval.** Every source names the complaint far more often than it serves
   it. Record `is_substitute` / `file_withheld` and never mark a substitute `ok`. A fallback that
   grabs "the first document that has a file" manufactures silent false successes — 17% on Lex here.
2. **Validate the selection rule on a hand-checked sample before any bulk run**, and if you retune
   after measuring, re-measure on a *fresh* disjoint sample and report both numbers.
3. **A stale pinned `Cookie:` header looks exactly like rate limiting.** Put cookies in the
   `requests` cookie jar so `Set-Cookie` rotation applies; re-read from the browser on a 401. An
   apparent Docket Alarm block was entirely this.
4. **Short HTTP timeouts.** A hanging document plus a 300 s timeout plus an ordered
   `ThreadPoolExecutor.map` looks identical to a deadlocked process.
5. **Keep expensive work out of the download loop.** `pdftotext` with a long timeout inside the
   fetch path stalls workers; compute page/text metrics in a post-pass.
6. **`pkill`/`pgrep -f` self-matches**, and `kill $!` after `setsid` kills the wrong process — that
   left three crawlers hammering one service at once. Verify with `ps -eo pid,cmd | awk '/[d]a_grab/'`.
7. **Silent caps.** Bloomberg's CSV returns exactly 1,000 rows with no warning anywhere. Always
   cross-check an export against the API's own `remote_count`.
