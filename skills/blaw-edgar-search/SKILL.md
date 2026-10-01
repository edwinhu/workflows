---
name: blaw-edgar-search
description: "Use when the user wants to search SEC filings or exhibits on Bloomberg Law — 'search EDGAR on Bloomberg Law', 'BLAW EDGAR search', 'find exhibits with this clause', 'which 8-Ks attach a consulting agreement', 'pull the Bloomberg Law results list', 'capture the BLAW results' — or needs exhibit-level phrase search with proximity operators that the SEC and WRDS full-text routes handle badly."
---

# Bloomberg Law EDGAR search

A Bloomberg-specific profile of `ui-json-capture`: drive the logged-in browser at human pace and
keep the JSON the page already receives. Load `browser-automation` (port 9222,
`mcp__chrome-devtools__*`) and read `ui-json-capture` for the procedure and its Red Flags.

<EXTREMELY-IMPORTANT>
**Never call the JSON API yourself** (`fetch`, `curl`, replayed POSTs) — bulk use of it is plainly
against Bloomberg's terms. Click the UI; capture what it returns. Before paging at all: read the
facet counts on page 1, and prefer the results list's own CSV export (`allow_csv: true` in the
response) when a filtered slice fits its cap.
</EXTREMELY-IMPORTANT>

## Why this route

Measured 2026-09-30 against SEC EFTS, WRDS web and `wrds_sec_search`: Bloomberg matches **per
exhibit** (option "Exhibits Only"), runs **unstemmed** (`stemmed_search: false`), tolerates
extraction glitches ("Non -Competition" still matched), and has Terms & Connectors: `"phrase"`,
`^"case-sensitive"`, `!` and `*` wildcards, `N/x`, `NP/x`, `S/`, `P/`, `ATLx()`, `ATMx()`.
Coverage from 1994; ~19.6M EDGAR documents.

## Login

The browser is often signed out. Credentials are the 1Password item `Bloomberg Law (UVA)` (vault
"Shared with Agents"); handle them only inside a dispatched agent, never in the main thread.
- Fields: `input#username`, `input#password`. A bare `#username` matches the `<m-text-field>`
  wrapper first. Enter `Input.insertText` after focusing; React ignores `.value`.
- Enter does **not** submit. Click the button whose text is `Sign In`; it lands on `/start`.

## Search

- Form: `https://www.bloomberglaw.com/start#advanced-search/features_edgar_all_search/features_edgar_all_search`
  (Keywords; Apply To = Forms & Exhibits / Forms Only / Exhibits Only; Forms; Exhibits; Exhibit
  title; filer, CIK, company, location, SIC, file number). The favorite link may need one reload.
- Install `scripts/01-install-hook.js` **before** clicking Search, so page 1 is captured.

## Wire facts (observed, not for calling)

- `POST /product/blaw/api/v1/search/criteria`, body
  `{"criteria":{"model":"features_edgar_all_search","term":…,"keywords_apply_to":"edgar_exhibit","page_size":50,"page":N}}`.
  Page 1 is the form submit; page N comes from the pager. Filter clicks hit the same endpoint
  with new criteria; the hook keys each page by criteria-minus-page, so check `__cap.queries`
  holds exactly one query before assembling.
- Response: `results_page.components.documents.items[]` (50 per page; `id`, `title` like
  `"WOLFSPEED, INC.; Form 10-K; EX-10.21"`, `date`, `metadata` filer, `subtitles` file
  number / filed / period / form, `extracts` with `<mark>` hits); `.remote_count` total (the UI
  shows "1000+"); `components.facets.items[]` (form family, form type, exhibit type, company,
  SIC) with counts.
- Paging is an in-app route change (URL `/product/blaw/search/results/<criteria_id>`, same
  document), so the hook persists. Next control: `svg[data-testid="search-results-next-page"]`,
  `disabled="true"` on the last page; click it with a dispatched `MouseEvent`.

## Capture

`scripts/01-install-hook.js` and `scripts/02-run-pager.js` here; `03-status.js`, `04-dump.js`,
`05-stop.js` and `assemble.py` from `ui-json-capture/scripts/` unchanged:

```bash
python3 ~/.claude/skills/workflows/skills/ui-json-capture/scripts/assemble.py \
  --batches scratch/blaw --glob 'batch_*.json' --out data/raw/blaw_hits.jsonl \
  --expect-total <remote_count> --page-size 50 --id-field id
```

## From hits to EDGAR (accession, full text)

A hit carries no accession or CIK. `scripts/resolve_exhibits.py` resolves an `assemble.py` file:

```bash
uv run --script ${CLAUDE_SKILL_DIR}/scripts/resolve_exhibits.py --hits data/raw/blaw_hits.jsonl \
  --out-dir data/processed/blaw --cache-dir data/raw/edgar_sgml \
  --phrase "consulting agreement" --phrase "non-competition"    # phrases optional
```

- **Join on WRDS:** keys go up as parameter arrays (pgdata is a hot standby: no TEMP tables) and
  join server-side to `registrant` (file no.), `filing_view` (date, form prefix) and `wrds_forms`
  (`wrdsfname`), so only ids and paths come back, never `filing` text.
- **Files via rclone:** raw submissions from `wrds:/wrds/sec/archives` by `wrdsfname`, cached;
  over 10,000 files it uses `edgar.md`'s server-side tar. `--ignore-checksum` is deliberate: the
  default md5 check opens an ssh session per file on the login node, and exhausted it at 16 transfers.
- **Parse locally:** one pass over the SGML `<DOCUMENT>` blocks gives TYPE, DESCRIPTION, FILENAME
  and text for every hit, with no per-hit query.

`hits_resolved.jsonl` / `.parquet`: Bloomberg fields, `match_status` (unique / resolved_by_exhibit /
ambiguous / unmatched), `resolved_by` (type → exact title form → DESCRIPTION → extract text),
`doc_match`, `accession`, `cik`, `filename`, `sec_url`, `text_path`, `chars`, `extract_found`,
`phrase_verification`. Title quirks it handles: normalized form drops `/A` (the title keeps it);
`EX-99: EX-99.1` is TYPE: DESCRIPTION; `EX-10.6 2` is the DESCRIPTION of the second EX-10.6;
`Rule 425 Communications` = `425`.

Measured 2026-10-01 on 295 hits: WRDS join 1–27 s; 277 submissions = 2.62 GB by rclone in 27 s;
parse + extract ~20 s. 294 resolved, 1 unmatched (`CB/A`: absent from the WRDS tables). Exhibit
text equals sec.gov's document minus its SGML header line in 275/275 checked.

Run a first pass on `extracts` alone; send only positives and unsure rows to a full-text pass.

## Filters

Results-page facets are `<label>` elements (click the label, not the a11y checkbox node); each
click is a new query. Form type lands in criteria as
`"facets":{"normalized_form_type":["Form 8-K"], "form_family":[], "display_exhibit_type":[], "cik":[], "sic":[]}`.
A facet slice under 1,000 needs no date filter: capture it whole and filter locally. Date presets
sit under `[data-testid="date-selector-preset-dropdown-button"]` (Any, Single date, Date range,
Last 7/30 days, Last 12 months, Last 5 years) and land as e.g. `"date_type":"last_5_years"`.

Verified 2026-10-01: three-phrase query, Exhibits Only, Form 8-K → 356 hits, 8 pages captured by
the pager in ~4 min, `assemble.py` exit 0 (no gaps, 356 unique ids).

## Not yet verified

Whether paging continues past result 1,000; the CSV export's row cap; the field names for a custom
date range.
