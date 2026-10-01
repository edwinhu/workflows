# SEC full-text search on WRDS (`wrds_sec_search`)

The backend of the WRDS web "SEC Filings Search" (`/text-search/wrds-sec-filing-search/`). The web
tool has no JSON API (form POST → server-rendered HTML); this schema is the programmatic route.
Readable on `eddyhu` (verified 2026-09-30).

## Schema

- One table per form family: `filing_8_k`, `filing_10_k`, `filing_10_q`, `filing_def`, `filing_s_8`,
  `filing_sc_13d`, `filing_4`, … (68 tables) plus `filing_view` (all forms, adds `registrants` jsonb).
- Columns: `accession, form, filing_date, report_date, acceptance, filing` (text: every document in
  the filing concatenated, each exhibit's filename and type inline, e.g. `d101719dex102.htm EX-10.2`),
  `filing_tsv` (tsvector, `english` config, RUM-indexed). Only the first 20M characters are indexed.
- `registrant(accession, cik, role, name, sic_no, state_inc, state_hdq, …)`; one row per CIK × role
  (`FILER`, `SUBJECT COMPANY`, …), indexed on `cik`.

## Query pattern

Match on `filing_tsv` server-side and return ids plus a `ts_headline` snippet. **Never select
`filing` in bulk**: the tables hold tens of GB of text (`filing_def` ≈ 45 GB). Bulk text goes through
the file route in `edgar.md`.

```sql
SET statement_timeout = 240000;
WITH q AS (
  SELECT phraseto_tsquery('english', 'continue to vest')
      && phraseto_tsquery('english', 'consulting agreement')
      && to_tsquery('english', 'noncompet:*') AS tq)
SELECT f.accession, f.form, f.filing_date, r.cik, r.name,
       ts_headline('english', left(f.filing, 2000000), q.tq,
                   'MaxFragments=1,MaxWords=25,MinWords=10') AS snippet
FROM wrds_sec_search.filing_8_k f
JOIN wrds_sec_search.registrant r ON r.accession = f.accession AND r.role = 'FILER',
     q
WHERE f.filing_tsv @@ q.tq
  AND f.filing_date BETWEEN '2021-01-01' AND '2026-12-31';
```

- Phrases: `phraseto_tsquery`; prefix: `to_tsquery('english','noncompet:*')`; combine with `&&`, `||`,
  `!!`. `websearch_to_tsquery` takes web-style syntax (`"exact phrase" -word`).
- Speed: the 8-K query above counts 95 filings (2021–2026) in ~9 s.
- Counts differ from the web tool's (same query: 70 8-Ks there) because of stemming and how
  `non-compet*` is tokenized; state the tsquery used with any count.
- Hits are filings, not exhibits. To attribute a match, find the nearest preceding
  `<file>.htm EX-…` marker in the snippet or fetch the exhibit from the Archives.

## Recall and precision limits (measured 2026-09-30)

Same three-phrase 8-K query, 2021–2026: WRDS web 215 filings, SEC API 128, this SQL 169; union 230.
No route found everything.

- **Misses late text.** Postgres caps tsvector positions at 16,383, so in long filings every later
  word sits at 16,383 and phrase (`<->`) matches past that point fail. Filings of 200k–1.4M characters
  were missed this way, far below the 20M-character limit.
- **Misses glued tokens.** Extraction drops separators (`10.Consulting Agreement.As`,
  `12-monthnon-competition`), so the phrase never tokenizes.
- **Over-matches.** `english` stemming plus stopword gaps make `phraseto_tsquery` looser than an exact
  phrase: "consulting agreements", "continues to vest", "continued equity vesting" and
  "non-competitive" all match.
- **Conjunction spans documents.** Terms can match in different exhibits of the same filing.

Treat SQL hits as candidates, union them with the web tool or SEC API, and confirm the literal phrase in
the fetched exhibit before counting.

## Related tables

- `wrdssec.bow_YYYY(accession, word, noccur)` (1993–2025): single-word counts per filing, no phrases;
  `bow_filingsummary` maps accession to cik/form/date. Cheap exhaustive screens on one word.
- `wrdssec.sec_item_words_*` (10-K item level) is premium: `permission denied` on `eddyhu`.
- EDGAR's own full-text API (exhibit-level hits, 10,000-result cap): see the `sec-fetch` skill.
